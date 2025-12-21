import { TBCEncoder } from "@core/bytecode/bin";
import { Codegen } from "@core/lang/codegen";
import { Lexer } from "@core/lang/lexer";
import { Parser } from "@core/lang/parser";
import { Resolver } from "@core/lang/resolver";

import { base64ToBytes, bytesToBase64 } from "./engine/base64";
import { createEngine, type Engine } from "./engine/engine_factory";
import type { DeosTraceV1 } from "./engine/trace_format";
import {
  type CommandMessage,
  type DeosUiEvent,
  EventMask,
  isCommandMessage,
  PROTOCOL_VERSION,
  type RespCompileOk,
  type RespErr,
  type RespOk,
  type SuiteProgressEvent,
  type SuiteRunStatus,
  type UiEventMessage,
  type WorkerEvent,
} from "./protocol";
import {
  type SampleCheckResult,
  type SampleDefinition,
  type SampleRunnerApi,
  type SampleRunnerConfig,
  samples,
} from "./samples";

function respOk(requestId: string, payload?: unknown): RespOk {
  return {
    version: PROTOCOL_VERSION,
    type: "response",
    requestId,
    ok: true,
    payload,
  };
}

function respErr(
  requestId: string,
  code: string,
  message: string,
  details?: unknown,
): RespErr {
  return {
    version: PROTOCOL_VERSION,
    type: "response",
    requestId,
    ok: false,
    error: { code, message, details },
  };
}

const enginePromise: Promise<Engine> = createEngine();
let lastClock = { tick: 0, cycle: "0" };

const moduleBytesByName = new Map<string, Uint8Array>();
const tasksByTid = new Map<
  number,
  { tid: number; moduleName: string; entryFnIndex: number; domainId: number }
>();
let schedulerPolicyModuleName: string | null = null;

let activeTrace: DeosTraceV1 | null = null;
let loadedTrace: DeosTraceV1 | null = null;
let lastSnapshotTick: number | null = null;

let isRunning = false;
let isSuiteRunning = false;

let currentConfig = {
  cyclesPerTick: 10_000,
  timesliceTicks: 1,
  snapshotEveryTicks: 100,
  eventMask:
    EventMask.Console |
    EventMask.Tick |
    EventMask.TaskSwitch |
    EventMask.Perform |
    EventMask.Continuation |
    EventMask.InputConsumed |
    EventMask.PolicyPick |
    EventMask.Error,
};

function postUiEvent(event: WorkerEvent) {
  const msg: UiEventMessage = {
    version: PROTOCOL_VERSION,
    type: "event",
    event,
  };
  self.postMessage(msg);
}

const engineEventSubscribers = new Set<(ev: DeosUiEvent) => void>();
let forwardEngineEventsToUi = true;

function postSuiteProgress(event: SuiteProgressEvent) {
  postUiEvent(event);
}

function flushEngineEvents(engine: Engine) {
  for (;;) {
    const json = engine.pollEventJson();
    if (!json) break;
    const ev = JSON.parse(json) as DeosUiEvent;
    lastClock = { tick: ev.tick, cycle: ev.cycle };
    for (const cb of engineEventSubscribers) cb(ev);
    if (forwardEngineEventsToUi) postUiEvent(ev);
    if (activeTrace) maybeRecordEvent(engine, ev);
  }
}

function takeSnapshotForTrace(engine: Engine) {
  if (!activeTrace) return;
  const snapshotJson = engine.exportSnapshotJson();
  const parsed = JSON.parse(snapshotJson) as {
    tick?: unknown;
    cycle?: unknown;
    stateHash?: unknown;
  };
  const tick = typeof parsed.tick === "number" ? parsed.tick : 0;
  const cycle = typeof parsed.cycle === "string" ? parsed.cycle : "0";
  const stateHash =
    typeof parsed.stateHash === "string" ? parsed.stateHash : "";
  activeTrace.snapshots.push({ tick, cycle, stateHash, snapshotJson });
  lastSnapshotTick = tick;
}

function maybeRecordEvent(engine: Engine, ev: DeosUiEvent) {
  if (!activeTrace) return;
  if (ev.type === "inputConsumed") activeTrace.events.push(ev);
  if (ev.type === "console") activeTrace.output.push(ev);

  if (ev.type === "tick") {
    lastSnapshotTick ??= ev.tick;
    if (ev.tick - lastSnapshotTick >= activeTrace.config.snapshotEveryTicks) {
      takeSnapshotForTrace(engine);
    }
  }
}

function compileToTbcBytes(sourceText: string): Uint8Array {
  const tokens = new Lexer(sourceText).tokenize();
  const program = new Parser(tokens).parse();
  const result = new Resolver().resolve(program);
  const tbc = new Codegen(result).generate(program);
  return new TBCEncoder().encode(tbc);
}

async function runBatched(
  engine: Engine,
  opts: {
    untilTick?: number;
    maxInstructions?: number;
  },
) {
  const maxInstructions = opts.maxInstructions ?? 5_000_000;
  let remaining = Math.max(0, Math.floor(maxInstructions));

  while (!engine.getPaused()) {
    if (opts.untilTick !== undefined && lastClock.tick >= opts.untilTick) break;
    if (remaining <= 0) return { hitMaxInstructions: true };

    const batch = Math.min(50_000, remaining);
    const executed = engine.step(batch);
    remaining -= executed;
    flushEngineEvents(engine);

    if (executed === 0) break;
    // Yield to allow pause/message handling.
    await new Promise((r) => setTimeout(r, 0));
  }

  return { hitMaxInstructions: false };
}

const DEFAULT_SAMPLE_EVENT_MASK =
  EventMask.Console |
  EventMask.Tick |
  EventMask.TaskSwitch |
  EventMask.Perform |
  EventMask.Continuation |
  EventMask.InputConsumed |
  EventMask.PolicyPick |
  EventMask.Error;

const DEFAULT_SAMPLE_CONFIG: SampleRunnerConfig = {
  cyclesPerTick: 10_000,
  timesliceTicks: 1,
  snapshotEveryTicks: 100,
  eventMask: DEFAULT_SAMPLE_EVENT_MASK,
};

function mergeSampleConfig(
  cfg?: Partial<SampleRunnerConfig>,
): SampleRunnerConfig {
  return { ...DEFAULT_SAMPLE_CONFIG, ...(cfg ?? {}) };
}

function okCheck(summary: string, details?: string): SampleCheckResult {
  return { ok: true, summary, details };
}

function failCheck(summary: string, details?: string): SampleCheckResult {
  return { ok: false, summary, details };
}

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

function maxTickFromEvents(events: DeosUiEvent[]): number {
  let maxTick = 0;
  for (const ev of events) maxTick = Math.max(maxTick, ev.tick);
  return maxTick;
}

function firstErrorCode(events: DeosUiEvent[]): string | null {
  for (const ev of events) {
    if (ev.type === "error") return ev.code;
  }
  return null;
}

function firstErrorCodeFromTick(
  events: DeosUiEvent[],
  fromTick: number,
): string | null {
  for (const ev of events) {
    if (ev.tick < fromTick) continue;
    if (ev.type === "error") return ev.code;
  }
  return null;
}

function consoleTextFromTick(events: DeosUiEvent[], fromTick: number): string {
  let out = "";
  for (const ev of events) {
    if (ev.tick < fromTick) continue;
    if (ev.type === "console") out += ev.text;
  }
  return out;
}

function representativeTick(maxTick: number): number {
  if (maxTick <= 0) return 0;
  if (maxTick >= 20) return 10;
  return Math.max(0, Math.floor(maxTick / 2));
}

function suiteConfigOverrides(
  sampleId: string,
): Partial<SampleRunnerConfig> | undefined {
  if (sampleId === "s7-policy-fairness")
    return { cyclesPerTick: 200, timesliceTicks: 1 };
  return undefined;
}

function inputTapeBytes(sampleId: string): number[] {
  if (sampleId === "s8-record-replay-input") return [97, 98, 99];
  return [];
}

function newRunId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `${String(Date.now())}-${Math.random().toString(16).slice(2)}`;
  }
}

function createSuiteRunnerApi(engine: Engine): SampleRunnerApi {
  return {
    reset() {
      engine.reset();
      lastClock = { tick: 0, cycle: "0" };
      moduleBytesByName.clear();
      tasksByTid.clear();
      schedulerPolicyModuleName = null;
      activeTrace = null;
      loadedTrace = null;
      lastSnapshotTick = null;
      isRunning = false;
      currentConfig = { ...DEFAULT_SAMPLE_CONFIG };
      flushEngineEvents(engine);
      return Promise.resolve();
    },
    init(cfg?: Partial<SampleRunnerConfig>) {
      const merged = mergeSampleConfig(cfg);
      currentConfig = merged;
      engine.init(
        merged.cyclesPerTick,
        merged.timesliceTicks,
        merged.snapshotEveryTicks,
        merged.eventMask,
      );
      lastClock = { tick: 0, cycle: "0" };
      flushEngineEvents(engine);
      return Promise.resolve();
    },
    compileAndLoad(moduleName: string, sourceText: string) {
      const bytes = compileToTbcBytes(sourceText);
      moduleBytesByName.set(moduleName, new Uint8Array(bytes));
      engine.loadModule(moduleName, bytes);

      if (activeTrace) {
        const b64 = bytesToBase64(bytes);
        const existing = activeTrace.modules.find((m) => m.name === moduleName);
        if (existing) existing.tbcBase64 = b64;
        else activeTrace.modules.push({ name: moduleName, tbcBase64: b64 });
      }

      flushEngineEvents(engine);
      return Promise.resolve();
    },
    createTask(tid, moduleName, entryFnIndex, domainId) {
      const entry = entryFnIndex ?? 0;
      const domain = domainId ?? 0;
      tasksByTid.set(tid, {
        tid,
        moduleName,
        entryFnIndex: entry,
        domainId: domain,
      });
      engine.createTask(tid, moduleName, entry, domain);

      if (activeTrace) {
        const existing = activeTrace.tasks.find((t) => t.tid === tid);
        if (existing) {
          existing.moduleName = moduleName;
          existing.entryFnIndex = entry;
          existing.domainId = domain;
        } else {
          activeTrace.tasks.push({
            tid,
            moduleName,
            entryFnIndex: entry,
            domainId: domain,
          });
        }
      }

      flushEngineEvents(engine);
      return Promise.resolve();
    },
    setSchedulerPolicy(moduleName) {
      schedulerPolicyModuleName = moduleName;
      engine.setSchedulerPolicy(moduleName);
      if (activeTrace) activeTrace.policy.moduleName = moduleName;
      flushEngineEvents(engine);
      return Promise.resolve();
    },
    inputKbd(byte: number, isDown: boolean) {
      engine.inputKbd(byte, isDown);
      flushEngineEvents(engine);
      return Promise.resolve();
    },
    async run(opts) {
      engine.setPaused(false);
      await runBatched(engine, {
        untilTick: opts?.untilTick,
        maxInstructions: opts?.maxInstructions ?? 5_000_000,
      });
      flushEngineEvents(engine);
    },
    recordStart() {
      engine.recordStart();
      activeTrace = {
        version: "1.0",
        config: { ...currentConfig },
        modules: Array.from(moduleBytesByName.entries()).map(
          ([name, bytes]) => ({
            name,
            tbcBase64: bytesToBase64(bytes),
          }),
        ),
        tasks: Array.from(tasksByTid.values()).map((t) => ({ ...t })),
        policy: { moduleName: schedulerPolicyModuleName },
        events: [],
        output: [],
        snapshots: [],
      };
      lastSnapshotTick = null;
      takeSnapshotForTrace(engine);
      flushEngineEvents(engine);
      return Promise.resolve();
    },
    recordStop() {
      engine.recordStop();
      flushEngineEvents(engine);
      return Promise.resolve();
    },
    getTraceJsonText() {
      if (!activeTrace) throw new Error("NoTrace");
      return Promise.resolve(JSON.stringify(activeTrace, null, 2));
    },
    loadTraceJsonText(traceJsonText: string) {
      const parsed = JSON.parse(traceJsonText) as unknown;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        (parsed as { version?: unknown }).version !== "1.0"
      ) {
        throw new Error("BadTrace");
      }
      loadedTrace = parsed as DeosTraceV1;
      return Promise.resolve();
    },
    replayStart() {
      const trace = loadedTrace;
      if (!trace) throw new Error("NoTrace");

      engine.reset();
      engine.init(
        trace.config.cyclesPerTick,
        trace.config.timesliceTicks,
        trace.config.snapshotEveryTicks,
        trace.config.eventMask,
      );

      moduleBytesByName.clear();
      for (const m of trace.modules) {
        const bytes = base64ToBytes(m.tbcBase64);
        moduleBytesByName.set(m.name, bytes);
        engine.loadModule(m.name, bytes);
      }

      tasksByTid.clear();
      for (const t of trace.tasks) {
        tasksByTid.set(t.tid, { ...t });
        engine.createTask(t.tid, t.moduleName, t.entryFnIndex, t.domainId);
      }

      schedulerPolicyModuleName = trace.policy.moduleName;
      engine.setSchedulerPolicy(trace.policy.moduleName);

      engine.replayStart();

      const snap = trace.snapshots.at(0);
      if (snap) engine.loadSnapshotJson(snap.snapshotJson);

      const snapCycle = snap ? BigInt(snap.cycle) : 0n;
      for (const ev of trace.events) {
        const at = BigInt(ev.cycle);
        if (at <= snapCycle) continue;
        engine.scheduleKbd(at, ev.byte, ev.isDown);
      }

      flushEngineEvents(engine);
      return Promise.resolve();
    },
    replayStop() {
      engine.replayStop();
      flushEngineEvents(engine);
      return Promise.resolve();
    },
    reverseToTick(tick: number) {
      const trace = loadedTrace ?? activeTrace;
      if (!trace) throw new Error("NoTrace");

      const snaps = trace.snapshots
        .filter((s) => s.tick <= tick)
        .sort((a, b) => b.tick - a.tick);
      const snap = snaps.at(0) ?? trace.snapshots.at(0) ?? null;
      if (!snap) throw new Error("NoSnapshot");

      engine.reset();
      engine.init(
        trace.config.cyclesPerTick,
        trace.config.timesliceTicks,
        trace.config.snapshotEveryTicks,
        trace.config.eventMask,
      );

      moduleBytesByName.clear();
      for (const m of trace.modules) {
        const bytes = base64ToBytes(m.tbcBase64);
        moduleBytesByName.set(m.name, bytes);
        engine.loadModule(m.name, bytes);
      }

      tasksByTid.clear();
      for (const t of trace.tasks) {
        tasksByTid.set(t.tid, { ...t });
        engine.createTask(t.tid, t.moduleName, t.entryFnIndex, t.domainId);
      }

      schedulerPolicyModuleName = trace.policy.moduleName;
      engine.setSchedulerPolicy(trace.policy.moduleName);
      engine.replayStart();

      engine.loadSnapshotJson(snap.snapshotJson);

      const snapCycle = BigInt(snap.cycle);
      for (const ev of trace.events) {
        const at = BigInt(ev.cycle);
        if (at <= snapCycle) continue;
        engine.scheduleKbd(at, ev.byte, ev.isDown);
      }

      engine.setPaused(false);
      engine.runUntilTick(tick, 5_000_000);
      engine.setPaused(true);

      flushEngineEvents(engine);
      return Promise.resolve();
    },
    async captureWhile<T>(fn: () => Promise<T>) {
      const events: DeosUiEvent[] = [];
      let consoleText = "";

      const listener = (ev: DeosUiEvent) => {
        events.push(ev);
        if (ev.type === "console") consoleText += ev.text;
      };

      engineEventSubscribers.add(listener);
      try {
        const value = await fn();
        return { value, capture: { consoleText, events } };
      } finally {
        engineEventSubscribers.delete(listener);
      }
    },
  };
}

async function runSuiteDeterminismCheck(
  api: SampleRunnerApi,
  sample: SampleDefinition,
): Promise<SampleCheckResult> {
  const cfg = suiteConfigOverrides(sample.id);
  const maxInstructions = 5_000_000;

  const policyModule =
    sample.modules.find((m) => m.role === "policy")?.moduleName ?? null;
  const inputBytes = inputTapeBytes(sample.id);

  await api.reset();
  await api.init(cfg);
  for (const m of sample.modules)
    await api.compileAndLoad(m.moduleName, m.sourceText);
  for (const t of sample.tasks)
    await api.createTask(t.tid, t.moduleName, t.entryFnIndex, t.domainId);
  await api.setSchedulerPolicy(policyModule);

  await api.recordStart();
  for (const b of inputBytes) await api.inputKbd(b, true);
  const record = await api.captureWhile(() => api.run({ maxInstructions }));
  await api.recordStop();
  const traceJsonText = await api.getTraceJsonText();

  await api.reset();
  await api.init(cfg);
  await api.loadTraceJsonText(traceJsonText);
  await api.replayStart();
  const replay = await api.captureWhile(() => api.run({ maxInstructions }));
  await api.replayStop();

  const recordOut = normalizeNewlines(record.capture.consoleText);
  const replayOut = normalizeNewlines(replay.capture.consoleText);
  if (recordOut !== replayOut) {
    return failCheck(
      "record/replay output mismatch",
      `record:\n${recordOut}\n\nreplay:\n${replayOut}`,
    );
  }

  const recordErr = firstErrorCode(record.capture.events);
  const replayErr = firstErrorCode(replay.capture.events);
  if (recordErr !== replayErr) {
    return failCheck(
      "record/replay error mismatch",
      `record=${JSON.stringify(recordErr)} replay=${JSON.stringify(replayErr)}`,
    );
  }

  const maxTick = maxTickFromEvents(record.capture.events);
  const repTick = representativeTick(maxTick);

  await api.reset();
  await api.init(cfg);
  await api.loadTraceJsonText(traceJsonText);
  const reverse = await api.captureWhile(async () => {
    await api.reverseToTick(repTick);
    await api.run({ maxInstructions });
  });

  const recordSuffix = normalizeNewlines(
    consoleTextFromTick(record.capture.events, repTick),
  );
  const reverseSuffix = normalizeNewlines(
    consoleTextFromTick(reverse.capture.events, repTick),
  );
  if (recordSuffix !== reverseSuffix) {
    return failCheck(
      "reverse output mismatch",
      `tick>=${String(repTick)}\nrecord:\n${recordSuffix}\n\nreverse:\n${reverseSuffix}`,
    );
  }

  const recordErrSuffix = firstErrorCodeFromTick(
    record.capture.events,
    repTick,
  );
  const reverseErrSuffix = firstErrorCodeFromTick(
    reverse.capture.events,
    repTick,
  );
  if (recordErrSuffix !== reverseErrSuffix) {
    return failCheck(
      "reverse error mismatch",
      `tick>=${String(repTick)} record=${JSON.stringify(recordErrSuffix)} reverse=${JSON.stringify(reverseErrSuffix)}`,
    );
  }

  return okCheck("record/replay + reverse matched");
}

async function runSampleSuite(
  engine: Engine,
  payload: {
    mode: "quick" | "full";
    suiteId: string;
    stopOnFirstFail: boolean;
  },
): Promise<{
  suiteId: string;
  runs: Array<{ sampleId: string; runId: string; status: SuiteRunStatus }>;
  passCount: number;
  failCount: number;
}> {
  if (payload.suiteId !== "deos-standard") {
    throw new Error(`Unsupported suiteId: ${payload.suiteId}`);
  }

  const api = createSuiteRunnerApi(engine);
  const total = samples.length;

  const runs: Array<{
    sampleId: string;
    runId: string;
    status: SuiteRunStatus;
  }> = [];
  let passCount = 0;
  let failCount = 0;

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const runId = newRunId();

    postSuiteProgress({
      type: "suiteProgress",
      suiteId: payload.suiteId,
      sampleId: sample.id,
      runId,
      index: i + 1,
      total,
      status: "running",
      passCount,
      failCount,
    });

    const t0 = performance.now();
    let status: SuiteRunStatus = "passed";
    let summary: string | undefined;

    try {
      const res = await sample.run(api);
      if (!res.ok) {
        status = "failed";
        summary = res.summary;
      } else {
        summary = res.summary;
        if (payload.mode === "full") {
          const det = await runSuiteDeterminismCheck(api, sample);
          if (!det.ok) {
            status = "failed";
            summary = det.summary;
          } else {
            summary = `${res.summary}; ${det.summary}`;
          }
        }
      }
    } catch (e: unknown) {
      status = "error";
      summary = `exception: ${String(e)}`;
    }

    if (status === "passed") passCount += 1;
    else failCount += 1;

    const durationMs = Math.round(performance.now() - t0);
    runs.push({ sampleId: sample.id, runId, status });

    const doneEv: SuiteProgressEvent = {
      type: "suiteProgress",
      suiteId: payload.suiteId,
      sampleId: sample.id,
      runId,
      index: i + 1,
      total,
      status,
      passCount,
      failCount,
      durationMs,
      ...(summary ? { summary } : {}),
    };
    postSuiteProgress(doneEv);

    if (payload.stopOnFirstFail && status !== "passed") break;
  }

  return { suiteId: payload.suiteId, runs, passCount, failCount };
}

async function handleCommand(
  msg: CommandMessage,
): Promise<RespOk | RespErr | RespCompileOk> {
  const requestId = msg.requestId;
  if (!requestId) {
    // requestId is required for commands.
    return {
      version: PROTOCOL_VERSION,
      type: "response",
      requestId: "missing",
      ok: false,
      error: { code: "BadRequest", message: "requestId is required" },
    };
  }

  const engine = await enginePromise;
  if (isSuiteRunning && msg.command !== "runSampleSuite") {
    return respErr(requestId, "Busy", "sample suite is running");
  }

  switch (msg.command) {
    case "init":
      try {
        currentConfig = {
          cyclesPerTick: msg.payload.cyclesPerTick,
          timesliceTicks: msg.payload.timesliceTicks,
          snapshotEveryTicks: msg.payload.snapshotEveryTicks,
          eventMask: msg.payload.eventMask,
        };
        engine.init(
          msg.payload.cyclesPerTick,
          msg.payload.timesliceTicks,
          msg.payload.snapshotEveryTicks,
          msg.payload.eventMask,
        );
        lastClock = { tick: 0, cycle: "0" };
        return respOk(requestId);
      } catch (e) {
        return respErr(requestId, "EngineError", "init failed", e);
      }
    case "compile": {
      try {
        const bytes = compileToTbcBytes(msg.payload.sourceText);
        const buf = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        const res: RespCompileOk = {
          version: PROTOCOL_VERSION,
          type: "response",
          requestId,
          ok: true,
          payload: { tbc: buf, diagnostics: [] },
        };
        return res;
      } catch (e) {
        return respErr(requestId, "CompileError", "compile failed", e);
      }
    }
    case "loadModule": {
      try {
        const bytes = new Uint8Array(msg.payload.tbc);
        moduleBytesByName.set(msg.payload.moduleName, new Uint8Array(bytes));
        engine.loadModule(msg.payload.moduleName, bytes);

        if (activeTrace) {
          // Keep trace metadata in sync.
          const b64 = bytesToBase64(bytes);
          const existing = activeTrace.modules.find(
            (m) => m.name === msg.payload.moduleName,
          );
          if (existing) existing.tbcBase64 = b64;
          else
            activeTrace.modules.push({
              name: msg.payload.moduleName,
              tbcBase64: b64,
            });
        }

        return respOk(requestId);
      } catch (e) {
        return respErr(requestId, "EngineError", "loadModule failed", e);
      }
    }
    case "createTask": {
      try {
        const entryFnIndex = msg.payload.entryFnIndex ?? 0;
        const domainId = msg.payload.domainId ?? 0;
        tasksByTid.set(msg.payload.tid, {
          tid: msg.payload.tid,
          moduleName: msg.payload.moduleName,
          entryFnIndex,
          domainId,
        });
        engine.createTask(
          msg.payload.tid,
          msg.payload.moduleName,
          entryFnIndex,
          domainId,
        );

        if (activeTrace) {
          const existing = activeTrace.tasks.find(
            (t) => t.tid === msg.payload.tid,
          );
          if (existing) {
            existing.moduleName = msg.payload.moduleName;
            existing.entryFnIndex = entryFnIndex;
            existing.domainId = domainId;
          } else {
            activeTrace.tasks.push({
              tid: msg.payload.tid,
              moduleName: msg.payload.moduleName,
              entryFnIndex,
              domainId,
            });
          }
        }

        return respOk(requestId);
      } catch (e) {
        return respErr(requestId, "EngineError", "createTask failed", e);
      }
    }
    case "setSchedulerPolicy": {
      try {
        schedulerPolicyModuleName = msg.payload.moduleName;
        engine.setSchedulerPolicy(msg.payload.moduleName);
        if (activeTrace) activeTrace.policy.moduleName = msg.payload.moduleName;
        return respOk(requestId);
      } catch (e) {
        return respErr(
          requestId,
          "EngineError",
          "setSchedulerPolicy failed",
          e,
        );
      }
    }
    case "inputKbd": {
      try {
        engine.inputKbd(msg.payload.byte, msg.payload.isDown);
        return respOk(requestId);
      } catch (e) {
        return respErr(requestId, "EngineError", "inputKbd failed", e);
      }
    }
    case "step": {
      try {
        engine.setPaused(false);
        const executed = engine.step(msg.payload.instructions);
        flushEngineEvents(engine);
        return respOk(requestId, { executed });
      } catch (e) {
        flushEngineEvents(engine);
        return respErr(requestId, "EngineError", "step failed", e);
      }
    }
    case "run": {
      if (isRunning) return respErr(requestId, "Busy", "already running");
      try {
        isRunning = true;
        engine.setPaused(false);
        const result = await runBatched(engine, {
          untilTick: msg.payload.untilTick,
          maxInstructions: msg.payload.maxInstructions,
        });
        flushEngineEvents(engine);
        return respOk(requestId, result);
      } catch (e) {
        flushEngineEvents(engine);
        return respErr(requestId, "EngineError", "run failed", e);
      } finally {
        isRunning = false;
      }
    }
    case "pause": {
      engine.setPaused(true);
      flushEngineEvents(engine);
      return respOk(requestId);
    }
    case "reset":
      engine.reset();
      lastClock = { tick: 0, cycle: "0" };
      moduleBytesByName.clear();
      tasksByTid.clear();
      schedulerPolicyModuleName = null;
      activeTrace = null;
      loadedTrace = null;
      lastSnapshotTick = null;
      isRunning = false;
      currentConfig = {
        cyclesPerTick: 10_000,
        timesliceTicks: 1,
        snapshotEveryTicks: 100,
        eventMask:
          EventMask.Console |
          EventMask.Tick |
          EventMask.TaskSwitch |
          EventMask.Perform |
          EventMask.Continuation |
          EventMask.InputConsumed |
          EventMask.PolicyPick |
          EventMask.Error,
      };
      flushEngineEvents(engine);
      return respOk(requestId);
    case "recordStart": {
      try {
        engine.recordStart();
        activeTrace = {
          version: "1.0",
          config: { ...currentConfig },
          modules: Array.from(moduleBytesByName.entries()).map(
            ([name, bytes]) => ({
              name,
              tbcBase64: bytesToBase64(bytes),
            }),
          ),
          tasks: Array.from(tasksByTid.values()).map((t) => ({ ...t })),
          policy: { moduleName: schedulerPolicyModuleName },
          events: [],
          output: [],
          snapshots: [],
        };
        lastSnapshotTick = null;
        takeSnapshotForTrace(engine);
        return respOk(requestId);
      } catch (e) {
        activeTrace = null;
        return respErr(requestId, "EngineError", "recordStart failed", e);
      }
    }
    case "recordStop": {
      engine.recordStop();
      flushEngineEvents(engine);
      return respOk(requestId);
    }
    case "getTrace": {
      if (!activeTrace) return respErr(requestId, "NoTrace", "no active trace");
      return respOk(requestId, {
        traceJsonText: JSON.stringify(activeTrace, null, 2),
      });
    }
    case "loadTrace": {
      try {
        const parsed = JSON.parse(msg.payload.traceJsonText) as unknown;
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          (parsed as { version?: unknown }).version !== "1.0"
        ) {
          return respErr(requestId, "BadTrace", "unsupported trace version");
        }
        loadedTrace = parsed as DeosTraceV1;
        return respOk(requestId);
      } catch (e) {
        return respErr(requestId, "BadTrace", "trace JSON parse failed", e);
      }
    }
    case "replayStart": {
      const trace = loadedTrace;
      if (!trace) return respErr(requestId, "NoTrace", "loadTrace first");
      try {
        engine.reset();
        engine.init(
          trace.config.cyclesPerTick,
          trace.config.timesliceTicks,
          trace.config.snapshotEveryTicks,
          trace.config.eventMask,
        );

        moduleBytesByName.clear();
        for (const m of trace.modules) {
          const bytes = base64ToBytes(m.tbcBase64);
          moduleBytesByName.set(m.name, bytes);
          engine.loadModule(m.name, bytes);
        }

        tasksByTid.clear();
        for (const t of trace.tasks) {
          tasksByTid.set(t.tid, { ...t });
          engine.createTask(t.tid, t.moduleName, t.entryFnIndex, t.domainId);
        }

        schedulerPolicyModuleName = trace.policy.moduleName;
        engine.setSchedulerPolicy(trace.policy.moduleName);

        engine.replayStart();

        const snap = trace.snapshots.at(0);
        if (snap) engine.loadSnapshotJson(snap.snapshotJson);

        const snapCycle = snap ? BigInt(snap.cycle) : 0n;
        for (const ev of trace.events) {
          const at = BigInt(ev.cycle);
          if (at <= snapCycle) continue;
          engine.scheduleKbd(at, ev.byte, ev.isDown);
        }

        flushEngineEvents(engine);
        return respOk(requestId);
      } catch (e) {
        flushEngineEvents(engine);
        return respErr(requestId, "ReplayError", "replayStart failed", e);
      }
    }
    case "replayStop": {
      engine.replayStop();
      flushEngineEvents(engine);
      return respOk(requestId);
    }
    case "reverseToTick": {
      const trace = loadedTrace ?? activeTrace;
      if (!trace) return respErr(requestId, "NoTrace", "no trace available");

      try {
        const targetTick = msg.payload.tick;
        const snaps = trace.snapshots
          .filter((s) => s.tick <= targetTick)
          .sort((a, b) => b.tick - a.tick);
        const snap = snaps.at(0) ?? trace.snapshots.at(0) ?? null;
        if (!snap)
          return respErr(requestId, "NoSnapshot", "no snapshot available");

        engine.reset();
        engine.init(
          trace.config.cyclesPerTick,
          trace.config.timesliceTicks,
          trace.config.snapshotEveryTicks,
          trace.config.eventMask,
        );

        for (const m of trace.modules) {
          const bytes = base64ToBytes(m.tbcBase64);
          engine.loadModule(m.name, bytes);
        }
        for (const t of trace.tasks) {
          engine.createTask(t.tid, t.moduleName, t.entryFnIndex, t.domainId);
        }
        engine.setSchedulerPolicy(trace.policy.moduleName);
        engine.replayStart();
        engine.loadSnapshotJson(snap.snapshotJson);

        const snapCycle = BigInt(snap.cycle);
        for (const ev of trace.events) {
          const at = BigInt(ev.cycle);
          if (at <= snapCycle) continue;
          engine.scheduleKbd(at, ev.byte, ev.isDown);
        }

        engine.setPaused(false);
        engine.runUntilTick(targetTick, 5_000_000);
        engine.setPaused(true);

        flushEngineEvents(engine);
        return respOk(requestId);
      } catch (e) {
        flushEngineEvents(engine);
        return respErr(requestId, "EngineError", "reverseToTick failed", e);
      }
    }
    case "runSampleSuite": {
      if (isSuiteRunning)
        return respErr(requestId, "Busy", "sample suite is running");

      const prevForward = forwardEngineEventsToUi;
      isSuiteRunning = true;
      forwardEngineEventsToUi = false;
      try {
        const result = await runSampleSuite(engine, msg.payload);
        return respOk(requestId, result);
      } catch (e: unknown) {
        return respErr(requestId, "SuiteError", "runSampleSuite failed", e);
      } finally {
        forwardEngineEventsToUi = prevForward;
        isSuiteRunning = false;
      }
    }
    case "getState": {
      try {
        const jsonText = engine.getStateJson(msg.payload.detail);
        return respOk(requestId, { jsonText });
      } catch (e) {
        return respErr(requestId, "EngineError", "getState failed", e);
      }
    }
    default:
      return respErr(
        requestId,
        "BadRequest",
        `Unknown command ${(msg as { command?: unknown }).command as string}`,
      );
  }
}

self.onmessage = async (ev: MessageEvent<unknown>) => {
  const msg = ev.data;
  if (!isCommandMessage(msg)) return;
  if (msg.version !== PROTOCOL_VERSION) {
    const requestId =
      typeof (msg as { requestId?: unknown }).requestId === "string"
        ? (msg as { requestId: string }).requestId
        : "missing";
    self.postMessage(
      respErr(
        requestId,
        "VersionMismatch",
        `Expected version ${PROTOCOL_VERSION}`,
        { got: (msg as { version?: unknown }).version },
      ),
    );
    return;
  }

  const res = await handleCommand(msg as unknown as CommandMessage);
  self.postMessage(res);
};
