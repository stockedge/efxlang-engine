import { type Fiber } from "../vm/fiber";

export enum TaskState {
  READY = "READY",
  RUNNING = "RUNNING",
  BLOCKED = "BLOCKED",
  DONE = "DONE",
}

export interface Task {
  id: number;
  fiber: Fiber;
  state: TaskState;
  priority: number;
  waitCycle: bigint; // for sleep
}
