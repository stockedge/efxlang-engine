import { Lexer } from "@core/lang/lexer";
import { Parser } from "@core/lang/parser";
import { Resolver } from "@core/lang/resolver";
import { Codegen } from "@core/lang/codegen";
import { TBCEncoder } from "@core/bytecode/bin";
import { DeosEngine } from "./engine/deos_engine";
import { base64ToBytes, bytesToBase64 } from "./engine/base64";
import type { DeosTraceV1 } from "./engine/trace_format";
import {
  EventMask,
  isCommandMessage,
  PROTOCOL_VERSION,
  type CommandMessage,
  type DeosUiEvent,
  type RespCompileOk,
  type RespErr,
  type RespOk,
  type UiEventMessage,
} from "./protocol";

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

const engine = new DeosEngine();

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

function postUiEvent(event: DeosUiEvent) {
  const msg: UiEventMessage = {
    version: PROTOCOL_VERSION,
    type: "event",
    event,
  };
  self.postMessage(msg);
}

function flushEngineEvents() {
  for (;;) {
    const json = engine.pollEventJson();
    if (!json) break;
    const ev = JSON.parse(json) as DeosUiEvent;
    postUiEvent(ev);
    if (activeTrace) maybeRecordEvent(ev);
  }
}

function takeSnapshotForTrace() {
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

function maybeRecordEvent(ev: DeosUiEvent) {
  if (!activeTrace) return;
  if (ev.type === "inputConsumed") activeTrace.events.push(ev);
  if (ev.type === "console") activeTrace.output.push(ev);

  if (ev.type === "tick") {
    lastSnapshotTick ??= ev.tick;
    if (ev.tick - lastSnapshotTick >= activeTrace.config.snapshotEveryTicks) {
      takeSnapshotForTrace();
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

async function runBatched(opts: {
  untilTick?: number;
  maxInstructions?: number;
}) {
  const maxInstructions = opts.maxInstructions ?? 5_000_000;
  let remaining = Math.max(0, Math.floor(maxInstructions));

  while (!engine.getPaused()) {
    if (
      opts.untilTick !== undefined &&
      engine.getClock().tick >= opts.untilTick
    )
      break;
    if (remaining <= 0) return { hitMaxInstructions: true };

    const batch = Math.min(50_000, remaining);
    const executed = engine.step(batch);
    remaining -= executed;
    flushEngineEvents();

    if (executed === 0) break;
    // Yield to allow pause/message handling.
    await new Promise((r) => setTimeout(r, 0));
  }

  return { hitMaxInstructions: false };
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
        flushEngineEvents();
        return respOk(requestId, { executed });
      } catch (e) {
        flushEngineEvents();
        return respErr(requestId, "EngineError", "step failed", e);
      }
    }
    case "run": {
      if (isRunning) return respErr(requestId, "Busy", "already running");
      try {
        isRunning = true;
        engine.setPaused(false);
        const result = await runBatched({
          untilTick: msg.payload.untilTick,
          maxInstructions: msg.payload.maxInstructions,
        });
        flushEngineEvents();
        return respOk(requestId, result);
      } catch (e) {
        flushEngineEvents();
        return respErr(requestId, "EngineError", "run failed", e);
      } finally {
        isRunning = false;
      }
    }
    case "pause": {
      engine.setPaused(true);
      flushEngineEvents();
      return respOk(requestId);
    }
    case "reset":
      engine.reset();
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
      flushEngineEvents();
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
        takeSnapshotForTrace();
        return respOk(requestId);
      } catch (e) {
        activeTrace = null;
        return respErr(requestId, "EngineError", "recordStart failed", e);
      }
    }
    case "recordStop": {
      engine.recordStop();
      flushEngineEvents();
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

        flushEngineEvents();
        return respOk(requestId);
      } catch (e) {
        flushEngineEvents();
        return respErr(requestId, "ReplayError", "replayStart failed", e);
      }
    }
    case "replayStop": {
      engine.replayStop();
      flushEngineEvents();
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

        flushEngineEvents();
        return respOk(requestId);
      } catch (e) {
        flushEngineEvents();
        return respErr(requestId, "EngineError", "reverseToTick failed", e);
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
