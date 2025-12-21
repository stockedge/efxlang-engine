import type { DeosUiEvent } from "./protocol";

export type SampleRunCapture = {
  consoleText: string;
  events: DeosUiEvent[];
};

export type SampleCheckResult = {
  ok: boolean;
  summary: string;
  details?: string;
};

export type SampleRunnerApi = {
  reset: () => Promise<void>;
  init: (cfg?: Partial<SampleRunnerConfig>) => Promise<void>;
  compileAndLoad: (moduleName: string, sourceText: string) => Promise<void>;
  createTask: (
    tid: number,
    moduleName: string,
    entryFnIndex?: number,
    domainId?: number,
  ) => Promise<void>;
  setSchedulerPolicy: (moduleName: string | null) => Promise<void>;
  inputKbd: (byte: number, isDown: boolean) => Promise<void>;
  run: (opts?: {
    untilTick?: number;
    maxInstructions?: number;
  }) => Promise<void>;
  recordStart: () => Promise<void>;
  recordStop: () => Promise<void>;
  getTraceJsonText: () => Promise<string>;
  loadTraceJsonText: (traceJsonText: string) => Promise<void>;
  replayStart: () => Promise<void>;
  replayStop: () => Promise<void>;
  reverseToTick: (tick: number) => Promise<void>;
  captureWhile: <T>(
    fn: () => Promise<T>,
  ) => Promise<{ value: T; capture: SampleRunCapture }>;
};

export type SampleRunnerConfig = {
  cyclesPerTick: number;
  timesliceTicks: number;
  snapshotEveryTicks: number;
  eventMask: number;
};

export type SampleModule = {
  moduleName: string;
  role: "program" | "policy";
  sourceText: string;
};

export type SampleDefinition = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  modules: SampleModule[];
  tasks: Array<{
    tid: number;
    moduleName: string;
    entryFnIndex?: number;
    domainId?: number;
  }>;
  run: (api: SampleRunnerApi) => Promise<SampleCheckResult>;
};

function ok(summary: string, details?: string): SampleCheckResult {
  return { ok: true, summary, details };
}

function fail(summary: string, details?: string): SampleCheckResult {
  return { ok: false, summary, details };
}

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

function expectConsoleExact(
  capture: SampleRunCapture,
  expected: string,
): SampleCheckResult {
  const actual = normalizeNewlines(capture.consoleText);
  const want = normalizeNewlines(expected);
  if (actual === want) return ok("console output matched");
  return fail(
    "console output mismatch",
    `expected:\n${want}\n\nactual:\n${actual}`,
  );
}

function mustHaveEventType(
  capture: SampleRunCapture,
  type: DeosUiEvent["type"],
): SampleCheckResult {
  if (capture.events.some((e) => e.type === type))
    return ok(`saw event type '${type}'`);
  return fail(`missing event type '${type}'`);
}

function splitConsoleLines(capture: SampleRunCapture): string[] {
  return normalizeNewlines(capture.consoleText)
    .split("\n")
    .filter((l) => l.length > 0);
}

function expectLinesContainAll(
  capture: SampleRunCapture,
  expectedLines: string[],
): SampleCheckResult {
  const lines = splitConsoleLines(capture);
  const set = new Set(lines);
  for (const l of expectedLines) {
    if (!set.has(l))
      return fail(
        "missing expected line",
        `missing: ${JSON.stringify(l)}\nlines: ${JSON.stringify(lines)}`,
      );
  }
  return ok("console lines contained expected set");
}

function expectLineCount(
  capture: SampleRunCapture,
  expectedCount: number,
): SampleCheckResult {
  const lines = splitConsoleLines(capture);
  if (lines.length === expectedCount) return ok("console line count matched");
  return fail(
    "console line count mismatch",
    `expected: ${String(expectedCount)}\nactual: ${String(lines.length)}\nlines: ${JSON.stringify(lines)}`,
  );
}

function expectRuntimeErrorCodeContains(
  capture: SampleRunCapture,
  expectedSubstring: string,
): SampleCheckResult {
  const err = capture.events.find((e) => e.type === "error");
  if (!err) return fail("expected runtime error, but none occurred");
  const code =
    "code" in err && typeof err.code === "string"
      ? err.code
      : JSON.stringify(err);
  const msg =
    "message" in err && typeof err.message === "string" ? err.message : "";
  if (code.includes(expectedSubstring) || msg.includes(expectedSubstring)) {
    return ok(`error contained '${expectedSubstring}'`);
  }
  return fail(
    "runtime error mismatch",
    `expected substring: ${JSON.stringify(expectedSubstring)}\ncode: ${JSON.stringify(code)}\nmessage: ${JSON.stringify(msg)}`,
  );
}

const S1_EFFECT_BASIC: SampleDefinition = {
  id: "s1-effect-basic",
  title: "S1: Effect 基本（捕捉）",
  description: "perform→handle捕捉が動く（Fooを42に潰す）。",
  tags: ["effects", "handler"],
  modules: [
    {
      moduleName: "s1",
      role: "program",
      sourceText: `print(handle { perform Foo(1) } with { Foo(x, k) => 42; });\n`,
    },
  ],
  tasks: [{ tid: 1, moduleName: "s1" }],
  async run(api) {
    await api.reset();
    await api.init();
    await api.compileAndLoad("s1", S1_EFFECT_BASIC.modules[0].sourceText);
    await api.createTask(1, "s1");
    const { capture } = await api.captureWhile(() =>
      api.run({ maxInstructions: 200_000 }),
    );
    return expectConsoleExact(capture, "42\n");
  },
};

const S2_EFFECT_RESUME: SampleDefinition = {
  id: "s2-effect-resume",
  title: "S2: Effect 再開（kで戻る）",
  description: "継続kで値を返して計算を再開できることを確認。",
  tags: ["effects", "continuation"],
  modules: [
    {
      moduleName: "s2",
      role: "program",
      sourceText: `print(handle { 1 + perform Foo(0) } with { Foo(x, k) => k(10); });\n`,
    },
  ],
  tasks: [{ tid: 1, moduleName: "s2" }],
  async run(api) {
    await api.reset();
    await api.init();
    await api.compileAndLoad("s2", S2_EFFECT_RESUME.modules[0].sourceText);
    await api.createTask(1, "s2");
    const { capture } = await api.captureWhile(() =>
      api.run({ maxInstructions: 500_000 }),
    );
    return expectConsoleExact(capture, "11\n");
  },
};

const S3_ONE_SHOT_ERROR: SampleDefinition = {
  id: "s3-one-shot-error",
  title: "S3: one-shot 継続エラー",
  description: "kを2回呼ぶと ContinuationAlreadyUsed になることを確認。",
  tags: ["effects", "continuation", "error"],
  modules: [
    {
      moduleName: "s3",
      role: "program",
      sourceText: `print(handle { perform Foo(0) } with { Foo(x, k) => k(1) + k(2); });\n`,
    },
  ],
  tasks: [{ tid: 1, moduleName: "s3" }],
  async run(api) {
    await api.reset();
    await api.init();
    await api.compileAndLoad("s3", S3_ONE_SHOT_ERROR.modules[0].sourceText);
    await api.createTask(1, "s3");
    const { capture } = await api.captureWhile(() =>
      api.run({ maxInstructions: 500_000 }),
    );
    const err = expectRuntimeErrorCodeContains(
      capture,
      "ContinuationAlreadyUsed",
    );
    if (!err.ok) return err;
    return expectConsoleExact(capture, "");
  },
};

const S4_STATE_COUNTER: SampleDefinition = {
  id: "s4-state-counter",
  title: "S4: State effect（カウンタ）",
  description: "不変言語でも効果で状態をモデル化できる（3回inc）。",
  tags: ["effects", "state", "perform"],
  modules: [
    {
      moduleName: "s4",
      role: "program",
      sourceText: `let withState = fun(s, thunk) =>
  handle thunk() with {
    return(r) => fun(st) => r;
    Get(k) => fun(st) => k(st)(st);
    Put(newS, k) => fun(st) => k(null)(newS);
  } (s);

let inc = fun() => {
  let n = perform Get();
  perform Put(n + 1);
  n + 1
};

print(withState(0, fun() => {
  inc();
  inc();
  inc()
}));
`,
    },
  ],
  tasks: [{ tid: 1, moduleName: "s4" }],
  async run(api) {
    await api.reset();
    await api.init();
    await api.compileAndLoad("s4", S4_STATE_COUNTER.modules[0].sourceText);
    await api.createTask(1, "s4");
    const { capture } = await api.captureWhile(() =>
      api.run({ maxInstructions: 5_000_000 }),
    );
    const c = expectConsoleExact(capture, "3\n");
    if (!c.ok) return c;
    return mustHaveEventType(capture, "perform");
  },
};

const S5_LOGGER: SampleDefinition = {
  id: "s5-logger",
  title: "S5: Logger effect（ログ分離）",
  description: "副作用（ログ出力）を効果として横断的に差し込む。",
  tags: ["effects", "logger", "perform"],
  modules: [
    {
      moduleName: "s5",
      role: "program",
      sourceText: `let withLogger = fun(thunk) =>
  handle thunk() with {
    return(r) => r;
    Log(msg, k) => { print(msg); k(null) };
  };

print(withLogger(fun() => {
  perform Log("start");
  perform Log("middle");
  perform Log("end");
  123
}));
`,
    },
  ],
  tasks: [{ tid: 1, moduleName: "s5" }],
  async run(api) {
    await api.reset();
    await api.init();
    await api.compileAndLoad("s5", S5_LOGGER.modules[0].sourceText);
    await api.createTask(1, "s5");
    const { capture } = await api.captureWhile(() =>
      api.run({ maxInstructions: 5_000_000 }),
    );
    const c = expectConsoleExact(capture, "start\nmiddle\nend\n123\n");
    if (!c.ok) return c;
    return mustHaveEventType(capture, "perform");
  },
};

const S6_TASKS_PINGPONG: SampleDefinition = {
  id: "s6-tasks-pingpong",
  title: "S6: タスク協調（Ping-Pong）",
  description: "2タスク + yieldで切替が見える（順序は固定しない）。",
  tags: ["tasks", "yield", "scheduler"],
  modules: [
    {
      moduleName: "s6a",
      role: "program",
      sourceText: `{ print("A1"); yield(); print("A2"); yield(); print("A3"); exit(0) };\n`,
    },
    {
      moduleName: "s6b",
      role: "program",
      sourceText: `{ print("B1"); yield(); print("B2"); yield(); print("B3"); exit(0) };\n`,
    },
  ],
  tasks: [
    { tid: 1, moduleName: "s6a" },
    { tid: 2, moduleName: "s6b" },
  ],
  async run(api) {
    await api.reset();
    await api.init();
    for (const m of S6_TASKS_PINGPONG.modules)
      await api.compileAndLoad(m.moduleName, m.sourceText);
    for (const t of S6_TASKS_PINGPONG.tasks)
      await api.createTask(t.tid, t.moduleName);

    const { capture } = await api.captureWhile(() =>
      api.run({ maxInstructions: 500_000 }),
    );

    const count = expectLineCount(capture, 6);
    if (!count.ok) return count;
    const set = expectLinesContainAll(capture, [
      "A1",
      "A2",
      "A3",
      "B1",
      "B2",
      "B3",
    ]);
    if (!set.ok) return set;
    return mustHaveEventType(capture, "taskSwitch");
  },
};

const S7_POLICY_FAIRNESS: SampleDefinition = {
  id: "s7-policy-fairness",
  title: "S7: Policy差し替え（公平⇔飢餓）",
  description: "RoundRobin と AlwaysFirst でインターリーブが変わることを確認。",
  tags: ["policy", "scheduler", "timeslice"],
  modules: [
    {
      moduleName: "s7a",
      role: "program",
      sourceText: `let burn = fun(n) => if (n == 0) { 0 } else { burn(n - 1) };
let loop = fun(n) =>
  if (n == 0) { exit(0); 0 }
  else { burn(400); print("A"); loop(n - 1) };
loop(10);
`,
    },
    {
      moduleName: "s7b",
      role: "program",
      sourceText: `let burn = fun(n) => if (n == 0) { 0 } else { burn(n - 1) };
let loop = fun(n) =>
  if (n == 0) { exit(0); 0 }
  else { burn(400); print("B"); loop(n - 1) };
loop(10);
`,
    },
    {
      moduleName: "s7rr",
      role: "policy",
      sourceText: `let mod = fun(a, b) =>
  if (a < b) { a } else { mod(a - b, b) };

let pick = fun(_nowTick, _currentTid, currentIndex, runnableCount, _domainId) =>
  mod(currentIndex + 1, runnableCount);

pick;
`,
    },
    {
      moduleName: "s7af",
      role: "policy",
      sourceText: `let pick = fun(_nowTick, _currentTid, _currentIndex, _runnableCount, _domainId) => 0;
pick;
`,
    },
  ],
  tasks: [
    { tid: 1, moduleName: "s7a" },
    { tid: 2, moduleName: "s7b" },
  ],
  async run(api) {
    const runScenario = async (policyModule: string) => {
      await api.reset();
      await api.init({ cyclesPerTick: 200, timesliceTicks: 1 });
      for (const m of S7_POLICY_FAIRNESS.modules) {
        await api.compileAndLoad(m.moduleName, m.sourceText);
      }
      for (const t of S7_POLICY_FAIRNESS.tasks)
        await api.createTask(t.tid, t.moduleName);
      await api.setSchedulerPolicy(policyModule);
      return api.captureWhile(() => api.run({ maxInstructions: 5_000_000 }));
    };

    const rr = await runScenario("s7rr");
    const af = await runScenario("s7af");

    const rrLines = splitConsoleLines(rr.capture);
    const afLines = splitConsoleLines(af.capture);

    const rrCount = rrLines.length;
    const afCount = afLines.length;
    if (rrCount !== 20 || afCount !== 20) {
      return fail(
        "unexpected line counts",
        `rr=${String(rrCount)} af=${String(afCount)}\nrr=${JSON.stringify(rrLines)}\naf=${JSON.stringify(afLines)}`,
      );
    }

    const rrFirstB = rrLines.indexOf("B");
    const rrLastA = rrLines.lastIndexOf("A");
    if (rrFirstB < 0 || rrLastA < 0)
      return fail("rr missing A/B", JSON.stringify(rrLines));
    if (!(rrFirstB < rrLastA)) {
      return fail(
        "rr did not interleave (expected B before last A)",
        JSON.stringify(rrLines),
      );
    }

    const afFirstB = afLines.indexOf("B");
    const afLastA = afLines.lastIndexOf("A");
    if (afFirstB < 0 || afLastA < 0)
      return fail("af missing A/B", JSON.stringify(afLines));
    if (!(afFirstB > afLastA)) {
      return fail(
        "always-first did not starve as expected (expected all A then B)",
        JSON.stringify(afLines),
      );
    }

    const rrPolicy = mustHaveEventType(rr.capture, "policyPick");
    if (!rrPolicy.ok) return rrPolicy;
    const afPolicy = mustHaveEventType(af.capture, "policyPick");
    if (!afPolicy.ok) return afPolicy;

    return ok("policy changed interleaving (RR vs AlwaysFirst)");
  },
};

const S8_RECORD_REPLAY_INPUT: SampleDefinition = {
  id: "s8-record-replay-input",
  title: "S8: Record/Replay（入力テープ）",
  description: "getc/putc の入力→出力が record→replay で完全再現される。",
  tags: ["record", "replay", "input"],
  modules: [
    {
      moduleName: "s8",
      role: "program",
      sourceText: `{ let a = getc(); putc(a); let b = getc(); putc(b); let c = getc(); putc(c); exit(0) };\n`,
    },
  ],
  tasks: [{ tid: 1, moduleName: "s8" }],
  async run(api) {
    await api.reset();
    await api.init();
    await api.compileAndLoad(
      "s8",
      S8_RECORD_REPLAY_INPUT.modules[0].sourceText,
    );
    await api.createTask(1, "s8");

    await api.recordStart();
    await api.inputKbd(97, true);
    await api.inputKbd(98, true);
    await api.inputKbd(99, true);
    const record = await api.captureWhile(() =>
      api.run({ maxInstructions: 500_000 }),
    );
    await api.recordStop();

    const recordCheck = expectConsoleExact(record.capture, "abc");
    if (!recordCheck.ok) return recordCheck;

    const traceJsonText = await api.getTraceJsonText();

    await api.reset();
    await api.init();
    await api.loadTraceJsonText(traceJsonText);
    await api.replayStart();
    const replay = await api.captureWhile(() =>
      api.run({ maxInstructions: 500_000 }),
    );
    await api.replayStop();

    return expectConsoleExact(replay.capture, "abc");
  },
};

export const samples: SampleDefinition[] = [
  S1_EFFECT_BASIC,
  S2_EFFECT_RESUME,
  S3_ONE_SHOT_ERROR,
  S4_STATE_COUNTER,
  S5_LOGGER,
  S6_TASKS_PINGPONG,
  S7_POLICY_FAIRNESS,
  S8_RECORD_REPLAY_INPUT,
];
