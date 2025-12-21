import { DeosEngine } from "./deos_engine";
import { createWasmEngine } from "./wasm_engine";

export type Engine = {
  init: (
    cyclesPerTick: number,
    timesliceTicks: number,
    snapshotEveryTicks: number,
    eventMask: number,
  ) => number;
  reset: () => number;

  loadModule: (moduleName: string, tbcBytes: Uint8Array) => number;
  unloadAllModules: () => number;

  createTask: (
    tid: number,
    moduleName: string,
    entryFnIndex: number,
    domainId: number,
  ) => number;
  killTask: (tid: number) => number;

  setSchedulerPolicy: (moduleNameOrNull: string | null) => number;

  inputKbd: (byte: number, isDown: boolean) => number;
  scheduleKbd: (atCycle: bigint, byte: number, isDown: boolean) => number;

  setPaused: (paused: boolean) => void;
  getPaused: () => boolean;

  step: (n: number) => number;
  runUntilTick: (targetTick: number, maxInstructions: number) => 0 | 1;

  pollEventJson: () => string | null;
  getStateJson: (detail: "summary" | "full") => string;

  exportSnapshotJson: () => string;
  loadSnapshotJson: (json: string) => number;

  recordStart: () => number;
  recordStop: () => number;
  replayStart: () => number;
  replayStop: () => number;

  getLastErrorJson: () => string;
};

export async function createEngine(): Promise<Engine> {
  try {
    return await createWasmEngine();
  } catch {
    return new DeosEngine();
  }
}
