import { type Env } from "./env";

export type Value = number | boolean | string | null | Closure | Continuation;

export interface Closure {
  tag: "Closure";
  fnIndex: number;
  env: Env;
}

export interface Continuation {
  tag: "Cont";
  used: boolean;
  snap: FiberSnapshot;
}

export interface FiberSnapshot {
  valueStack: Value[];
  callStack: FrameSnapshot[];
  handlerStack: HandlerFrameSnapshot[];
  yieldFnIndex: number;
  yieldPc: number;
}

export interface FrameSnapshot {
  fnIndex: number;
  ip: number;
  env: Env;
}

export interface HandlerFrameSnapshot {
  clauses: Array<{ effectNameConst: number; clause: Closure }>;
  onReturn: Closure | null;
  baseCallDepth: number;
  baseValueHeight: number;
  doneFnIndex: number;
  donePc: number;
}
