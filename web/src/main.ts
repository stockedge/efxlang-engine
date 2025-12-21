import "./styles.css";

import {
  type DeosUiEvent,
  EventMask,
  PROTOCOL_VERSION,
  type WorkerMessage,
} from "./protocol";

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
const clockEl = $("clock") as HTMLSpanElement;
const consoleEl = $("console") as HTMLDivElement;
const timelineEl = $("timeline") as HTMLDivElement;
const stateEl = $("state") as HTMLPreElement;
const traceInfoEl = $("traceInfo") as HTMLPreElement;

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

function appendTimelineLine(line: string, tick?: number) {
  const div = document.createElement("div");
  div.className = "timeline-row";
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
      );
      return;
    case "taskSwitch":
      appendTimelineLine(
        `taskSwitch ${String(ev.fromTid)}->${String(ev.toTid)} (${ev.reason}) tick=${String(ev.tick)} @${formatCycleShort(
          ev.cycle,
        )}`,
        ev.tick,
      );
      return;
    case "perform":
      appendTimelineLine(
        `perform ${ev.effect} argc=${String(ev.argc)} tid=${String(ev.tid)} tick=${String(ev.tick)} @${formatCycleShort(
          ev.cycle,
        )}`,
        ev.tick,
      );
      return;
    case "contCall":
      appendTimelineLine(
        `contCall tid=${String(ev.tid)} usedBefore=${String(ev.oneShotUsedBefore)} tick=${String(ev.tick)} @${formatCycleShort(
          ev.cycle,
        )}`,
        ev.tick,
      );
      return;
    case "contReturn":
      appendTimelineLine(
        `contReturn tid=${String(ev.tid)} tick=${String(ev.tick)} @${formatCycleShort(ev.cycle)}`,
        ev.tick,
      );
      return;
    case "inputConsumed":
      appendTimelineLine(
        `inputConsumed byte=${String(ev.byte)} isDown=${String(ev.isDown)} tick=${String(ev.tick)} @${formatCycleShort(
          ev.cycle,
        )}`,
        ev.tick,
      );
      return;
    case "policyPick":
      appendTimelineLine(
        `policyPick idx=${String(ev.pickedIndex)} runnable=[${ev.runnableTids.join(
          ",",
        )}] tick=${String(ev.tick)} @${formatCycleShort(ev.cycle)}`,
        ev.tick,
      );
      return;
    case "error":
      appendTimelineLine(
        `error ${ev.code}: ${ev.message} tick=${String(ev.tick)} @${formatCycleShort(ev.cycle)}`,
        ev.tick,
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
