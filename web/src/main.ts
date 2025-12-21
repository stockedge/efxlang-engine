import "./styles.css";

import {
  type DeosUiEvent,
  EventMask,
  PROTOCOL_VERSION,
  type SuiteProgressEvent,
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

      <div class="nav">
        <button class="navbtn active" id="navHome" data-view="home">Home</button>
        <button class="navbtn" id="navStudio" data-view="studio">Run Studio</button>
        <button class="navbtn" id="navLibrary" data-view="library">Library</button>
      </div>
    </div>

    <div class="views">
      <div class="view active" id="view-home">
        <div class="home">
          <div class="homebar">
            <button class="btn big" id="runAllSamples">Run All Samples</button>
            <div class="group">
              <label class="mono"
                ><input type="radio" name="suiteMode" value="quick" checked />
                Quick</label
              >
              <label class="mono"
                ><input type="radio" name="suiteMode" value="full" /> Full</label
              >
              <label class="mono"
                ><input type="checkbox" id="stopOnFirstFail" checked /> Stop on
                first fail</label
              >
            </div>
            <span class="pill mono" id="samplesStatus">Samples: ready</span>
            <button class="btn secondary" id="clearSampleResults">
              Clear Results
            </button>
          </div>

          <div class="homegrid">
            <div class="homeleft">
              <div class="cards" id="sampleCards"></div>
            </div>

            <div class="homeright">
              <div class="preview">
                <div class="previewhead">
                  <span class="pill mono" id="selectedSamplePill"
                    >(no sample selected)</span
                  >
                  <div class="group">
                    <button class="btn secondary" id="loadSelectedSample">
                      Load to Studio
                    </button>
                    <button class="btn" id="runSelectedSample">
                      Run This Sample
                    </button>
                    <button class="btn secondary" id="openStudioFromSample">
                      Open Studio
                    </button>
                  </div>
                </div>
                <div class="previewbody">
                  <div class="previewtitle" id="selectedSampleTitle"></div>
                  <div class="previewdesc" id="selectedSampleDesc"></div>
                </div>
              </div>

              <div class="sample-results mono" id="sampleResults"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="view" id="view-studio">
        <div class="studio">
          <div class="studiobar">
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
                    <button class="btn secondary" id="compileProg">
                      Compile & Load
                    </button>
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
                    <button class="btn secondary" id="compilePolicy">
                      Compile & Load
                    </button>
                    <button class="btn secondary" id="setPolicy">Set Policy</button>
                    <button class="btn secondary" id="clearPolicy">
                      Clear Policy
                    </button>
                  </div>
                  <textarea class="textarea mono" id="policySrc"></textarea>
                </div>
              </div>
            </div>

            <div class="pane" id="right">
              <div class="tabs">
                <button class="tab active" data-rtab="timeline">Timeline</button>
                <button class="tab" data-rtab="inspector">Inspector</button>
                <button class="tab" data-rtab="state">State</button>
                <button class="tab" data-rtab="trace">Trace</button>
              </div>

              <div class="tabpanel active" id="rtab-timeline">
                <div class="panel">
                  <div class="row">
                    <label class="mono"
                      ><input type="checkbox" id="followTick" checked />
                      Follow</label
                    >
                    <button class="btn secondary" id="clearTimeline">Clear</button>
                  </div>
                  <div class="timeline-panel">
                    <div class="timeline-canvas" id="timelineCanvas">
                      <svg class="timeline-svg" id="timelineSvg"></svg>
                    </div>
                    <div class="timeline mono" id="timeline"></div>
                  </div>
                </div>
              </div>

              <div class="tabpanel" id="rtab-inspector">
                <div class="panel">
                  <div class="row">
                    <span class="pill mono" id="selectionPill"
                      >tick=? (drag playhead / click event)</span
                    >
                    <button class="btn secondary" id="reverseSelected">
                      Reverse to tick
                    </button>
                    <button class="btn secondary" id="copySelectionJson">
                      Copy JSON
                    </button>
                  </div>
                  <pre class="pre mono" id="inspector">(no selection)</pre>
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
              <div class="group">
                <label class="mono"
                  ><input type="checkbox" id="autoScroll" checked />
                  Auto-scroll</label
                >
                <select class="input mono" id="consoleTid">
                  <option value="all">All TIDs</option>
                </select>
              </div>
              <div class="group">
                <button class="btn secondary" id="copyConsole">Copy</button>
                <button class="btn secondary" id="clearConsole">Clear</button>
              </div>
            </div>
            <div class="consolebody mono" id="console"></div>
          </div>
        </div>
      </div>

      <div class="view" id="view-library">
        <div class="library">
          <div class="librarybar">
            <input type="file" id="traceFile" accept=".json" />
            <button class="btn secondary" id="replayStart">Replay Start</button>
            <button class="btn secondary" id="replayStop">Replay Stop</button>
            <button class="btn secondary" id="openStudioFromLibrary">
              Open Studio
            </button>
          </div>
          <div class="panel">
            <div class="mono">
              Load a trace JSON here. Use Run Studio &gt; Trace tab to inspect it.
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

function $(id: string): Element {
  const el = document.querySelector(`#${CSS.escape(id)}`);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

const statusEl = $("status") as HTMLSpanElement;
const samplesStatusEl = $("samplesStatus") as HTMLSpanElement;
const clockEl = $("clock") as HTMLSpanElement;
const consoleEl = $("console") as HTMLDivElement;
const timelineEl = $("timeline") as HTMLDivElement;
const timelineCanvasEl = $("timelineCanvas") as HTMLDivElement;
const timelineSvgEl = $("timelineSvg") as SVGSVGElement;
const stateEl = $("state") as HTMLPreElement;
const traceInfoEl = $("traceInfo") as HTMLPreElement;
const selectionPillEl = $("selectionPill") as HTMLSpanElement;
const reverseSelectedBtn = $("reverseSelected") as HTMLButtonElement;
const copySelectionJsonBtn = $("copySelectionJson") as HTMLButtonElement;
const inspectorEl = $("inspector") as HTMLPreElement;
const sampleCardsEl = $("sampleCards") as HTMLDivElement;
const sampleResultsEl = $("sampleResults") as HTMLDivElement;

const navHomeEl = $("navHome") as HTMLButtonElement;
const navStudioEl = $("navStudio") as HTMLButtonElement;
const navLibraryEl = $("navLibrary") as HTMLButtonElement;
const viewHomeEl = $("view-home") as HTMLDivElement;
const viewStudioEl = $("view-studio") as HTMLDivElement;
const viewLibraryEl = $("view-library") as HTMLDivElement;

const suiteModeFullElMaybe = document.querySelector<HTMLInputElement>(
  'input[name="suiteMode"][value="full"]',
);
if (!suiteModeFullElMaybe) throw new Error("suiteMode full not found");
const suiteModeFullEl = suiteModeFullElMaybe;
const stopOnFirstFailEl = $("stopOnFirstFail") as HTMLInputElement;

const selectedSamplePillEl = $("selectedSamplePill") as HTMLSpanElement;
const selectedSampleTitleEl = $("selectedSampleTitle") as HTMLDivElement;
const selectedSampleDescEl = $("selectedSampleDesc") as HTMLDivElement;
const loadSelectedSampleBtn = $("loadSelectedSample") as HTMLButtonElement;
const runSelectedSampleBtn = $("runSelectedSample") as HTMLButtonElement;
const openStudioFromSampleBtn = $("openStudioFromSample") as HTMLButtonElement;
const openStudioFromLibraryBtn = $(
  "openStudioFromLibrary",
) as HTMLButtonElement;

const followTickEl = $("followTick") as HTMLInputElement;
const autoScrollEl = $("autoScroll") as HTMLInputElement;
const consoleTidEl = $("consoleTid") as HTMLSelectElement;
const copyConsoleBtn = $("copyConsole") as HTMLButtonElement;

const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});

type UiMode = "Idle" | "Running" | "Paused" | "Recording" | "Replay";
let uiMode: UiMode = "Idle";

type ViewKey = "home" | "studio" | "library";
function setView(next: ViewKey) {
  studioIngestEnabled = next === "studio";
  const views: Array<{
    key: ViewKey;
    el: HTMLElement;
    nav: HTMLButtonElement;
  }> = [
    { key: "home", el: viewHomeEl, nav: navHomeEl },
    { key: "studio", el: viewStudioEl, nav: navStudioEl },
    { key: "library", el: viewLibraryEl, nav: navLibraryEl },
  ];

  for (const v of views) {
    if (v.key === next) {
      v.el.classList.add("active");
      v.nav.classList.add("active");
    } else {
      v.el.classList.remove("active");
      v.nav.classList.remove("active");
    }
  }
}

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
  if (msg.event.type === "suiteProgress") {
    onSuiteProgress(msg.event);
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
  return `${cycle.slice(0, 4)}\u2026${cycle.slice(-4)}`;
}

function updateClock(cycle: string, tick: number) {
  clockEl.textContent = `tick=${String(tick)} cycle=${formatCycleShort(cycle)}`;
}

function appendTimelineLine(line: string, tick?: number, kind?: string) {
  const div = document.createElement("div");
  div.className = kind ? `timeline-row kind-${kind}` : "timeline-row";
  div.textContent = line;
  if (typeof tick === "number") {
    div.dataset.tick = String(tick);
    div.onclick = () => {
      selectTick(tick);
      const input = document.querySelector<HTMLInputElement>("#revToTick");
      if (input) input.value = String(tick);
    };
  }
  timelineEl.appendChild(div);
  if (followTickEl.checked) timelineEl.scrollTop = timelineEl.scrollHeight;
}

type TimelineWindow = {
  startTick: number;
  endTick: number;
  tickPx: number;
  laneLabelWidth: number;
};

const TIMELINE_TICK_PX = 10;
const TIMELINE_LANE_HEIGHT = 24;
const TIMELINE_LANE_LABEL_WIDTH = 56;
const TIMELINE_TOP_PAD = 18;
const TIMELINE_LEFT_PAD = 8;
const TIMELINE_WINDOW_TICKS = 140;
const MAX_STUDIO_EVENTS = 5_000;

let studioIngestEnabled = false;
let lastEngineTick = 0;
let studioViewTick = 0;
let studioSelectedTick: number | null = null;
let studioSelectedEventIndex: number | null = null;
const studioEvents: DeosUiEvent[] = [];
let consoleStartIndex = 0;
let consoleFilterTid: number | null = null;
const consoleTidSet = new Set<number>();

let timelineWindow: TimelineWindow = {
  startTick: 0,
  endTick: 0,
  tickPx: TIMELINE_TICK_PX,
  laneLabelWidth: TIMELINE_LANE_LABEL_WIDTH,
};
let timelineRenderPending = false;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function trimStudioEventsToMax() {
  const overflow = studioEvents.length - MAX_STUDIO_EVENTS;
  if (overflow <= 0) return;

  studioEvents.splice(0, overflow);
  consoleStartIndex = Math.max(0, consoleStartIndex - overflow);

  if (studioSelectedEventIndex !== null) {
    studioSelectedEventIndex -= overflow;
    if (studioSelectedEventIndex < 0) studioSelectedEventIndex = null;
  }
}

function resetConsoleUi() {
  consoleStartIndex = 0;
  consoleFilterTid = null;
  consoleTidSet.clear();
  consoleTidEl.value = "all";

  while (consoleTidEl.options.length > 1) {
    consoleTidEl.remove(1);
  }

  renderConsole();
}

function maybeAddConsoleTidOption(tid: number) {
  if (consoleTidSet.has(tid)) return;
  consoleTidSet.add(tid);
  const opt = document.createElement("option");
  opt.value = String(tid);
  opt.textContent = `tid ${String(tid)}`;
  consoleTidEl.appendChild(opt);
}

function renderConsole() {
  let text = "";
  for (let i = consoleStartIndex; i < studioEvents.length; i++) {
    const ev = studioEvents[i];
    if (ev.type !== "console") continue;
    if (consoleFilterTid !== null && ev.tid !== consoleFilterTid) continue;
    text += ev.text;
  }
  consoleEl.textContent = text;
  if (autoScrollEl.checked) consoleEl.scrollTop = consoleEl.scrollHeight;
}

function updateSelectionUi() {
  const tick = studioSelectedTick ?? studioViewTick;
  selectionPillEl.textContent = `tick=${String(tick)} (drag playhead / click event)`;
  reverseSelectedBtn.disabled = studioSelectedTick === null;

  if (studioSelectedEventIndex === null) {
    inspectorEl.textContent =
      studioSelectedTick === null
        ? "(no selection)"
        : `tick=${String(studioSelectedTick)}`;
    return;
  }

  const ev = studioEvents.at(studioSelectedEventIndex) ?? null;
  inspectorEl.textContent = ev
    ? JSON.stringify(ev, null, 2)
    : "(event not found)";
}

function selectTick(tick: number) {
  studioSelectedEventIndex = null;
  studioSelectedTick = clamp(tick, 0, Number.MAX_SAFE_INTEGER);
  studioViewTick = studioSelectedTick;
  updateSelectionUi();
  scheduleTimelineRender();
}

function selectEventIndex(idx: number) {
  const ev = studioEvents.at(idx);
  if (!ev) return;
  studioSelectedEventIndex = idx;
  studioSelectedTick = ev.tick;
  studioViewTick = ev.tick;
  updateSelectionUi();
  scheduleTimelineRender();
}

function clearStudioUiOnly() {
  studioEvents.length = 0;
  resetConsoleUi();
  studioSelectedEventIndex = null;
  studioSelectedTick = null;
  studioViewTick = 0;
  timelineEl.textContent = "";
  timelineSvgEl.replaceChildren();
  timelineSvgEl.removeAttribute("width");
  timelineSvgEl.removeAttribute("height");
  inspectorEl.textContent = "(no selection)";
  selectionPillEl.textContent = "tick=? (drag playhead / click event)";
  reverseSelectedBtn.disabled = true;
}

function scheduleTimelineRender() {
  if (timelineRenderPending) return;
  timelineRenderPending = true;
  requestAnimationFrame(() => {
    timelineRenderPending = false;
    renderTimelineSvg();
  });
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function svgTitle(el: SVGElement, text: string) {
  const title = svgEl("title");
  title.textContent = text;
  el.appendChild(title);
}

function renderTimelineSvg() {
  const endTick = studioViewTick;
  const startTick = Math.max(0, endTick - (TIMELINE_WINDOW_TICKS - 1));

  timelineWindow = {
    startTick,
    endTick,
    tickPx: TIMELINE_TICK_PX,
    laneLabelWidth: TIMELINE_LANE_LABEL_WIDTH,
  };

  const tidSet = new Set<number>();
  tidSet.add(0);
  for (const ev of studioEvents) {
    switch (ev.type) {
      case "console":
      case "perform":
      case "contCall":
      case "contReturn":
        tidSet.add(ev.tid);
        break;
      case "inputConsumed":
        tidSet.add(0);
        break;
      case "taskSwitch":
        tidSet.add(ev.fromTid);
        tidSet.add(ev.toTid);
        break;
      case "policyPick":
        tidSet.add(ev.currentTid);
        break;
      case "error":
        if (typeof ev.tid === "number") tidSet.add(ev.tid);
        break;
      case "tick":
        break;
    }
  }

  const tids = Array.from(tidSet.values()).sort((a, b) => a - b);

  const laneCount = tids.length;
  const laneHeight = TIMELINE_LANE_HEIGHT;
  const topPad = TIMELINE_TOP_PAD;
  const leftPad = TIMELINE_LEFT_PAD;
  const labelW = TIMELINE_LANE_LABEL_WIDTH;
  const tickPx = TIMELINE_TICK_PX;

  const width = leftPad + labelW + (endTick - startTick + 1) * tickPx + 10;
  const height = topPad + laneCount * laneHeight + 14;

  timelineSvgEl.replaceChildren();
  timelineSvgEl.setAttribute("width", String(width));
  timelineSvgEl.setAttribute("height", String(height));
  timelineSvgEl.setAttribute(
    "viewBox",
    `0 0 ${String(width)} ${String(height)}`,
  );

  const defs = svgEl("defs");
  const marker = svgEl("marker", {
    id: "arrow",
    viewBox: "0 0 10 10",
    refX: "8",
    refY: "5",
    markerWidth: "6",
    markerHeight: "6",
    orient: "auto-start-reverse",
  });
  marker.appendChild(
    svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#2ea043" }),
  );
  defs.appendChild(marker);
  timelineSvgEl.appendChild(defs);

  timelineSvgEl.appendChild(
    svgEl("rect", {
      x: "0",
      y: "0",
      width: String(width),
      height: String(height),
      fill: "#0b0d10",
    }),
  );

  // Tick grid (major every 10).
  for (let t = startTick; t <= endTick; t++) {
    const x = leftPad + labelW + (t - startTick) * tickPx;
    const major = t % 10 === 0;
    timelineSvgEl.appendChild(
      svgEl("line", {
        x1: String(x),
        y1: "0",
        x2: String(x),
        y2: String(height),
        stroke: major ? "rgba(157,167,179,0.22)" : "rgba(157,167,179,0.08)",
        "stroke-width": major ? "1" : "1",
      }),
    );
    if (major) {
      const label = svgEl("text", {
        x: String(x + 2),
        y: String(12),
        fill: "#9da7b3",
        "font-size": "10",
      });
      label.textContent = String(t);
      timelineSvgEl.appendChild(label);
    }
  }

  const yForTid = new Map<number, number>();
  for (let i = 0; i < tids.length; i++) {
    const tid = tids[i];
    const y = topPad + i * laneHeight + laneHeight / 2;
    yForTid.set(tid, y);

    // Lane separator
    timelineSvgEl.appendChild(
      svgEl("line", {
        x1: "0",
        y1: String(topPad + i * laneHeight),
        x2: String(width),
        y2: String(topPad + i * laneHeight),
        stroke: "rgba(32,39,52,0.85)",
        "stroke-width": "1",
      }),
    );

    // Lane label
    const label = svgEl("text", {
      x: String(leftPad),
      y: String(y + 4),
      fill: "#e6edf3",
      "font-size": "11",
    });
    label.textContent = tid === 0 ? "idle" : `tid ${String(tid)}`;
    timelineSvgEl.appendChild(label);
  }

  // Event glyphs
  for (let i = 0; i < studioEvents.length; i++) {
    const ev = studioEvents[i];
    if (ev.tick < startTick || ev.tick > endTick) continue;
    if (ev.type === "tick") continue;

    const x = leftPad + labelW + (ev.tick - startTick) * tickPx;
    const isSelected = studioSelectedEventIndex === i;

    const addHit = (el: SVGElement, titleText: string) => {
      el.dataset.eventIndex = String(i);
      el.style.cursor = "pointer";
      if (isSelected) el.setAttribute("stroke", "rgba(255,255,255,0.9)");
      svgTitle(el, titleText);
      return el;
    };

    if (ev.type === "taskSwitch") {
      const y1 = yForTid.get(ev.fromTid) ?? yForTid.get(tids[0]) ?? topPad;
      const y2 = yForTid.get(ev.toTid) ?? yForTid.get(tids[0]) ?? topPad;
      timelineSvgEl.appendChild(
        addHit(
          svgEl("line", {
            x1: String(x),
            y1: String(y1),
            x2: String(x),
            y2: String(y2),
            stroke: "#2ea043",
            "stroke-width": "2",
            "marker-end": "url(#arrow)",
          }),
          `taskSwitch ${String(ev.fromTid)}→${String(ev.toTid)} (${ev.reason}) tick=${String(ev.tick)}`,
        ),
      );
      continue;
    }

    const tid =
      ev.type === "policyPick"
        ? ev.currentTid
        : "tid" in ev && typeof ev.tid === "number"
          ? ev.tid
          : tids[0];
    const y = yForTid.get(tid) ?? yForTid.get(tids[0]) ?? topPad;

    switch (ev.type) {
      case "perform": {
        const size = 6;
        timelineSvgEl.appendChild(
          addHit(
            svgEl("path", {
              d: `M ${String(x)} ${String(y - size)} L ${String(x + size)} ${String(y)} L ${String(x)} ${String(y + size)} L ${String(x - size)} ${String(y)} Z`,
              fill: "#a371f7",
              stroke: isSelected ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0)",
              "stroke-width": "2",
            }),
            `perform ${ev.effect} argc=${String(ev.argc)} tid=${String(ev.tid)} tick=${String(ev.tick)}`,
          ),
        );
        break;
      }
      case "contCall": {
        timelineSvgEl.appendChild(
          addHit(
            svgEl("circle", {
              cx: String(x),
              cy: String(y),
              r: "5",
              fill: "#d29922",
              stroke: isSelected ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0)",
              "stroke-width": "2",
            }),
            `contCall tid=${String(ev.tid)} usedBefore=${String(ev.oneShotUsedBefore)} tick=${String(ev.tick)}`,
          ),
        );
        break;
      }
      case "contReturn": {
        timelineSvgEl.appendChild(
          addHit(
            svgEl("circle", {
              cx: String(x),
              cy: String(y),
              r: "5",
              fill: "transparent",
              stroke: "#d29922",
              "stroke-width": isSelected ? "3" : "2",
            }),
            `contReturn tid=${String(ev.tid)} tick=${String(ev.tick)}`,
          ),
        );
        break;
      }
      case "inputConsumed": {
        const size = 6;
        timelineSvgEl.appendChild(
          addHit(
            svgEl("path", {
              d: `M ${String(x)} ${String(y - size)} L ${String(x + size)} ${String(y + size)} L ${String(x - size)} ${String(y + size)} Z`,
              fill: "#7dd3fc",
              stroke: isSelected ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0)",
              "stroke-width": "2",
            }),
            `inputConsumed byte=${String(ev.byte)} isDown=${String(ev.isDown)} tick=${String(ev.tick)}`,
          ),
        );
        break;
      }
      case "policyPick": {
        timelineSvgEl.appendChild(
          addHit(
            svgEl("rect", {
              x: String(x - 5),
              y: String(y - 5),
              width: "10",
              height: "10",
              fill: "#ec4899",
              stroke: isSelected ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0)",
              "stroke-width": "2",
            }),
            `policyPick currentTid=${String(ev.currentTid)} pickedIndex=${String(ev.pickedIndex)} runnable=[${ev.runnableTids.map(String).join(",")}] tick=${String(ev.tick)}`,
          ),
        );
        break;
      }
      case "error": {
        const size = 6;
        timelineSvgEl.appendChild(
          addHit(
            svgEl("path", {
              d: `M ${String(x - size)} ${String(y - size)} L ${String(x + size)} ${String(y + size)} M ${String(x - size)} ${String(y + size)} L ${String(x + size)} ${String(y - size)}`,
              fill: "transparent",
              stroke: "#f85149",
              "stroke-width": isSelected ? "3" : "2",
            }),
            `error ${ev.code}: ${ev.message} tick=${String(ev.tick)}`,
          ),
        );
        break;
      }
      case "console": {
        timelineSvgEl.appendChild(
          addHit(
            svgEl("circle", {
              cx: String(x),
              cy: String(y),
              r: "4",
              fill: "#9da7b3",
              stroke: isSelected ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0)",
              "stroke-width": "2",
            }),
            `console tid=${String(ev.tid)} tick=${String(ev.tick)} text=${JSON.stringify(ev.text.slice(0, 40))}`,
          ),
        );
        break;
      }
      default:
        break;
    }
  }

  // Playhead (view tick)
  {
    const x =
      leftPad +
      labelW +
      (clamp(studioViewTick, startTick, endTick) - startTick) * tickPx;
    timelineSvgEl.appendChild(
      svgEl("line", {
        x1: String(x),
        y1: "0",
        x2: String(x),
        y2: String(height),
        stroke: "rgba(31,111,235,0.85)",
        "stroke-width": "2",
      }),
    );
  }

  // Keep playhead in view when following.
  if (followTickEl.checked) {
    const playheadX = leftPad + labelW + (endTick - startTick) * tickPx;
    const viewportW = timelineCanvasEl.clientWidth;
    const target = Math.max(0, playheadX - Math.floor(viewportW * 0.7));
    timelineCanvasEl.scrollLeft = target;
  }
}

function tickFromClientX(clientX: number): number {
  const rect = timelineCanvasEl.getBoundingClientRect();
  const x = clientX - rect.left + timelineCanvasEl.scrollLeft;
  const localX = x - TIMELINE_LEFT_PAD - timelineWindow.laneLabelWidth;
  const t =
    timelineWindow.startTick + Math.round(localX / timelineWindow.tickPx);
  return clamp(t, 0, Number.MAX_SAFE_INTEGER);
}

let isDraggingPlayhead = false;
timelineSvgEl.addEventListener("pointerdown", (ev) => {
  const target = ev.target as Element | null;
  const hit = target?.closest<SVGElement>("[data-event-index]") ?? null;
  if (hit) {
    const raw = hit.dataset.eventIndex;
    const idx = raw ? Number(raw) : NaN;
    if (Number.isFinite(idx)) {
      selectEventIndex(idx);
      return;
    }
  }

  isDraggingPlayhead = true;
  followTickEl.checked = false;
  selectTick(tickFromClientX(ev.clientX));
  timelineSvgEl.setPointerCapture(ev.pointerId);
});
timelineSvgEl.addEventListener("pointermove", (ev) => {
  if (!isDraggingPlayhead) return;
  selectTick(tickFromClientX(ev.clientX));
});
timelineSvgEl.addEventListener("pointerup", () => {
  isDraggingPlayhead = false;
});
timelineSvgEl.addEventListener("pointercancel", () => {
  isDraggingPlayhead = false;
});

followTickEl.addEventListener("change", () => {
  if (!followTickEl.checked) return;
  studioViewTick = lastEngineTick;
  studioSelectedTick ??= studioViewTick;
  updateSelectionUi();
  scheduleTimelineRender();
});

reverseSelectedBtn.onclick = async () => {
  const tick = studioSelectedTick;
  if (tick === null) return;
  setView("studio");
  try {
    // Clear UI-only timeline to avoid confusing "branch" outputs.
    clearStudioUiOnly();
    studioSelectedTick = tick;
    studioViewTick = tick;
    updateSelectionUi();

    await sendCommand("reverseToTick", { tick });
    setUiMode("Paused");
    await refreshState("full");
  } catch (e: unknown) {
    appendTimelineLine(
      `reverseToTick error: ${JSON.stringify(e)}`,
      tick,
      "error",
    );
  } finally {
    updateSelectionUi();
    scheduleTimelineRender();
  }
};

function fallbackCopy(text: string) {
  // Best-effort fallback without deprecated execCommand().
  window.prompt("Copy to clipboard:", text);
}

copySelectionJsonBtn.onclick = async () => {
  const text =
    studioSelectedEventIndex !== null
      ? JSON.stringify(
          studioEvents.at(studioSelectedEventIndex) ?? null,
          null,
          2,
        )
      : JSON.stringify({ tick: studioSelectedTick }, null, 2);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    fallbackCopy(text);
  }
};

function onEngineEvent(ev: DeosUiEvent) {
  for (const cb of engineEventSubscribers) cb(ev);

  if ("cycle" in ev && "tick" in ev) {
    lastEngineTick = ev.tick;
    updateClock(ev.cycle, ev.tick);
    if (followTickEl.checked) {
      studioViewTick = ev.tick;
      studioSelectedTick ??= ev.tick;
    }
  }

  if (!studioIngestEnabled) return;

  if (ev.type === "console") {
    studioEvents.push(ev);
    trimStudioEventsToMax();
    maybeAddConsoleTidOption(ev.tid);
    renderConsole();
    scheduleTimelineRender();
    return;
  }

  if (ev.type !== "tick") {
    studioEvents.push(ev);
    trimStudioEventsToMax();
  }

  switch (ev.type) {
    case "tick":
      appendTimelineLine(
        `tick ${String(ev.tick)} @${formatCycleShort(ev.cycle)}`,
        ev.tick,
        ev.type,
      );
      scheduleTimelineRender();
      return;
    case "taskSwitch":
      appendTimelineLine(
        `taskSwitch ${String(ev.fromTid)}->${String(ev.toTid)} (${ev.reason}) tick=${String(ev.tick)} @${formatCycleShort(
          ev.cycle,
        )}`,
        ev.tick,
        ev.type,
      );
      scheduleTimelineRender();
      return;
    case "perform":
      appendTimelineLine(
        `perform ${ev.effect} argc=${String(ev.argc)} tid=${String(ev.tid)} tick=${String(ev.tick)} @${formatCycleShort(
          ev.cycle,
        )}`,
        ev.tick,
        ev.type,
      );
      scheduleTimelineRender();
      return;
    case "contCall":
      appendTimelineLine(
        `contCall tid=${String(ev.tid)} usedBefore=${String(ev.oneShotUsedBefore)} tick=${String(ev.tick)} @${formatCycleShort(
          ev.cycle,
        )}`,
        ev.tick,
        ev.type,
      );
      scheduleTimelineRender();
      return;
    case "contReturn":
      appendTimelineLine(
        `contReturn tid=${String(ev.tid)} tick=${String(ev.tick)} @${formatCycleShort(ev.cycle)}`,
        ev.tick,
        ev.type,
      );
      scheduleTimelineRender();
      return;
    case "inputConsumed":
      appendTimelineLine(
        `inputConsumed byte=${String(ev.byte)} isDown=${String(ev.isDown)} tick=${String(ev.tick)} @${formatCycleShort(
          ev.cycle,
        )}`,
        ev.tick,
        ev.type,
      );
      scheduleTimelineRender();
      return;
    case "policyPick":
      appendTimelineLine(
        `policyPick idx=${String(ev.pickedIndex)} runnable=[${ev.runnableTids.join(
          ",",
        )}] tick=${String(ev.tick)} @${formatCycleShort(ev.cycle)}`,
        ev.tick,
        ev.type,
      );
      scheduleTimelineRender();
      return;
    case "error":
      appendTimelineLine(
        `error ${ev.code}: ${ev.message} tick=${String(ev.tick)} @${formatCycleShort(ev.cycle)}`,
        ev.tick,
        ev.type,
      );
      scheduleTimelineRender();
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

navHomeEl.onclick = () => {
  setView("home");
};
navStudioEl.onclick = () => {
  setView("studio");
};
navLibraryEl.onclick = () => {
  setView("library");
};
openStudioFromLibraryBtn.onclick = () => {
  setView("studio");
};
openStudioFromSampleBtn.onclick = () => {
  setView("studio");
};

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
  card: HTMLDivElement;
  statusDot: HTMLSpanElement;
  statusText: HTMLSpanElement;
  signalByKey: Map<string, HTMLSpanElement>;
  runBtn: HTMLButtonElement;
  loadBtn: HTMLButtonElement;
};

const sampleCardUiById = new Map<string, SampleCardUi>();
let selectedSample: SampleDefinition | null = null;

function setSelectedSample(sample: SampleDefinition | null) {
  selectedSample = sample;
  selectedSamplePillEl.textContent = sample
    ? sample.id
    : "(no sample selected)";
  selectedSampleTitleEl.textContent = sample ? sample.title : "";
  selectedSampleDescEl.textContent = sample ? sample.description : "";

  const enabled = sample !== null;
  loadSelectedSampleBtn.disabled = !enabled;
  runSelectedSampleBtn.disabled = !enabled;
  openStudioFromSampleBtn.disabled = !enabled;

  for (const ui of sampleCardUiById.values()) {
    ui.card.classList.toggle("selected", sample?.id === ui.sample.id);
  }
}

function loadSampleIntoStudio(sample: SampleDefinition) {
  setSelectedSample(sample);

  const firstProg = sample.modules.find((m) => m.role === "program") ?? null;
  if (firstProg)
    loadModuleIntoEditor(firstProg.moduleName, firstProg.sourceText, "program");
  const firstPolicy = sample.modules.find((m) => m.role === "policy") ?? null;
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

  setView("studio");
}

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
  setView("studio");
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
    card.onclick = (ev) => {
      const target = ev.target as HTMLElement | null;
      if (target?.closest("button")) return;
      setSelectedSample(sample);
    };

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
      loadSampleIntoStudio(sample);
    };

    const runBtn = document.createElement("button");
    runBtn.className = "btn";
    runBtn.textContent = "Run";
    runBtn.onclick = () => {
      setSelectedSample(sample);
      setView("home");
      void runSamples([sample], getSuiteOptions());
    };

    actions.append(loadBtn, runBtn);

    card.append(header, desc, tags, meta, signals, modules, actions);
    sampleCardsEl.appendChild(card);

    sampleCardUiById.set(sample.id, {
      sample,
      card,
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
  loadSelectedSampleBtn.disabled = busy || selectedSample === null;
  runSelectedSampleBtn.disabled = busy || selectedSample === null;
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
  async reverseToTick(tick: number) {
    await sendCommand("reverseToTick", { tick });
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

function getSuiteOptions(): {
  mode: "quick" | "full";
  stopOnFirstFail: boolean;
} {
  const mode: "quick" | "full" = suiteModeFullEl.checked ? "full" : "quick";
  return { mode, stopOnFirstFail: stopOnFirstFailEl.checked };
}

type SuiteRunResult = {
  suiteId: string;
  runs: Array<{
    sampleId: string;
    runId: string;
    status: "passed" | "failed" | "error";
  }>;
  passCount: number;
  failCount: number;
};

let activeSuite: { suiteId: string; mode: "quick" | "full" } | null = null;

function onSuiteProgress(ev: SuiteProgressEvent) {
  if (!activeSuite || activeSuite.suiteId !== ev.suiteId) return;

  const finishedCount = ev.passCount + ev.failCount;
  const suiteDone = finishedCount >= ev.total;
  const tone = suiteDone
    ? ev.failCount > 0
      ? "err"
      : "ok"
    : ev.failCount > 0
      ? "err"
      : "running";
  setSamplesStatus(
    `Suite: ${suiteDone ? "done" : "running"} ${String(finishedCount)}/${String(ev.total)} (PASS ${String(ev.passCount)} / FAIL ${String(ev.failCount)})`,
    tone,
  );

  if (ev.status === "running") {
    setSampleCardStatus(ev.sampleId, "running", "running…");
    return;
  }

  setSampleCardStatus(
    ev.sampleId,
    ev.status === "passed" ? "ok" : "err",
    ev.status,
  );

  const ui = sampleCardUiById.get(ev.sampleId);
  if (!ui) return;
  const ms = ev.durationMs ?? 0;
  const ok = ev.status === "passed";
  appendSampleResult(ui.sample, ms, ok, ev.summary ?? ev.status);
}

async function runSampleSuiteFromWorker(opts: {
  mode: "quick" | "full";
  stopOnFirstFail: boolean;
}) {
  if (sampleRunnerBusy) return;

  sampleRunnerBusy = true;
  setSampleRunnerBusy(true);
  sampleResultsEl.textContent = "";
  activeSuite = { suiteId: "deos-standard", mode: opts.mode };

  try {
    setView("home");
    setSamplesStatus(
      `Suite: running 0/${String(samples.length)} (PASS 0 / FAIL 0)`,
      "running",
    );
    for (const ui of sampleCardUiById.values()) {
      setSampleCardStatus(ui.sample.id, "idle", "idle");
    }

    const result = (await sendCommand("runSampleSuite", {
      mode: opts.mode,
      suiteId: "deos-standard",
      stopOnFirstFail: opts.stopOnFirstFail,
    })) as SuiteRunResult;

    for (const r of result.runs) {
      setSampleCardStatus(
        r.sampleId,
        r.status === "passed" ? "ok" : "err",
        r.status,
      );
    }

    setSamplesStatus(
      `Suite: done (${opts.mode}) (PASS ${String(result.passCount)} / FAIL ${String(result.failCount)})`,
      result.failCount > 0 ? "err" : "ok",
    );
  } catch (e: unknown) {
    setSamplesStatus(`Suite: error ${String(e)}`, "err");
  } finally {
    activeSuite = null;
    sampleRunnerBusy = false;
    setSampleRunnerBusy(false);
  }
}

async function runSamples(
  list: SampleDefinition[],
  opts: { mode: "quick" | "full"; stopOnFirstFail: boolean },
) {
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
    setView("home");

    for (let i = 0; i < list.length; i++) {
      const sample = list[i];
      setSampleCardStatus(sample.id, "running", "running…");

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

      if (opts.stopOnFirstFail && failCount > 0) break;
    }

    setSamplesStatus(
      `Samples: done (${opts.mode}) (PASS ${String(passCount)} / FAIL ${String(failCount)})`,
      failCount > 0 ? "err" : "ok",
    );
  } finally {
    sampleRunnerBusy = false;
    setSampleRunnerBusy(false);
  }
}

renderSampleCards();
setSamplesStatus("Samples: ready", "ready");
setSelectedSample(samples.at(0) ?? null);

loadSelectedSampleBtn.onclick = () => {
  const sample = selectedSample;
  if (!sample) return;
  loadSampleIntoStudio(sample);
};
runSelectedSampleBtn.onclick = () => {
  const sample = selectedSample;
  if (!sample) return;
  void runSamples([sample], getSuiteOptions());
};

($("runAllSamples") as HTMLButtonElement).onclick = () => {
  void runSampleSuiteFromWorker(getSuiteOptions());
};
($("clearSampleResults") as HTMLButtonElement).onclick = () => {
  sampleResultsEl.textContent = "";
  for (const ui of sampleCardUiById.values()) {
    setSampleCardStatus(ui.sample.id, "idle", "idle");
    setSampleSignalsFromEvents(ui.sample.id, []);
  }
  setSamplesStatus("Samples: ready", "ready");
};

// Defaults
const progSrcEl = $("progSrc") as HTMLTextAreaElement;
progSrcEl.value = `// Example: timeslice switching (no yield)\n// 1) Compile as module 'progA' (prints 'A')\n// 2) Change 65 -> 66, set module 'progB' (prints 'B'), compile\n// 3) Create tasks: tid=1 module=progA, tid=2 module=progB\n// 4) Run to tick (e.g. 20) and watch taskSwitch reason=timeslice\n\nlet burn = fun(n) => {\n  if (n < 2000) { burn(n + 1) } else { 0 }\n};\n\nlet loop = fun(ch) => {\n  burn(0);\n  putc(ch);\n  loop(ch)\n};\n\nloop(65);\n`;

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
  clearStudioUiOnly();
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
($("refreshState") as HTMLButtonElement).onclick = async () => {
  await refreshState("summary");
};
($("refreshStateFull") as HTMLButtonElement).onclick = async () => {
  await refreshState("full");
};
($("clearTimeline") as HTMLButtonElement).onclick = () => {
  clearStudioUiOnly();
};

// Console actions
consoleTidEl.onchange = () => {
  const v = consoleTidEl.value;
  if (v === "all") {
    consoleFilterTid = null;
  } else {
    const n = Number(v);
    consoleFilterTid = Number.isFinite(n) ? n : null;
  }
  renderConsole();
};

copyConsoleBtn.onclick = async () => {
  const text = consoleEl.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    fallbackCopy(text);
  }
};

($("clearConsole") as HTMLButtonElement).onclick = () => {
  consoleStartIndex = studioEvents.length;
  renderConsole();
};

// Keyboard input: ASCII only, ignore while typing in editors.
window.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === "TEXTAREA" ||
      target.tagName === "INPUT" ||
      target.tagName === "SELECT")
  )
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
