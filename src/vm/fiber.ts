import { type Value, type Closure } from "./value";
import { type Env } from "./env";

export interface Frame {
  fnIndex: number;
  ip: number;
  env: Env;
}

export interface HandlerFrame {
  clauses: Array<{ effectNameConst: number; clause: Closure }>;
  onReturn: Closure | null;
  baseCallDepth: number;
  baseValueHeight: number;
  doneFnIndex: number;
  donePc: number;
}

export class Fiber {
  public valueStack: Value[] = [];
  public callStack: Frame[] = [];
  public handlerStack: HandlerFrame[] = [];

  public yielding: boolean = false;
  public yieldFnIndex: number = -1;
  public yieldPc: number = -1;

  public parent?: Fiber;

  constructor() {}
}
