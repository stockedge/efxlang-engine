import type { DeosUiEvent } from "../protocol";

export type DeosTraceV1 = {
  version: "1.0";
  config: {
    cyclesPerTick: number;
    timesliceTicks: number;
    snapshotEveryTicks: number;
    eventMask: number;
  };
  modules: Array<{ name: string; tbcBase64: string }>;
  tasks: Array<{
    tid: number;
    moduleName: string;
    entryFnIndex: number;
    domainId: number;
  }>;
  policy: { moduleName: string | null };
  events: Array<Extract<DeosUiEvent, { type: "inputConsumed" }>>;
  output: Array<Extract<DeosUiEvent, { type: "console" }>>;
  snapshots: Array<{
    tick: number;
    cycle: string;
    stateHash: string;
    snapshotJson: string;
  }>;
};
