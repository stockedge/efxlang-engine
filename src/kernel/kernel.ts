import { type Task, TaskState } from "./task";
import { VM } from "../vm/vm";
import { type TBCFile } from "../lang/codegen";
import { VMStatus, type VMResult } from "../vm/status";
import { SyscallType } from "../bytecode/opcode";
import { Fiber } from "../vm/fiber";
import { TBCDecoder } from "../bytecode/bin";
import { Env } from "../vm/env";
import { TraceManager, type TraceFile } from "../trace/trace";
import { StateSerializer } from "../trace/snapshot";
import { type Value } from "../vm/value"; // Added this import for Value type

export enum KernelMode {
  NORMAL,
  RECORD,
  REPLAY,
}

export interface ImageFormat {
  tbc: string; // base64
  tasks: { fn: number; priority: number }[];
}

export class Kernel {
  private tasks: Task[] = [];
  private currentTaskIndex: number = -1;
  private totalCycles: bigint = 0n;
  private stdout: string = "";
  private mode: KernelMode = KernelMode.NORMAL;
  private traceManager?: TraceManager;
  private lastSnapshotCycle: bigint = 0n;
  private snapshotInterval: bigint = 1000n;

  static fromImage(image: ImageFormat): Kernel {
    const bytes = Buffer.from(image.tbc, "base64");
    const tbc = new TBCDecoder(bytes).decode();
    const kernel = new Kernel(tbc);
    for (const t of image.tasks) {
      kernel.spawnEntry(t.fn, t.priority);
    }
    return kernel;
  }

  constructor(private tbc: TBCFile) {}

  setRecordMode(imageHash: string) {
    this.mode = KernelMode.RECORD;
    this.traceManager = new TraceManager(imageHash);
  }

  setReplayMode(trace: TraceFile) {
    this.mode = KernelMode.REPLAY;
    this.traceManager = TraceManager.fromJSON(trace);
  }

  getTrace(): TraceFile | undefined {
    return this.traceManager?.toJSON();
  }

  spawnEntry(fnIdx: number, priority: number = 100): number {
    const fiber = new Fiber();
    const entryFn = this.tbc.functions.at(fnIdx);
    if (!entryFn)
      throw new Error(`Invalid entry function index ${String(fnIdx)}`);
    const env = new Env(undefined, entryFn.locals);
    fiber.callStack.push({
      fnIndex: fnIdx,
      ip: 0,
      env: env,
    });
    return this.spawn(fiber, priority);
  }

  spawn(fiber: Fiber = new Fiber(), priority: number = 100): number {
    const id = this.tasks.length;
    this.tasks.push({
      id,
      fiber,
      state: TaskState.READY,
      priority,
      waitCycle: 0n,
    });
    return id;
  }

  run(): void {
    while (this.hasIncompleteTasks()) {
      this.pickNextTask();
      if (this.currentTaskIndex === -1) {
        const nextEvent = this.getNextUnblockCycle();
        if (nextEvent > this.totalCycles) {
          this.totalCycles = nextEvent;
        } else {
          this.totalCycles++;
        }
        continue;
      }

      const task = this.tasks[this.currentTaskIndex];
      task.state = TaskState.RUNNING;

      const vm = new VM(this.tbc, task.fiber);
      const res = vm.run();

      this.handleVMResult(task, vm, res);
      this.maybeTakeSnapshot();
    }
  }

  private handleVMResult(task: Task, vm: VM, res: VMResult): void {
    switch (res.status) {
      case VMStatus.HALTED:
        task.state = TaskState.DONE;
        break;
      case VMStatus.SAFEPOINT:
        task.state = TaskState.READY;
        break;
      case VMStatus.SYSCALL: {
        if (res.sysno === undefined) {
          throw new Error("SYSCALL result missing sysno");
        }
        this.handleSyscall(task, vm, res.sysno);
        break;
      }
      default:
        task.state = TaskState.DONE; // Default to done for unhandled statuses
        break;
    }
  }

  private handleSyscall(task: Task, vm: VM, sysno: number): void {
    if (!(sysno in SyscallType)) {
      vm.push(null);
      task.state = TaskState.READY;
      return;
    }

    const syscall = sysno as SyscallType;
    let result: Value | null = null; // Refined type to allow null

    if (this.mode === KernelMode.REPLAY) {
      const ev = this.traceManager?.getEventAt(
        this.totalCycles,
        "syscall",
        task.id,
      );
      if (ev?.no === sysno) {
        result = ev.res as Value; // Assert type for replay result
      }
    }

    switch (syscall) {
      case SyscallType.SYS_PRINT: {
        const val = vm.pop();
        if (this.mode !== KernelMode.REPLAY) {
          this.stdout += this.stringify(val) + "\n";
        }
        vm.push(null);
        task.state = TaskState.READY;
        break;
      }
      case SyscallType.SYS_YIELD:
        task.state = TaskState.READY;
        vm.push(null);
        break;
      case SyscallType.SYS_SLEEP: {
        const ms = vm.pop() as number;
        task.waitCycle = this.totalCycles + BigInt(ms);
        task.state = TaskState.BLOCKED;
        vm.push(null);
        break;
      }
      case SyscallType.SYS_EXIT:
        task.state = TaskState.DONE;
        break;
      case SyscallType.SYS_PUTC: {
        const char = vm.pop() as number;
        if (this.mode !== KernelMode.REPLAY) {
          this.stdout += String.fromCharCode(char);
        }
        vm.push(null);
        task.state = TaskState.READY;
        break;
      }
      default:
        vm.push(null);
        task.state = TaskState.READY;
        break;
    }

    if (this.mode === KernelMode.RECORD) {
      this.traceManager?.addEvent(this.totalCycles, "syscall", task.id, {
        no: sysno,
        res: result as unknown,
      });
    }
  }

  private maybeTakeSnapshot(): void {
    if (
      this.mode === KernelMode.RECORD &&
      this.totalCycles - this.lastSnapshotCycle >= this.snapshotInterval
    ) {
      const ser = new StateSerializer();
      const data = ser.serializeTasks(this.tasks);
      const hash = StateSerializer.hashState(data);
      this.traceManager?.addSnapshot(this.totalCycles, hash, data);
      this.lastSnapshotCycle = this.totalCycles;
    }
    if (this.mode === KernelMode.REPLAY) {
      const snap = this.traceManager?.getSnapshotAt(this.totalCycles);
      if (snap) {
        const ser = new StateSerializer();
        const data = ser.serializeTasks(this.tasks);
        const hash = StateSerializer.hashState(data);
        if (hash !== snap.state_hash) {
          throw new Error(
            `Replay mismatch at cycle ${this.totalCycles.toString()}. Expected ${snap.state_hash}, got ${hash}`,
          );
        }
      }
    }
  }

  private stringify(v: Value | null): string {
    if (v === null) return "null";
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (typeof v === "string") return v;

    switch (v.tag) {
      case "Closure":
        return `Closure(fn=${String(v.fnIndex)})`;
      case "Cont":
        return `Cont(used=${String(v.used)})`;
    }
  }

  private hasIncompleteTasks(): boolean {
    return this.tasks.some((t) => t.state !== TaskState.DONE);
  }

  private pickNextTask(): void {
    for (let i = 0; i < this.tasks.length; i++) {
      const idx = (this.currentTaskIndex + 1 + i) % this.tasks.length;
      const t = this.tasks[idx];
      if (t.state === TaskState.READY) {
        this.currentTaskIndex = idx;
        return;
      }
      if (t.state === TaskState.BLOCKED && this.totalCycles >= t.waitCycle) {
        t.state = TaskState.READY;
        this.currentTaskIndex = idx;
        return;
      }
    }
    this.currentTaskIndex = -1;
  }

  private getNextUnblockCycle(): bigint {
    let min = this.totalCycles + 1000n;
    let found = false;
    for (const t of this.tasks) {
      if (t.state === TaskState.BLOCKED) {
        if (!found || t.waitCycle < min) {
          min = t.waitCycle;
          found = true;
        }
      }
    }
    return min;
  }

  public getOutput(): string {
    return this.stdout;
  }
}
