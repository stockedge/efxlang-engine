import { Value } from "./value";

export enum VMStatus {
  RUNNING,
  HALTED,
  SAFEPOINT,
  SYSCALL,
  FAULT,
}

export interface VMResult {
  status: VMStatus;
  value?: Value;
  sysno?: number;
  cycles: number;
}
