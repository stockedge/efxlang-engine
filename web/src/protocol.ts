export const PROTOCOL_VERSION = "1.0" as const;

export const EventMask = {
  Console: 1 << 0,
  Tick: 1 << 1,
  TaskSwitch: 1 << 2,
  Perform: 1 << 3,
  Continuation: 1 << 4,
  InputConsumed: 1 << 5,
  PolicyPick: 1 << 6,
  Error: 1 << 7,
} as const;

export type MsgBase = {
  version: typeof PROTOCOL_VERSION;
  requestId?: string;
};

export type CmdInit = MsgBase & {
  type: "command";
  command: "init";
  payload: {
    cyclesPerTick: number;
    timesliceTicks: number;
    snapshotEveryTicks: number;
    eventMask: number;
  };
};

export type CmdCompile = MsgBase & {
  type: "command";
  command: "compile";
  payload: {
    sourceName: string;
    sourceText: string;
  };
};

export type CmdLoadModule = MsgBase & {
  type: "command";
  command: "loadModule";
  payload: {
    moduleName: string;
    tbc: ArrayBuffer;
  };
};

export type CmdCreateTask = MsgBase & {
  type: "command";
  command: "createTask";
  payload: {
    tid: number;
    moduleName: string;
    entryFnIndex?: number;
    domainId?: number;
  };
};

export type CmdSetSchedulerPolicy = MsgBase & {
  type: "command";
  command: "setSchedulerPolicy";
  payload: {
    moduleName: string | null;
  };
};

export type CmdStep = MsgBase & {
  type: "command";
  command: "step";
  payload: { instructions: number };
};

export type CmdRun = MsgBase & {
  type: "command";
  command: "run";
  payload: {
    untilTick?: number;
    maxInstructions?: number;
  };
};

export type CmdPause = MsgBase & {
  type: "command";
  command: "pause";
};

export type CmdReverseToTick = MsgBase & {
  type: "command";
  command: "reverseToTick";
  payload: { tick: number };
};

export type CmdReset = MsgBase & {
  type: "command";
  command: "reset";
};

export type CmdRecordStart = MsgBase & {
  type: "command";
  command: "recordStart";
};

export type CmdRecordStop = MsgBase & {
  type: "command";
  command: "recordStop";
};

export type CmdGetTrace = MsgBase & {
  type: "command";
  command: "getTrace";
};

export type CmdLoadTrace = MsgBase & {
  type: "command";
  command: "loadTrace";
  payload: { traceJsonText: string };
};

export type CmdReplayStart = MsgBase & {
  type: "command";
  command: "replayStart";
};

export type CmdReplayStop = MsgBase & {
  type: "command";
  command: "replayStop";
};

export type CmdGetState = MsgBase & {
  type: "command";
  command: "getState";
  payload: { detail: "summary" | "full" };
};

export type CmdInputKbd = MsgBase & {
  type: "command";
  command: "inputKbd";
  payload: { byte: number; isDown: boolean };
};

export type CommandMessage =
  | CmdInit
  | CmdCompile
  | CmdLoadModule
  | CmdCreateTask
  | CmdSetSchedulerPolicy
  | CmdStep
  | CmdRun
  | CmdPause
  | CmdReverseToTick
  | CmdReset
  | CmdRecordStart
  | CmdRecordStop
  | CmdGetTrace
  | CmdLoadTrace
  | CmdReplayStart
  | CmdReplayStop
  | CmdGetState
  | CmdInputKbd;

export type RespOk = MsgBase & {
  type: "response";
  requestId: string;
  ok: true;
  payload?: unknown;
};

export type RespErr = MsgBase & {
  type: "response";
  requestId: string;
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type Diagnostics = Array<{
  severity: "warn" | "info";
  message: string;
  line?: number;
  col?: number;
}>;

export type CompileOkPayload = {
  tbc: ArrayBuffer;
  diagnostics: Diagnostics;
};

export type RespCompileOk = MsgBase & {
  type: "response";
  requestId: string;
  ok: true;
  payload: CompileOkPayload;
};

export type DeosUiEvent =
  | {
      type: "console";
      cycle: string;
      tick: number;
      tid: number;
      text: string;
    }
  | {
      type: "tick";
      cycle: string;
      tick: number;
    }
  | {
      type: "taskSwitch";
      cycle: string;
      tick: number;
      fromTid: number;
      toTid: number;
      reason: "timeslice" | "yield" | "sleepWake";
    }
  | {
      type: "perform";
      cycle: string;
      tick: number;
      tid: number;
      effect: string;
      argc: number;
    }
  | {
      type: "contCall";
      cycle: string;
      tick: number;
      tid: number;
      oneShotUsedBefore: boolean;
    }
  | {
      type: "contReturn";
      cycle: string;
      tick: number;
      tid: number;
    }
  | {
      type: "inputConsumed";
      cycle: string;
      tick: number;
      kind: "KBD";
      byte: number;
      isDown: boolean;
    }
  | {
      type: "policyPick";
      cycle: string;
      tick: number;
      currentTid: number;
      pickedIndex: number;
      runnableTids: number[];
    }
  | {
      type: "error";
      cycle: string;
      tick: number;
      tid?: number;
      code: string;
      message: string;
      details?: unknown;
    };

export type UiEventMessage = MsgBase & {
  type: "event";
  event: DeosUiEvent;
};

export type WorkerMessage = RespOk | RespErr | UiEventMessage | RespCompileOk;

export type UnknownCommandMessage = {
  type: "command";
  version?: unknown;
  requestId?: unknown;
  command?: unknown;
  payload?: unknown;
};

export function isCommandMessage(v: unknown): v is UnknownCommandMessage {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { type?: unknown }).type === "command"
  );
}
