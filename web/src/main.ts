import "./styles.css";

import {
  type DeosUiEvent,
  EventMask,
  PROTOCOL_VERSION,
  type WorkerMessage,
} from "./protocol";
import {
  type SampleDefinition,
  type SampleRunnerConfig,
  samples,
} from "./samples";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

app.innerHTML = `
  <div class="app">
    <div class="topbar">
      <div class="brand">
        <strong>DEOS Browser</strong>
        <span class="pill mono" id="status">Booting…</span>
        <span class="mono" id="clock"></span>
      </div>

      <div class="toolbar">
        <div class="group">
          <button class="btn" id="runAllSamples">Run All Samples</button>
          <span class="pill mono" id="samplesStatus">Samples: ready</span>
        </div>

        <div class="group">
          <button class="btn" id="run">Run</button>
          <button class="btn secondary" id="pause">Pause</button>
          <button class="btn secondary" id="step">Step</button>
          <input class="input mono" id="stepN" value="1000" />
          <button class="btn secondary" id="stepRun">Step xN</button>
        </div>

        <div class="group">
          <input class="input mono" id="runToTick" placeholder="Run to tick" />
          <button class="btn secondary" id="runTo">Run to tick</button>
          <input class="input mono" id="revToTick" placeholder="Reverse to tick" />
          <button class="btn secondary" id="revTo">Reverse</button>
          <button class="btn secondary" id="reset">Reset</button>
        </div>

        <div class="group">
          <button class="btn secondary" id="recordStart">Record Start</button>
          <button class="btn secondary" id="recordStop">Record Stop</button>
          <button class="btn secondary" id="downloadTrace">Download Trace</button>
        </div>

        <div class="group">
          <input type="file" id="traceFile" accept=".json" />
          <button class="btn secondary" id="replayStart">Replay Start</button>
          <button class="btn secondary" id="replayStop">Replay Stop</button>
        </div>
      </div>
    </div>

    <div class="main">
      <div class="pane" id="left">
        <div class="tabs">
          <button class="tab active" data-tab="prog">Program</button>
          <button class="tab" data-tab="policy">Scheduler Policy</button>
          <button class="tab" data-tab="samples">Samples</button>
        </div>

        <div class="tabpanel active" id="tab-prog">
          <div class="panel">
            <div class="row">
              <label class="mono">Module</label>
              <input class="input mono" id="progModule" value="progA" />
              <button class="btn secondary" id="compileProg">Compile & Load</button>
            </div>
            <textarea class="textarea mono" id="progSrc"></textarea>
            <div class="row">
              <label class="mono">Create Task</label>
              <input class="input mono" id="taskTid" value="1" />
              <input class="input mono" id="taskModule" value="progA" />
              <button class="btn secondary" id="createTask">Create</button>
            </div>
          </div>
        </div>

        <div class="tabpanel" id="tab-policy">
          <div class="panel">
            <div class="row">
              <label class="mono">Module</label>
              <input class="input mono" id="policyModule" value="sched" />
              <button class="btn secondary" id="compilePolicy">Compile & Load</button>
              <button class="btn secondary" id="setPolicy">Set Policy</button>
              <button class="btn secondary" id="clearPolicy">Clear Policy</button>
            </div>
            <textarea class="textarea mono" id="policySrc"></textarea>
          </div>
        </div>

        <div class="tabpanel" id="tab-samples">
          <div class="panel">
            <div class="row">
              <span class="mono">Click a sample to load/run.</span>
              <button class="btn secondary" id="clearSampleResults">Clear Results</button>
            </div>
            <div class="cards" id="sampleCards"></div>
            <div class="sample-results mono" id="sampleResults"></div>
          </div>
        </div>
      </div>

      <div class="pane" id="right">
        <div class="tabs">
          <button class="tab active" data-rtab="timeline">Timeline</button>
          <button class="tab" data-rtab="state">State</button>
          <button class="tab" data-rtab="trace">Trace</button>
        </div>

        <div class="tabpanel active" id="rtab-timeline">
          <div class="panel">
            <div class="row">
              <label class="mono"><input type="checkbox" id="followTick" checked /> Follow</label>
              <button class="btn secondary" id="clearTimeline">Clear</button>
            </div>
            <div class="timeline mono" id="timeline"></div>
          </div>
        </div>

        <div class="tabpanel" id="rtab-state">
          <div class="panel">
            <div class="row">
              <button class="btn secondary" id="refreshState">Refresh</button>
              <button class="btn secondary" id="refreshStateFull">Full</button>
            </div>
            <pre class="pre mono" id="state"></pre>
          </div>
        </div>

        <div class="tabpanel" id="rtab-trace">
          <div class="panel">
            <pre class="pre mono" id="traceInfo">(trace info)</pre>
          </div>
        </div>
      </div>
    </div>

    <div class="console">
      <div class="consolebar">
        <label class="mono"><input type="checkbox" id="autoScroll" checked /> Auto-scroll</label>
        <button class="btn secondary" id="clearConsole">Clear</button>
      </div>
      <div class="consolebody mono" id="console"></div>
    </div>
  </div>
`;

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

const statusEl = $("status") as HTMLSpanElement;
const samplesStatusEl = $("samplesStatus") as HTMLSpanElement;
const clockEl = $("clock") as HTMLSpanElement;
const consoleEl = $("console") as HTMLDivElement;
const timelineEl = $("timeline") as HTMLDivElement;
const stateEl = $("state") as HTMLPreElement;
const traceInfoEl = $("traceInfo") as HTMLPreElement;
const sampleCardsEl = $("sampleCards") as HTMLDivElement;
const sampleResultsEl = $("sampleResults") as HTMLDivElement;

const followTickEl = $("followTick") as HTMLInputElement;
const autoScrollEl = $("autoScroll") as HTMLInputElement;

const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});

type UiMode = "Idle" | "Running" | "Paused" | "Recording" | "Replay";
let uiMode: UiMode = "Idle";

const pending = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: unknown) => void }
>();

const engineEventSubscribers = new Set<(ev: DeosUiEvent) => void>();

worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
  const msg = ev.data;
  if (msg.type === "response") {
    const cb = pending.get(msg.requestId);
    if (!cb) return;
    pending.delete(msg.requestId);
    if (msg.ok) cb.resolve(msg.payload);
    else cb.reject(msg.error);
    return;
  }
  onEngineEvent(msg.event);
};

function sendCommand(
  command: string,
  payload?: Record<string, unknown>,
): Promise<unknown> {
  const requestId = crypto.randomUUID();
  const msg = {
    version: PROTOCOL_VERSION,
    type: "command",
    command,
    ...(payload ? { payload } : {}),
    requestId,
  };
  worker.postMessage(msg);
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
  });
}

function setUiMode(next: UiMode) {
  uiMode = next;
  statusEl.textContent = next;
}

function formatCycleShort(cycle: string) {
  if (cycle.length <= 10) return cycle;
  return `${cycle.slice(0, 4)}…${cycle.slice(-4)}`;
}

function updateClock(cycle: string, tick: number) {
  clockEl.textContent = `tick=${String(tick)} cycle=${formatCycleShort(cycle)}`;
}

function appendConsoleLine(text: string) {
  consoleEl.textContent += text;
  if (autoScrollEl.checked) consoleEl.scrollTop = consoleEl.scrollHeight;
}

function appendTimelineLine(line: string, tick?: number, kind?: string) {
  const div = document.createElement("div");
  div.className = kind ? `timeline-row kind-${kind}` : "timeline-row";
  div.textContent = line;
  if (typeof tick === "number") {
    div.dataset.tick = String(tick);
    div.onclick = () => {
      const input = document.querySelector<HTMLInputElement>("#revToTick");
      if (input) input.value = String(tick);
    };
  }
  timelineEl.appendChild(div);
  if (followTickEl.checked) timelineEl.scrollTop = timelineEl.scrollHeight;
}

function onEngineEvent(ev: DeosUiEvent) {
  for (const cb of engineEventSubscribers) cb(ev);

  if ("cycle" in ev && "tick" in ev) updateClock(ev.cycle, ev.tick);

  if (ev.type === "console") {
    appendConsoleLine(ev.text);
    return;
  }

  switch (ev.type) {
    case "tick":
      appendTimelineLine(
        `tick ${String(ev.tick)} @${formatCycleShort(ev.cycle)}`,
        ev.tick,
        ev.type,
      );
      return;
    case "taskSwitch":
      appendTimelineLine(
        `taskSwitch ${String(ev.fromTid)}->${String(ev.toTid)} (${ev.reason}) tick=${String(ev.tick)} @${formatCycleShort(
          ev.cycle,
        )}`,
        ev.tick,
        ev.type,
      );
      return;
    case "perform":
      appendTimelineLine(
        `perform ${ev.effect} argc=${String(ev.argc)} tid=${String(ev.tid)} tick=${String(ev.tick)} @${formatCycleShort(
          ev.cycle,
        )}`,
        ev.tick,
        ev.type,
      );
      return;
    case "contCall":
      appendTimelineLine(
        `contCall tid=${String(ev.tid)} usedBefore=${String(ev.oneShotUsedBefore)} tick=${String(ev.tick)} @${formatCycleShort(
          ev.cycle,
        )}`,
        ev.tick,
        ev.type,
      );
      return;
    case "contReturn":
      appendTimelineLine(
        `contReturn tid=${String(ev.tid)} tick=${String(ev.tick)} @${formatCycleShort(ev.cycle)}`,
        ev.tick,
        ev.type,
      );
      return;
    case "inputConsumed":
      appendTimelineLine(
        `inputConsumed byte=${String(ev.byte)} isDown=${String(ev.isDown)} tick=${String(ev.tick)} @${formatCycleShort(
          ev.cycle,
        )}`,
        ev.tick,
        ev.type,
      );
      return;
    case "policyPick":
      appendTimelineLine(
        `policyPick idx=${String(ev.pickedIndex)} runnable=[${ev.runnableTids.join(
          ",",
        )}] tick=${String(ev.tick)} @${formatCycleShort(ev.cycle)}`,
        ev.tick,
        ev.type,
      );
      return;
    case "error":
      appendTimelineLine(
        `error ${ev.code}: ${ev.message} tick=${String(ev.tick)} @${formatCycleShort(ev.cycle)}`,
        ev.tick,
        ev.type,
      );
      return;
  }
}

async function refreshState(detail: "summary" | "full") {
  try {
    const payload = (await sendCommand("getState", { detail })) as {
      jsonText?: string;
    };
    stateEl.textContent = payload.jsonText ?? "(no state)";
  } catch (e: unknown) {
    stateEl.textContent = `getState error: ${JSON.stringify(e)}`;
  }
}

function bindLeftTabs() {
  const root = $("left") as HTMLDivElement;
  const buttons = Array.from(
    root.querySelectorAll<HTMLButtonElement>(".tab[data-tab]"),
  );
  const panels = Array.from(
    root.querySelectorAll<HTMLDivElement>(".tabpanel[id^=tab-]"),
  );

  for (const b of buttons) {
    b.onclick = () => {
      const key = b.dataset.tab;
      if (!key) return;
      for (const other of buttons) other.classList.remove("active");
      b.classList.add("active");
      for (const p of panels) p.classList.remove("active");
      const panel = root.querySelector<HTMLDivElement>(`#tab-${key}`);
      if (panel) panel.classList.add("active");
    };
  }
}

function bindRightTabs() {
  const root = $("right") as HTMLDivElement;
  const buttons = Array.from(
    root.querySelectorAll<HTMLButtonElement>(".tab[data-rtab]"),
  );
  const panels = Array.from(
    root.querySelectorAll<HTMLDivElement>(".tabpanel[id^=rtab-]"),
  );

  for (const b of buttons) {
    b.onclick = () => {
      const key = b.dataset.rtab;
      if (!key) return;
      for (const other of buttons) other.classList.remove("active");
      b.classList.add("active");
      for (const p of panels) p.classList.remove("active");
      const panel = root.querySelector<HTMLDivElement>(`#rtab-${key}`);
      if (panel) panel.classList.add("active");
    };
  }
}

bindLeftTabs();
bindRightTabs();

const DEFAULT_ENGINE_CONFIG: SampleRunnerConfig = {
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

type SampleCardUi = {
  sample: SampleDefinition;
  statusDot: HTMLSpanElement;
  statusText: HTMLSpanElement;
  signalByKey: Map<string, HTMLSpanElement>;
  runBtn: HTMLButtonElement;
  loadBtn: HTMLButtonElement;
};

const sampleCardUiById = new Map<string, SampleCardUi>();

function setSamplesStatus(
  text: string,
  tone: "ready" | "running" | "ok" | "err" = "ready",
) {
  samplesStatusEl.textContent = text;
  samplesStatusEl.dataset.tone = tone;
}

function setSampleCardStatus(
  sampleId: string,
  state: "idle" | "running" | "ok" | "err",
  text: string,
) {
  const ui = sampleCardUiById.get(sampleId);
  if (!ui) return;
  ui.statusDot.dataset.state = state;
  ui.statusText.textContent = text;
}

function appendSampleResult(
  sample: SampleDefinition,
  ms: number,
  ok: boolean,
  summary: string,
  details?: string,
) {
  const root = document.createElement("details");
  root.className = ok ? "result ok" : "result err";
  root.open = !ok;

  const s = document.createElement("summary");
  const tag = ok ? "OK" : "FAIL";
  s.textContent = `${tag} ${sample.title} (${String(Math.round(ms))}ms) - ${summary}`;
  root.appendChild(s);

  if (details) {
    const pre = document.createElement("pre");
    pre.className = "result-details mono";
    pre.textContent = details;
    root.appendChild(pre);
  }

  sampleResultsEl.appendChild(root);
}

function activateLeftTab(key: string) {
  const root = $("left") as HTMLDivElement;
  const btn = root.querySelector<HTMLButtonElement>(`.tab[data-tab="${key}"]`);
  btn?.click();
}

function loadModuleIntoEditor(
  moduleName: string,
  sourceText: string,
  role: "program" | "policy",
) {
  if (role === "program") {
    ($("progModule") as HTMLInputElement).value = moduleName;
    ($("progSrc") as HTMLTextAreaElement).value = sourceText;
    activateLeftTab("prog");
    return;
  }
  ($("policyModule") as HTMLInputElement).value = moduleName;
  ($("policySrc") as HTMLTextAreaElement).value = sourceText;
  activateLeftTab("policy");
}

function setSampleSignal(sampleId: string, key: string, on: boolean) {
  const ui = sampleCardUiById.get(sampleId);
  if (!ui) return;
  const el = ui.signalByKey.get(key);
  if (!el) return;
  el.dataset.state = on ? "on" : "off";
}

function setSampleSignalsFromEvents(sampleId: string, events: DeosUiEvent[]) {
  setSampleSignal(
    sampleId,
    "task",
    events.some((e) => e.type === "taskSwitch"),
  );
  setSampleSignal(
    sampleId,
    "perform",
    events.some((e) => e.type === "perform"),
  );
  setSampleSignal(
    sampleId,
    "policy",
    events.some((e) => e.type === "policyPick"),
  );
  setSampleSignal(
    sampleId,
    "input",
    events.some((e) => e.type === "inputConsumed"),
  );
  setSampleSignal(
    sampleId,
    "error",
    events.some((e) => e.type === "error"),
  );
}

function renderSampleCards() {
  sampleCardsEl.textContent = "";
  sampleCardUiById.clear();

  for (const sample of samples) {
    const card = document.createElement("div");
    card.className = "card";

    const header = document.createElement("div");
    header.className = "card-header";

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = sample.title;

    const status = document.createElement("div");
    status.className = "card-status";
    const dot = document.createElement("span");
    dot.className = "status-dot";
    dot.dataset.state = "idle";
    const statusText = document.createElement("span");
    statusText.className = "mono";
    statusText.textContent = "idle";
    status.append(dot, statusText);

    header.append(title, status);

    const desc = document.createElement("div");
    desc.className = "card-desc";
    desc.textContent = sample.description;

    const tags = document.createElement("div");
    tags.className = "badges";
    for (const t of sample.tags) {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = t;
      tags.appendChild(b);
    }

    const meta = document.createElement("div");
    meta.className = "card-meta mono";
    meta.textContent = `tasks: ${sample.tasks.map((t) => `${String(t.tid)}->${t.moduleName}`).join(", ")}`;

    const signals = document.createElement("div");
    signals.className = "signals";

    const signalByKey = new Map<string, HTMLSpanElement>();
    const defs: Array<{ key: string; label: string; title: string }> = [
      { key: "task", label: "TS", title: "taskSwitch" },
      { key: "perform", label: "PF", title: "perform" },
      { key: "policy", label: "PL", title: "policyPick" },
      { key: "input", label: "IN", title: "inputConsumed" },
      { key: "error", label: "ER", title: "error" },
    ];
    for (const d of defs) {
      const el = document.createElement("span");
      el.className = "signal mono";
      el.dataset.key = d.key;
      el.dataset.state = "off";
      el.title = d.title;
      el.textContent = d.label;
      signalByKey.set(d.key, el);
      signals.appendChild(el);
    }

    const modules = document.createElement("div");
    modules.className = "modules";

    for (const m of sample.modules) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "module-chip mono";
      btn.textContent = `${m.moduleName}${m.role === "policy" ? " (policy)" : ""}`;
      btn.onclick = () => {
        loadModuleIntoEditor(m.moduleName, m.sourceText, m.role);
      };
      modules.appendChild(btn);
    }

    const actions = document.createElement("div");
    actions.className = "row";

    const loadBtn = document.createElement("button");
    loadBtn.className = "btn secondary";
    loadBtn.textContent = "Load";
    loadBtn.onclick = () => {
      const firstProg =
        sample.modules.find((m) => m.role === "program") ?? null;
      if (firstProg)
        loadModuleIntoEditor(
          firstProg.moduleName,
          firstProg.sourceText,
          "program",
        );
      const firstPolicy =
        sample.modules.find((m) => m.role === "policy") ?? null;
      if (firstPolicy)
        loadModuleIntoEditor(
          firstPolicy.moduleName,
          firstPolicy.sourceText,
          "policy",
        );
      const firstTask = sample.tasks.at(0) ?? null;
      if (firstTask) {
        ($("taskTid") as HTMLInputElement).value = String(firstTask.tid);
        ($("taskModule") as HTMLInputElement).value = firstTask.moduleName;
      }
    };

    const runBtn = document.createElement("button");
    runBtn.className = "btn";
    runBtn.textContent = "Run";
    runBtn.onclick = () => {
      void runSamples([sample]);
    };

    actions.append(loadBtn, runBtn);

    card.append(header, desc, tags, meta, signals, modules, actions);
    sampleCardsEl.appendChild(card);

    sampleCardUiById.set(sample.id, {
      sample,
      statusDot: dot,
      statusText,
      signalByKey,
      runBtn,
      loadBtn,
    });
  }
}

let sampleRunnerBusy = false;

function setSampleRunnerBusy(busy: boolean) {
  ($("runAllSamples") as HTMLButtonElement).disabled = busy;
  ($("clearSampleResults") as HTMLButtonElement).disabled = busy;
  for (const ui of sampleCardUiById.values()) {
    ui.runBtn.disabled = busy;
    ui.loadBtn.disabled = busy;
  }
}

const sampleRunnerApi = {
  async reset() {
    await sendCommand("reset");
  },
  async init(cfg?: Partial<SampleRunnerConfig>) {
    const merged = { ...DEFAULT_ENGINE_CONFIG, ...(cfg ?? {}) };
    await sendCommand("init", merged);
  },
  async compileAndLoad(moduleName: string, sourceText: string) {
    const payload = (await sendCommand("compile", {
      sourceName: `${moduleName}.efx`,
      sourceText,
    })) as { tbc?: ArrayBuffer };
    const tbc = payload.tbc;
    if (!tbc) throw new Error("compile returned no tbc");
    await sendCommand("loadModule", { moduleName, tbc });
  },
  async createTask(
    tid: number,
    moduleName: string,
    entryFnIndex?: number,
    domainId?: number,
  ) {
    const payload: Record<string, unknown> = { tid, moduleName };
    if (entryFnIndex !== undefined) payload.entryFnIndex = entryFnIndex;
    if (domainId !== undefined) payload.domainId = domainId;
    await sendCommand("createTask", payload);
  },
  async setSchedulerPolicy(moduleName: string | null) {
    await sendCommand("setSchedulerPolicy", { moduleName });
  },
  async inputKbd(byte: number, isDown: boolean) {
    await sendCommand("inputKbd", { byte, isDown });
  },
  async run(opts?: { untilTick?: number; maxInstructions?: number }) {
    await sendCommand("run", {
      ...(opts?.untilTick !== undefined ? { untilTick: opts.untilTick } : {}),
      maxInstructions: opts?.maxInstructions ?? 5_000_000,
    });
  },
  async recordStart() {
    await sendCommand("recordStart");
  },
  async recordStop() {
    await sendCommand("recordStop");
  },
  async getTraceJsonText() {
    const payload = (await sendCommand("getTrace")) as {
      traceJsonText?: string;
    };
    return payload.traceJsonText ?? "";
  },
  async loadTraceJsonText(traceJsonText: string) {
    await sendCommand("loadTrace", { traceJsonText });
  },
  async replayStart() {
    await sendCommand("replayStart");
  },
  async replayStop() {
    await sendCommand("replayStop");
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

async function runSamples(list: SampleDefinition[]) {
  if (sampleRunnerBusy) return;

  sampleRunnerBusy = true;
  setSampleRunnerBusy(true);
  sampleResultsEl.textContent = "";

  try {
    let passCount = 0;
    let failCount = 0;
    setSamplesStatus(
      `Samples: running 0/${String(list.length)} (PASS ${String(passCount)} / FAIL ${String(failCount)})`,
      "running",
    );
    activateLeftTab("samples");
    appendTimelineLine(
      `=== samples: run ${String(list.length)} ===`,
      undefined,
      "meta",
    );

    for (let i = 0; i < list.length; i++) {
      const sample = list[i];
      setSampleCardStatus(sample.id, "running", "running…");
      appendTimelineLine(`--- sample: ${sample.title} ---`, undefined, "meta");
      appendConsoleLine(`\n=== sample: ${sample.title} ===\n`);

      const runEvents: DeosUiEvent[] = [];
      const listener = (ev: DeosUiEvent) => {
        runEvents.push(ev);
      };
      engineEventSubscribers.add(listener);

      const t0 = performance.now();
      try {
        const res = await sample.run(sampleRunnerApi);
        const ms = performance.now() - t0;
        if (res.ok) passCount += 1;
        else failCount += 1;
        setSampleCardStatus(
          sample.id,
          res.ok ? "ok" : "err",
          res.ok ? "ok" : "failed",
        );
        appendSampleResult(sample, ms, res.ok, res.summary, res.details);
      } catch (e: unknown) {
        const ms = performance.now() - t0;
        failCount += 1;
        setSampleCardStatus(sample.id, "err", "failed");
        appendSampleResult(sample, ms, false, "exception", JSON.stringify(e));
      } finally {
        engineEventSubscribers.delete(listener);
        setSampleSignalsFromEvents(sample.id, runEvents);
        setSamplesStatus(
          `Samples: running ${String(i + 1)}/${String(list.length)} (PASS ${String(passCount)} / FAIL ${String(failCount)})`,
          failCount > 0 ? "err" : "running",
        );
      }
    }

    setSamplesStatus(
      `Samples: done (PASS ${String(passCount)} / FAIL ${String(failCount)})`,
      failCount > 0 ? "err" : "ok",
    );
  } finally {
    sampleRunnerBusy = false;
    setSampleRunnerBusy(false);
  }
}

renderSampleCards();
setSamplesStatus("Samples: ready", "ready");

($("runAllSamples") as HTMLButtonElement).onclick = () => {
  void runSamples(samples);
};
($("clearSampleResults") as HTMLButtonElement).onclick = () => {
  sampleResultsEl.textContent = "";
  for (const ui of sampleCardUiById.values())
    setSampleCardStatus(ui.sample.id, "idle", "idle");
  setSamplesStatus("Samples: ready", "ready");
};

// Defaults
const progSrcEl = $("progSrc") as HTMLTextAreaElement;
progSrcEl.value = `// Example: timeslice switching (no yield)\n// 1) Compile as module 'progA' (prints 'A')\n// 2) Change 65 -> 66, set module 'progB' (prints 'B'), compile\n// 3) Create tasks: tid=1 module=progA, tid=2 module=progB\n// 4) Run to tick (e.g. 20) and watch taskSwitch reason=timeslice\n+\n+let burn = fun(n) => {\n+  if (n < 2000) { burn(n + 1) } else { 0 }\n+};\n+\n+let loop = fun(ch) => {\n+  burn(0);\n+  putc(ch);\n+  loop(ch)\n+};\n+\n+loop(65);\n`;

const policySrcEl = $("policySrc") as HTMLTextAreaElement;
policySrcEl.value = `// Policy must return a closure with arity 5.\n// Args: (nowTick, currentTid, currentIndex, runnableCount, domainId)\nlet pick = fun(nowTick, currentTid, currentIndex, runnableCount, domainId) => {\n  // reverse round-robin\n  (currentIndex + runnableCount - 1) % runnableCount\n};\n// Leave the closure as the program result:\npick;\n`;

// TopBar actions
($("run") as HTMLButtonElement).onclick = async () => {
  setUiMode(uiMode === "Replay" ? "Replay" : "Running");
  await sendCommand("run", { maxInstructions: 5_000_000 }).catch(
    (e: unknown) => {
      appendTimelineLine(`run error: ${JSON.stringify(e)}`);
    },
  );
  setUiMode("Paused");
  await refreshState("summary");
};

($("pause") as HTMLButtonElement).onclick = async () => {
  await sendCommand("pause").catch((e: unknown) => {
    appendTimelineLine(`pause error: ${JSON.stringify(e)}`);
  });
  setUiMode("Paused");
  await refreshState("summary");
};

($("step") as HTMLButtonElement).onclick = async () => {
  await sendCommand("step", { instructions: 1 }).catch((e: unknown) => {
    appendTimelineLine(`step error: ${JSON.stringify(e)}`);
  });
  setUiMode("Paused");
  await refreshState("full");
};

($("stepRun") as HTMLButtonElement).onclick = async () => {
  const n = Number((($("stepN") as HTMLInputElement).value || "0").trim());
  await sendCommand("step", { instructions: Number.isFinite(n) ? n : 0 }).catch(
    (e: unknown) => {
      appendTimelineLine(`step error: ${JSON.stringify(e)}`);
    },
  );
  setUiMode("Paused");
  await refreshState("full");
};

($("runTo") as HTMLButtonElement).onclick = async () => {
  const t = Number((($("runToTick") as HTMLInputElement).value || "0").trim());
  setUiMode("Running");
  await sendCommand("run", {
    untilTick: Number.isFinite(t) ? t : 0,
    maxInstructions: 5_000_000,
  }).catch((e: unknown) => {
    appendTimelineLine(`runToTick error: ${JSON.stringify(e)}`);
  });
  setUiMode("Paused");
  await refreshState("summary");
};

($("revTo") as HTMLButtonElement).onclick = async () => {
  const t = Number((($("revToTick") as HTMLInputElement).value || "0").trim());
  await sendCommand("reverseToTick", {
    tick: Number.isFinite(t) ? t : 0,
  }).catch((e: unknown) => {
    appendTimelineLine(`reverseToTick error: ${JSON.stringify(e)}`);
  });
  setUiMode("Paused");
  await refreshState("full");
};

($("reset") as HTMLButtonElement).onclick = async () => {
  await sendCommand("reset").catch((e: unknown) => {
    appendTimelineLine(`reset error: ${JSON.stringify(e)}`);
  });
  consoleEl.textContent = "";
  timelineEl.textContent = "";
  stateEl.textContent = "";
  traceInfoEl.textContent = "(trace info)";
  updateClock("0", 0);
  setUiMode("Idle");
};

// Record / Trace controls
($("recordStart") as HTMLButtonElement).onclick = async () => {
  await sendCommand("recordStart").catch((e: unknown) => {
    appendTimelineLine(`recordStart error: ${JSON.stringify(e)}`);
  });
  setUiMode("Recording");
};
($("recordStop") as HTMLButtonElement).onclick = async () => {
  await sendCommand("recordStop").catch((e: unknown) => {
    appendTimelineLine(`recordStop error: ${JSON.stringify(e)}`);
  });
  setUiMode("Paused");
};
($("downloadTrace") as HTMLButtonElement).onclick = async () => {
  try {
    const payload = (await sendCommand("getTrace")) as {
      traceJsonText?: string;
    };
    const jsonText = payload.traceJsonText ?? "";
    traceInfoEl.textContent = jsonText
      ? `(trace loaded)\n${jsonText.slice(0, 8000)}`
      : "(no trace)";
    const blob = new Blob([jsonText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "trace.deos.json";
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    appendTimelineLine(`getTrace error: ${JSON.stringify(e)}`);
  }
};

// Replay controls
($("traceFile") as HTMLInputElement).onchange = async (ev) => {
  const input = ev.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const text = await file.text();
  await sendCommand("loadTrace", { traceJsonText: text }).catch(
    (e: unknown) => {
      appendTimelineLine(`loadTrace error: ${JSON.stringify(e)}`);
    },
  );
  traceInfoEl.textContent = `(trace loaded)\n${text.slice(0, 8000)}`;
};

($("replayStart") as HTMLButtonElement).onclick = async () => {
  await sendCommand("replayStart").catch((e: unknown) => {
    appendTimelineLine(`replayStart error: ${JSON.stringify(e)}`);
  });
  setUiMode("Replay");
  await refreshState("summary");
};
($("replayStop") as HTMLButtonElement).onclick = async () => {
  await sendCommand("replayStop").catch((e: unknown) => {
    appendTimelineLine(`replayStop error: ${JSON.stringify(e)}`);
  });
  setUiMode("Paused");
  await refreshState("summary");
};

// Editor actions
($("compileProg") as HTMLButtonElement).onclick = async () => {
  const moduleName = (
    ($("progModule") as HTMLInputElement).value || "progA"
  ).trim();
  const sourceText = progSrcEl.value;
  try {
    const payload = (await sendCommand("compile", {
      sourceName: `${moduleName}.efx`,
      sourceText,
    })) as { tbc?: ArrayBuffer };
    const tbc = payload.tbc;
    if (!tbc) throw new Error("compile returned no tbc");
    await sendCommand("loadModule", { moduleName, tbc });
    appendTimelineLine(`loaded module '${moduleName}'`);
  } catch (e) {
    appendTimelineLine(`compile/load error: ${JSON.stringify(e)}`);
  }
};

($("createTask") as HTMLButtonElement).onclick = async () => {
  const tid = Number((($("taskTid") as HTMLInputElement).value || "0").trim());
  const moduleName = (
    ($("taskModule") as HTMLInputElement).value || "progA"
  ).trim();
  try {
    await sendCommand("createTask", { tid, moduleName });
    appendTimelineLine(`created task tid=${String(tid)} module=${moduleName}`);
  } catch (e) {
    appendTimelineLine(`createTask error: ${JSON.stringify(e)}`);
  }
};

($("compilePolicy") as HTMLButtonElement).onclick = async () => {
  const moduleName = (
    ($("policyModule") as HTMLInputElement).value || "sched"
  ).trim();
  const sourceText = policySrcEl.value;
  try {
    const payload = (await sendCommand("compile", {
      sourceName: `${moduleName}.efx`,
      sourceText,
    })) as { tbc?: ArrayBuffer };
    const tbc = payload.tbc;
    if (!tbc) throw new Error("compile returned no tbc");
    await sendCommand("loadModule", { moduleName, tbc });
    appendTimelineLine(`loaded policy module '${moduleName}'`);
  } catch (e) {
    appendTimelineLine(`compile/load policy error: ${JSON.stringify(e)}`);
  }
};

($("setPolicy") as HTMLButtonElement).onclick = async () => {
  const moduleName = (
    ($("policyModule") as HTMLInputElement).value || "sched"
  ).trim();
  await sendCommand("setSchedulerPolicy", { moduleName }).catch(
    (e: unknown) => {
      appendTimelineLine(`setPolicy error: ${JSON.stringify(e)}`);
    },
  );
  appendTimelineLine(`policy set: ${moduleName}`);
};
($("clearPolicy") as HTMLButtonElement).onclick = async () => {
  await sendCommand("setSchedulerPolicy", { moduleName: null }).catch(
    (e: unknown) => {
      appendTimelineLine(`clearPolicy error: ${JSON.stringify(e)}`);
    },
  );
  appendTimelineLine(`policy cleared`);
};

// Right pane actions
($("refreshState") as HTMLButtonElement).onclick = async () =>
  refreshState("summary");
($("refreshStateFull") as HTMLButtonElement).onclick = async () =>
  refreshState("full");
($("clearTimeline") as HTMLButtonElement).onclick = () =>
  (timelineEl.textContent = "");

// Console actions
($("clearConsole") as HTMLButtonElement).onclick = () =>
  (consoleEl.textContent = "");

// Keyboard input: ASCII only, ignore while typing in editors.
window.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT"))
    return;
  if (e.key.length !== 1) return;
  const code = e.key.charCodeAt(0);
  if (code < 0 || code > 255) return;
  void sendCommand("inputKbd", { byte: code, isDown: true });
});
window.addEventListener("keyup", (e) => {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT"))
    return;
  if (e.key.length !== 1) return;
  const code = e.key.charCodeAt(0);
  if (code < 0 || code > 255) return;
  void sendCommand("inputKbd", { byte: code, isDown: false });
});

// Init engine
setUiMode("Idle");
updateClock("0", 0);
await sendCommand("init", {
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
}).catch((e: unknown) => {
  appendTimelineLine(`init error: ${JSON.stringify(e)}`);
});
setUiMode("Paused");
await refreshState("summary");
