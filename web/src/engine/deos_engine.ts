import { TBCDecoder, TBCEncoder } from "@core/bytecode/bin";
import { SyscallType } from "@core/bytecode/opcode";
import { type Task, TaskState } from "@core/kernel/task";
import type { TBCFile } from "@core/lang/codegen";
import { StateDeserializer, StateSerializer } from "@core/trace/snapshot";
import { Env } from "@core/vm/env";
import { Fiber } from "@core/vm/fiber";
import { type VMResult, VMStatus } from "@core/vm/status";
import type { Closure, Value } from "@core/vm/value";
import { VM } from "@core/vm/vm";

import {
  type DeosUiEvent,
  type Diagnostics,
  EventMask,
  PROTOCOL_VERSION,
} from "../protocol";

type EngineMode = "normal" | "record" | "replay";
type TaskRunState = "RUNNABLE" | "BLOCKED" | "EXITED";

type EngineTask = {
  tid: number;
  moduleName: string;
  domainId: number;
  entryFnIndex: number;
  state: TaskRunState;
  wakeTick: number;
  vm: VM;
};

type SnapshotV1 = {
  version: "1.0";
  config: {
    cyclesPerTick: number;
    timesliceTicks: number;
    snapshotEveryTicks: number;
    eventMask: number;
  };
  cycle: string;
  tick: number;
  currentTid: number | null;
  timesliceUsed: number;
  lastSafepointTick: number;
  yieldRequested: boolean;
  kbdQueue: number[];
  policy: { moduleName: string | null };
  taskModules: Array<{
    tid: number;
    moduleName: string;
    entryFnIndex: number;
    domainId: number;
  }>;
  vmState: ReturnType<StateSerializer["serializeTasks"]>;
  stateHash: string;
};

function clampU32(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  return Math.min(0xffff_ffff, Math.floor(v));
}

function isAsciiByte(v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v <= 255;
}

function valueToDeterministicString(v: Value): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (Number.isNaN(v)) return "NaN";
      if (Object.is(v, -0)) return "-0";
      return String(v);
    case "string":
      return v;
    case "object": {
      switch (v.tag) {
        case "Closure":
          return `<closure fn#${String(v.fnIndex)}>`;
        case "Cont":
          return `<cont used=${v.used ? "true" : "false"}>`;
      }
    }
  }
}

export class DeosEngine {
  private mode: EngineMode = "normal";
  private paused = false;

  private cyclesPerTick = 10_000n;
  private timesliceTicks = 1;
  private snapshotEveryTicks = 100;
  private eventMask =
    EventMask.Console |
    EventMask.Tick |
    EventMask.TaskSwitch |
    EventMask.Perform |
    EventMask.Continuation |
    EventMask.InputConsumed |
    EventMask.PolicyPick |
    EventMask.Error;

  private cycle: bigint = 0n;
  private tick = 0;

  private modules = new Map<string, { tbc: TBCFile; bytes: Uint8Array }>();
  private tasks = new Map<number, EngineTask>();
  private currentTid: number | null = null;

  private hostKbdQueue: Array<{ byte: number; isDown: boolean }> = [];
  private kbdQueue: number[] = [];
  private replaySchedule: Array<{
    atCycle: bigint;
    byte: number;
    isDown: boolean;
  }> = [];

  private policy: { moduleName: string | null; closure: Closure | null } = {
    moduleName: null,
    closure: null,
  };
  private lastPolicyPick: {
    currentTid: number;
    pickedIndex: number;
    runnableTids: number[];
  } | null = null;

  private timesliceUsed = 0;
  private lastSafepointTick = 0;
  private yieldRequested = false;

  private eventFifo: string[] = [];
  private lastError: {
    code: string;
    message: string;
    details?: unknown;
  } | null = null;

  // Context for VM hooks (set per executed instruction).
  private execCycle: bigint = 0n;
  private execTick = 0;

  apiVersion(): number {
    return 0x0001_0000;
  }

  init(
    cyclesPerTick: number,
    timesliceTicks: number,
    snapshotEveryTicks: number,
    eventMask: number,
  ): number {
    this.cyclesPerTick = BigInt(Math.max(1, clampU32(cyclesPerTick)));
    this.timesliceTicks = Math.max(1, clampU32(timesliceTicks));
    this.snapshotEveryTicks = Math.max(1, clampU32(snapshotEveryTicks));
    this.eventMask = clampU32(eventMask);
    return 0;
  }

  reset(): number {
    this.mode = "normal";
    this.paused = false;
    this.cycle = 0n;
    this.tick = 0;
    this.tasks.clear();
    this.currentTid = null;
    this.hostKbdQueue = [];
    this.kbdQueue = [];
    this.replaySchedule = [];
    this.policy = { moduleName: null, closure: null };
    this.lastPolicyPick = null;
    this.timesliceUsed = 0;
    this.lastSafepointTick = 0;
    this.yieldRequested = false;
    this.eventFifo = [];
    this.lastError = null;
    return 0;
  }

  encodeModule(tbc: TBCFile): Uint8Array {
    return new TBCEncoder().encode(tbc);
  }

  decodeModule(bytes: Uint8Array): TBCFile {
    return new TBCDecoder(bytes).decode();
  }

  loadModule(moduleName: string, tbcBytes: Uint8Array): number {
    const tbc = this.decodeModule(tbcBytes);
    this.modules.set(moduleName, { tbc, bytes: new Uint8Array(tbcBytes) });
    return 0;
  }

  unloadAllModules(): number {
    this.modules.clear();
    return 0;
  }

  createTask(
    tid: number,
    moduleName: string,
    entryFnIndex: number,
    domainId: number,
  ): number {
    const mod = this.modules.get(moduleName);
    if (!mod) throw new Error(`ModuleNotLoaded: ${moduleName}`);

    const fn = mod.tbc.functions.at(entryFnIndex);
    if (!fn) throw new Error(`InvalidEntryFnIndex: ${String(entryFnIndex)}`);

    const fiber = new Fiber();
    const env = new Env(undefined, fn.locals);
    fiber.callStack.push({ fnIndex: entryFnIndex, ip: 0, env });

    const vm = new VM(mod.tbc, fiber, {
      hooks: {
        onPerform: ({ effect, argc }) => {
          this.emit({
            type: "perform",
            cycle: this.execCycle.toString(),
            tick: this.execTick,
            tid,
            effect,
            argc,
          });
        },
        onContCall: ({ oneShotUsedBefore }) => {
          this.emit({
            type: "contCall",
            cycle: this.execCycle.toString(),
            tick: this.execTick,
            tid,
            oneShotUsedBefore,
          });
        },
        onContReturn: () => {
          this.emit({
            type: "contReturn",
            cycle: this.execCycle.toString(),
            tick: this.execTick,
            tid,
          });
        },
      },
    });

    this.tasks.set(tid, {
      tid,
      moduleName,
      domainId,
      entryFnIndex,
      state: "RUNNABLE",
      wakeTick: 0,
      vm,
    });

    this.currentTid ??= tid;
    return 0;
  }

  killTask(tid: number): number {
    this.tasks.delete(tid);
    if (this.currentTid === tid) this.currentTid = null;
    return 0;
  }

  setSchedulerPolicy(moduleNameOrNull: string | null): number {
    if (!moduleNameOrNull) {
      this.policy = { moduleName: null, closure: null };
      return 0;
    }

    const mod = this.modules.get(moduleNameOrNull);
    if (!mod) throw new Error(`ModuleNotLoaded: ${moduleNameOrNull}`);

    // Policy module: run its entry once to obtain a Closure as last value.
    const vm = new VM(mod.tbc, new Fiber(), { debug: false });
    const val = this.runVmToHalt(vm, 200_000);
    if (!val || typeof val !== "object" || val.tag !== "Closure") {
      throw new Error("PolicyMustReturnClosure");
    }

    this.policy = { moduleName: moduleNameOrNull, closure: val };
    return 0;
  }

  inputKbd(byte: number, isDown: boolean): number {
    if (!isAsciiByte(byte)) return -1;
    if (this.mode === "replay") return 0; // ignore live input during replay
    this.hostKbdQueue.push({ byte, isDown });
    return 0;
  }

  scheduleKbd(atCycle: bigint, byte: number, isDown: boolean): number {
    if (!isAsciiByte(byte)) return -1;
    const ev = { atCycle, byte, isDown };
    // Keep stable ascending order (insertion).
    let i = this.replaySchedule.length;
    while (i > 0 && this.replaySchedule[i - 1].atCycle > atCycle) i--;
    this.replaySchedule.splice(i, 0, ev);
    return 0;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  getPaused(): boolean {
    return this.paused;
  }

  recordStart(): number {
    this.mode = "record";
    return 0;
  }

  recordStop(): number {
    this.mode = "normal";
    return 0;
  }

  replayStart(): number {
    this.mode = "replay";
    return 0;
  }

  replayStop(): number {
    this.mode = "normal";
    this.replaySchedule = [];
    return 0;
  }

  pollEventJson(): string | null {
    return this.eventFifo.shift() ?? null;
  }

  getLastErrorJson(): string {
    return JSON.stringify(this.lastError ?? null);
  }

  getClock() {
    return { cycle: this.cycle.toString(), tick: this.tick };
  }

  step(n: number): number {
    const target = clampU32(n);
    let executed = 0;

    while (executed < target) {
      if (this.paused) break;

      const task = this.getCurrentRunnableTask();
      if (!task) break;

      const isVirtualReturn = this.isContReturnStep(task.vm.fiber);
      if (isVirtualReturn) {
        this.execCycle = this.cycle;
        this.execTick = this.tick;
      } else {
        const nextCycle = this.cycle + 1n;
        const nextTick = Number(nextCycle / this.cyclesPerTick);
        this.execCycle = nextCycle;
        this.execTick = nextTick;

        if (nextTick !== this.tick) {
          this.emit({
            type: "tick",
            cycle: nextCycle.toString(),
            tick: nextTick,
          });
        }
      }

      let res: VMResult;
      try {
        res = task.vm.step();
      } catch (e) {
        this.handleRuntimeError(task, e);
        // Kill the task on VM crash.
        task.state = "EXITED";
        if (!isVirtualReturn) {
          this.cycle = this.execCycle;
          this.tick = this.execTick;
          executed += 1;
        }
        this.switchTask("sleepWake");
        continue;
      }

      if (res.cycles === 1) {
        this.cycle = this.execCycle;
        this.tick = this.execTick;
        executed += 1;
      }

      if (res.status === VMStatus.SYSCALL) {
        this.handleSyscall(task, res.sysno ?? 0);
        continue;
      }

      if (res.status === VMStatus.SAFEPOINT) {
        this.handleSafepoint(task);
        continue;
      }

      if (res.status === VMStatus.HALTED) {
        task.state = "EXITED";
        this.switchTask("sleepWake");
        continue;
      }
    }

    return executed;
  }

  runUntilTick(targetTick: number, maxInstructions: number): 0 | 1 {
    const target = clampU32(targetTick);
    const max = clampU32(maxInstructions);
    let executed = 0;

    while (this.tick < target) {
      if (this.paused) break;
      if (executed >= max) return 1;
      const did = this.step(Math.min(50_000, max - executed));
      if (did === 0) break;
      executed += did;
    }

    return 0;
  }

  getStateJson(detail: "summary" | "full"): string {
    const tasks = Array.from(this.tasks.values()).sort((a, b) => a.tid - b.tid);
    const runnable = tasks
      .filter((t) => t.state === "RUNNABLE")
      .map((t) => t.tid);
    const blocked = tasks
      .filter((t) => t.state === "BLOCKED")
      .map((t) => t.tid);
    const exited = tasks.filter((t) => t.state === "EXITED").map((t) => t.tid);

    const summary = {
      version: PROTOCOL_VERSION,
      cycle: this.cycle.toString(),
      tick: this.tick,
      currentTid: this.currentTid,
      runnable,
      blocked,
      exited,
      tasks: tasks.map((t) => ({
        tid: t.tid,
        moduleName: t.moduleName,
        state: t.state,
        wakeTick: t.wakeTick,
        callStackDepth: t.vm.fiber.callStack.length,
        valueStackHeight: t.vm.fiber.valueStack.length,
        handlerStackDepth: t.vm.fiber.handlerStack.length,
        yielding: t.vm.fiber.yielding,
      })),
      policy: this.policy.moduleName
        ? {
            moduleName: this.policy.moduleName,
            lastPick: this.lastPolicyPick,
          }
        : null,
    };

    if (detail === "summary") return JSON.stringify(summary);

    const current =
      this.currentTid !== null
        ? (this.tasks.get(this.currentTid) ?? null)
        : null;

    const full = {
      ...summary,
      currentTask: current
        ? {
            tid: current.tid,
            moduleName: current.moduleName,
            state: current.state,
            callStack: current.vm.fiber.callStack.map((fr) => ({
              fnIndex: fr.fnIndex,
              ip: fr.ip,
            })),
            valueStack: current.vm.fiber.valueStack
              .slice(-50)
              .map((v) => valueToDeterministicString(v)),
            handlerStack: current.vm.fiber.handlerStack.map((h) => ({
              doneFnIndex: h.doneFnIndex,
              donePc: h.donePc,
              baseCallDepth: h.baseCallDepth,
              baseValueHeight: h.baseValueHeight,
              clauses: h.clauses.map((c) => ({
                effectNameConst: c.effectNameConst,
                clauseFnIndex: c.clause.fnIndex,
              })),
            })),
          }
        : null,
    };

    return JSON.stringify(full);
  }

  exportSnapshotJson(): string {
    const tasks = Array.from(this.tasks.values()).map((t): Task => {
      const state =
        t.state === "RUNNABLE"
          ? TaskState.READY
          : t.state === "BLOCKED"
            ? TaskState.BLOCKED
            : TaskState.DONE;

      return {
        id: t.tid,
        fiber: t.vm.fiber,
        state,
        priority: 100,
        waitCycle: BigInt(t.wakeTick),
      };
    });

    const ser = new StateSerializer();
    const vmState = ser.serializeTasks(tasks);
    const stateHash = StateSerializer.hashState(vmState);

    const snapshot: SnapshotV1 = {
      version: "1.0",
      config: {
        cyclesPerTick: Number(this.cyclesPerTick),
        timesliceTicks: this.timesliceTicks,
        snapshotEveryTicks: this.snapshotEveryTicks,
        eventMask: this.eventMask,
      },
      cycle: this.cycle.toString(),
      tick: this.tick,
      currentTid: this.currentTid,
      timesliceUsed: this.timesliceUsed,
      lastSafepointTick: this.lastSafepointTick,
      yieldRequested: this.yieldRequested,
      kbdQueue: [...this.kbdQueue],
      policy: { moduleName: this.policy.moduleName },
      taskModules: Array.from(this.tasks.values()).map((t) => ({
        tid: t.tid,
        moduleName: t.moduleName,
        entryFnIndex: t.entryFnIndex,
        domainId: t.domainId,
      })),
      vmState,
      stateHash,
    };

    return JSON.stringify(snapshot);
  }

  loadSnapshotJson(json: string): number {
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { version?: unknown }).version !== "1.0"
    ) {
      throw new Error("BadSnapshotVersion");
    }
    const snap = parsed as SnapshotV1;

    this.init(
      snap.config.cyclesPerTick,
      snap.config.timesliceTicks,
      snap.config.snapshotEveryTicks,
      snap.config.eventMask,
    );

    this.cycle = BigInt(snap.cycle);
    this.tick = snap.tick;
    this.currentTid = snap.currentTid;
    this.timesliceUsed = snap.timesliceUsed;
    this.lastSafepointTick = snap.lastSafepointTick;
    this.yieldRequested = snap.yieldRequested;
    this.kbdQueue = [...snap.kbdQueue];
    this.policy.moduleName = snap.policy.moduleName;
    this.policy.closure = null;
    this.lastPolicyPick = null;

    const taskModuleByTid = new Map<
      number,
      SnapshotV1["taskModules"][number]
    >();
    for (const tm of snap.taskModules) taskModuleByTid.set(tm.tid, tm);

    const deser = new StateDeserializer();
    const coreTasks = deser.deserializeTasks(snap.vmState);

    this.tasks.clear();
    for (const t of coreTasks) {
      const tm = taskModuleByTid.get(t.id);
      if (!tm) throw new Error(`SnapshotMissingTaskModule: ${String(t.id)}`);
      const mod = this.modules.get(tm.moduleName);
      if (!mod) throw new Error(`ModuleNotLoaded: ${tm.moduleName}`);

      const vm = new VM(mod.tbc, t.fiber, {
        hooks: {
          onPerform: ({ effect, argc }) => {
            this.emit({
              type: "perform",
              cycle: this.execCycle.toString(),
              tick: this.execTick,
              tid: t.id,
              effect,
              argc,
            });
          },
          onContCall: ({ oneShotUsedBefore }) => {
            this.emit({
              type: "contCall",
              cycle: this.execCycle.toString(),
              tick: this.execTick,
              tid: t.id,
              oneShotUsedBefore,
            });
          },
          onContReturn: () => {
            this.emit({
              type: "contReturn",
              cycle: this.execCycle.toString(),
              tick: this.execTick,
              tid: t.id,
            });
          },
        },
      });

      const state =
        t.state === TaskState.BLOCKED
          ? "BLOCKED"
          : t.state === TaskState.DONE
            ? "EXITED"
            : "RUNNABLE";

      this.tasks.set(t.id, {
        tid: t.id,
        moduleName: tm.moduleName,
        entryFnIndex: tm.entryFnIndex,
        domainId: tm.domainId,
        state,
        wakeTick: Number(t.waitCycle),
        vm,
      });
    }

    if (this.policy.moduleName) {
      // Re-hydrate the policy closure from the module again.
      this.setSchedulerPolicy(this.policy.moduleName);
    }

    if (this.currentTid === null) {
      const first = Array.from(this.tasks.values()).find(
        (t) => t.state === "RUNNABLE",
      );
      if (first) this.currentTid = first.tid;
    }

    return 0;
  }

  compileEfx(
    sourceName: string,
    sourceText: string,
    compile: (sourceText: string) => TBCFile,
  ):
    | { ok: true; payload: { tbcBytes: Uint8Array; diagnostics: Diagnostics } }
    | { ok: false; error: unknown } {
    try {
      const tbc = compile(sourceText);
      const tbcBytes = this.encodeModule(tbc);
      return { ok: true, payload: { tbcBytes, diagnostics: [] } };
    } catch (e) {
      return { ok: false, error: { sourceName, error: String(e) } };
    }
  }

  private runVmToHalt(vm: VM, maxSteps: number): Value {
    for (let steps = 0; steps < maxSteps; steps++) {
      const res = vm.step();
      if (res.status === VMStatus.HALTED) return res.value ?? null;
      if (res.status === VMStatus.SAFEPOINT) continue;
      if (res.status === VMStatus.SYSCALL) throw new Error("SyscallDenied");
    }
    throw new Error("PolicyTimeout");
  }

  private handleSyscall(task: EngineTask, sysno: number) {
    const tid = task.tid;
    if (!(sysno in SyscallType)) {
      task.vm.push(null);
      return;
    }
    const syscall = sysno as SyscallType;
    switch (syscall) {
      case SyscallType.SYS_PRINT: {
        const v = task.vm.pop();
        const text = valueToDeterministicString(v) + "\n";
        this.emit({
          type: "console",
          cycle: this.execCycle.toString(),
          tick: this.execTick,
          tid,
          text,
        });
        task.vm.push(null);
        break;
      }
      case SyscallType.SYS_PUTC: {
        const c = task.vm.pop();
        const n = typeof c === "number" ? c : 0;
        const text = String.fromCharCode(n & 0xff);
        this.emit({
          type: "console",
          cycle: this.execCycle.toString(),
          tick: this.execTick,
          tid,
          text,
        });
        task.vm.push(null);
        break;
      }
      case SyscallType.SYS_GETC: {
        const v = this.kbdQueue.shift();
        task.vm.push(v ?? -1);
        break;
      }
      case SyscallType.SYS_YIELD: {
        task.vm.push(null);
        this.yieldRequested = true;
        break;
      }
      case SyscallType.SYS_SLEEP: {
        const ticksVal = task.vm.pop();
        const ticks =
          typeof ticksVal === "number" && Number.isFinite(ticksVal)
            ? Math.max(0, Math.floor(ticksVal))
            : 0;
        task.wakeTick = this.tick + ticks;
        task.state = "BLOCKED";
        task.vm.push(null);
        this.switchTask("sleepWake");
        break;
      }
      case SyscallType.SYS_EXIT: {
        task.vm.pop(); // code (ignored in v1.0)
        task.state = "EXITED";
        task.vm.push(null);
        this.switchTask("sleepWake");
        break;
      }
      default:
        task.vm.push(null);
        break;
    }
  }

  private handleSafepoint(_task: EngineTask) {
    // 1) Input injection (replay schedule first).
    while (
      this.replaySchedule.length > 0 &&
      this.replaySchedule[0].atCycle <= this.cycle
    ) {
      const ev = this.replaySchedule.shift();
      if (!ev) break;
      this.kbdQueue.push(ev.byte);
      this.emit({
        type: "inputConsumed",
        cycle: this.cycle.toString(),
        tick: this.tick,
        kind: "KBD",
        byte: ev.byte,
        isDown: ev.isDown,
      });
    }

    if (this.mode !== "replay") {
      while (this.hostKbdQueue.length > 0) {
        const ev = this.hostKbdQueue.shift();
        if (!ev) break;
        this.kbdQueue.push(ev.byte);
        this.emit({
          type: "inputConsumed",
          cycle: this.cycle.toString(),
          tick: this.tick,
          kind: "KBD",
          byte: ev.byte,
          isDown: ev.isDown,
        });
      }
    }

    // 2) Unblock tasks.
    for (const t of this.tasks.values()) {
      if (t.state === "BLOCKED" && this.tick >= t.wakeTick) {
        t.state = "RUNNABLE";
      }
    }

    // 3) timeslice accounting.
    if (this.currentTid !== null) {
      const ranTicks = this.tick - this.lastSafepointTick;
      if (ranTicks > 0) {
        this.timesliceUsed += ranTicks;
        this.lastSafepointTick = this.tick;
      }

      if (this.timesliceUsed >= this.timesliceTicks) {
        this.timesliceUsed = 0;
        this.switchTask("timeslice");
        return;
      }
    }

    if (this.yieldRequested) {
      this.yieldRequested = false;
      this.switchTask("yield");
      return;
    }
  }

  private switchTask(reason: "timeslice" | "yield" | "sleepWake") {
    const runnable = Array.from(this.tasks.values())
      .filter((t) => t.state === "RUNNABLE")
      .sort((a, b) => a.tid - b.tid);

    if (runnable.length === 0) {
      this.currentTid = null;
      return;
    }

    const fromTid = this.currentTid ?? runnable[0].tid;
    const currentIndex = Math.max(
      0,
      runnable.findIndex((t) => t.tid === fromTid),
    );

    let pickedIndex = (currentIndex + 1) % runnable.length;

    if (this.policy.closure && this.policy.moduleName) {
      try {
        pickedIndex = this.callPolicyPickIndex(
          runnable.map((t) => t.tid),
          fromTid,
          currentIndex,
        );
      } catch (e) {
        this.handlePolicyError(e);
        pickedIndex = (currentIndex + 1) % runnable.length;
      }
    }

    const toTid = runnable[pickedIndex]?.tid ?? runnable[0].tid;
    this.currentTid = toTid;

    if (fromTid !== toTid) {
      this.emit({
        type: "taskSwitch",
        cycle: this.cycle.toString(),
        tick: this.tick,
        fromTid,
        toTid,
        reason,
      });
    }
  }

  private callPolicyPickIndex(
    runnableTids: number[],
    currentTid: number,
    currentIndex: number,
  ): number {
    const closure = this.policy.closure;
    const moduleName = this.policy.moduleName;
    if (!closure || !moduleName) return 0;
    const mod = this.modules.get(moduleName);
    if (!mod) throw new Error("PolicyModuleNotLoaded");

    const fn = mod.tbc.functions.at(closure.fnIndex);
    if (!fn) throw new Error("PolicyFnNotFound");
    const arity = fn.arity;
    if (arity !== 5) throw new Error(`PolicyArityMismatch:${String(arity)}`);

    const env = new Env(closure.env, fn.locals);
    const args: Value[] = [
      this.tick,
      currentTid,
      currentIndex,
      runnableTids.length,
      0,
    ];
    for (let i = 0; i < args.length; i++) {
      env.slots[i] = args[i];
      env.written[i] = true;
    }
    const fiber = new Fiber();
    fiber.callStack.push({ fnIndex: closure.fnIndex, ip: 0, env });
    const vm = new VM(mod.tbc, fiber, { debug: false });

    const val = this.runVmToHalt(vm, 50_000);
    if (typeof val !== "number" || !Number.isFinite(val))
      throw new Error("PolicyReturnNotNumber");
    const pickedIndex =
      ((Math.floor(val) % runnableTids.length) + runnableTids.length) %
      runnableTids.length;

    this.lastPolicyPick = {
      currentTid,
      pickedIndex,
      runnableTids: [...runnableTids],
    };
    this.emit({
      type: "policyPick",
      cycle: this.cycle.toString(),
      tick: this.tick,
      currentTid,
      pickedIndex,
      runnableTids: [...runnableTids],
    });

    return pickedIndex;
  }

  private handlePolicyError(e: unknown) {
    this.emit({
      type: "error",
      cycle: this.cycle.toString(),
      tick: this.tick,
      code: "PolicyError",
      message: e instanceof Error ? e.message : String(e),
      details: e,
    });
  }

  private getCurrentRunnableTask(): EngineTask | null {
    // If no current, pick smallest runnable.
    if (this.currentTid === null) {
      const next = Array.from(this.tasks.values())
        .filter((t) => t.state === "RUNNABLE")
        .sort((a, b) => a.tid - b.tid)
        .at(0);
      if (!next) return null;
      this.currentTid = next.tid;
      return next;
    }

    const current = this.tasks.get(this.currentTid);
    if (current?.state === "RUNNABLE") return current;

    this.switchTask("sleepWake");
    return this.tasks.get(this.currentTid) ?? null;
  }

  private isContReturnStep(fiber: Fiber): boolean {
    if (!fiber.yielding) return false;
    if (fiber.callStack.length === 0) return false;
    const frame = fiber.callStack[fiber.callStack.length - 1];
    return frame.fnIndex === fiber.yieldFnIndex && frame.ip === fiber.yieldPc;
  }

  private emit(ev: DeosUiEvent) {
    if ((this.eventMask & this.maskForEvent(ev.type)) === 0) return;
    this.eventFifo.push(JSON.stringify(ev));
  }

  private maskForEvent(type: DeosUiEvent["type"]): number {
    switch (type) {
      case "console":
        return EventMask.Console;
      case "tick":
        return EventMask.Tick;
      case "taskSwitch":
        return EventMask.TaskSwitch;
      case "perform":
        return EventMask.Perform;
      case "contCall":
      case "contReturn":
        return EventMask.Continuation;
      case "inputConsumed":
        return EventMask.InputConsumed;
      case "policyPick":
        return EventMask.PolicyPick;
      case "error":
        return EventMask.Error;
    }
  }

  private handleRuntimeError(task: EngineTask, e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    this.lastError = { code: "EngineError", message, details: e };
    this.emit({
      type: "error",
      cycle: this.execCycle.toString(),
      tick: this.execTick,
      tid: task.tid,
      code: message,
      message,
      details: e,
    });
  }
}
