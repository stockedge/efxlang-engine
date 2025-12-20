import { TBCFile, TBCFunction } from "../lang/codegen";
import { Opcode } from "../bytecode/opcode";
import { Value, Closure, Continuation, FiberSnapshot } from "./value";
import { Env } from "./env";
import { Fiber, Frame } from "./fiber";
import { VMStatus, VMResult } from "./status";

export class VM {
  private cycle: bigint = 0n;
  public lastPoppedValue: Value = null;

  constructor(
    private tbc: TBCFile,
    public fiber: Fiber = new Fiber(),
  ) {
    if (this.fiber.callStack.length === 0) {
      const entryFn = tbc.functions[0];
      const env = new Env(undefined, entryFn.locals);
      this.fiber.callStack.push({
        fnIndex: 0,
        ip: 0,
        env: env,
      });
    }
  }

  run(): VMResult {
    let totalCycles = 0;
    while (this.fiber.callStack.length > 0) {
      if (this.fiber.yielding && this.isHandleDoneReached()) {
        this.returnToParentFiber();
        continue;
      }

      const res = this.step();
      totalCycles += res.cycles;
      if (res.status !== VMStatus.RUNNING) {
        return { ...res, cycles: totalCycles };
      }
    }
    return {
      status: VMStatus.HALTED,
      value: this.lastPoppedValue,
      cycles: totalCycles,
    };
  }

  public step(): VMResult {
    const frame = this.fiber.callStack[this.fiber.callStack.length - 1];
    const fn = this.tbc.functions[frame.fnIndex];
    if (frame.ip >= fn.code.length) {
      this.fiber.callStack.pop();
      return { status: VMStatus.RUNNING, cycles: 0 };
    }

    const opcode = fn.code[frame.ip++] as Opcode;
    console.log(
      `STEP: Fn${frame.fnIndex} @${frame.ip - 1} Op:0x${opcode.toString(16)} stack:${this.fiber.valueStack.length}`,
    );
    this.cycle++;

    switch (opcode) {
      case Opcode.CONST: {
        const idx = this.readU16(frame, fn);
        this.push(this.tbc.consts[idx]);
        break;
      }
      case Opcode.POP:
        this.lastPoppedValue = this.pop();
        break;
      case Opcode.DUP:
        this.push(this.peek());
        break;
      case Opcode.SWAP: {
        const a = this.pop();
        const b = this.pop();
        this.push(a);
        this.push(b);
        break;
      }
      case Opcode.LOAD: {
        const depth = this.readU16(frame, fn);
        const slot = this.readU16(frame, fn);
        this.push(frame.env.get(depth, slot));
        break;
      }
      case Opcode.STORE: {
        const depth = this.readU16(frame, fn);
        const slot = this.readU16(frame, fn);
        frame.env.set(depth, slot, this.peek());
        break;
      }
      case Opcode.ADD:
        this.binaryOp((a, b) => {
          if (typeof a === "number" && typeof b === "number") return a + b;
          if (typeof a === "string" && typeof b === "string") return a + b;
          throw new Error(
            "TypeError: ADD operands must be both numbers or both strings",
          );
        }, "+");
        break;
      case Opcode.SUB:
        this.binaryOp((a, b) => {
          if (typeof a === "number" && typeof b === "number") return a - b;
          throw new Error("TypeError: SUB operands must be numbers");
        }, "-");
        break;
      case Opcode.MUL:
        this.binaryOp((a, b) => {
          if (typeof a === "number" && typeof b === "number") return a * b;
          throw new Error("TypeError: MUL operands must be numbers");
        }, "*");
        break;
      case Opcode.DIV:
        this.binaryOp((a, b) => {
          if (typeof a === "number" && typeof b === "number") return a / b;
          throw new Error("TypeError: DIV operands must be numbers");
        }, "/");
        break;
      case Opcode.EQ: {
        const b = this.pop();
        const a = this.pop();
        this.push(a === b);
        break;
      }
      case Opcode.LT:
        this.binaryOp((a, b) => {
          if (typeof a === "number" && typeof b === "number") return a < b;
          if (typeof a === "string" && typeof b === "string") return a < b;
          throw new Error(
            "TypeError: LT operands must be both numbers or both strings",
          );
        }, "<");
        break;
      case Opcode.GT:
        this.binaryOp((a, b) => {
          if (typeof a === "number" && typeof b === "number") return a > b;
          if (typeof a === "string" && typeof b === "string") return a > b;
          throw new Error(
            "TypeError: GT operands must be both numbers or both strings",
          );
        }, ">");
        break;

      case Opcode.JMP:
        frame.ip = this.readU32(frame, fn);
        break;
      case Opcode.JMPF: {
        const addr = this.readU32(frame, fn);
        if (!this.isTruthy(this.pop())) frame.ip = addr;
        break;
      }
      case Opcode.CLOSURE: {
        const fnIdx = this.readU16(frame, fn);
        this.push({ tag: "Closure", fnIndex: fnIdx, env: frame.env });
        break;
      }
      case Opcode.CALL: {
        const argc = this.readU16(frame, fn);
        const args = new Array(argc);
        for (let i = argc - 1; i >= 0; i--) args[i] = this.pop();
        this.callValue(this.pop(), args);
        break;
      }
      case Opcode.RET: {
        // If stack is empty (implicit void return), use lastPoppedValue (last expression)
        // instead of popping null and overwriting it.
        let result: Value;
        if (this.fiber.valueStack.length === 0) {
          result = this.lastPoppedValue ?? null;
        } else {
          result = this.pop();
        }

        this.fiber.callStack.pop();
        if (this.fiber.callStack.length > 0) {
          this.push(result);
        } else {
          this.lastPoppedValue = result;
        }
        break;
      }
      case Opcode.HALT:
        this.fiber.callStack = [];
        return {
          status: VMStatus.HALTED,
          value: this.lastPoppedValue,
          cycles: 1,
        };

      case Opcode.PUSH_HANDLER: {
        // ... (rest of cases)
        const hIdx = this.readU16(frame, fn);
        const donePc = this.readU32(frame, fn);
        const handlerDef = fn.handlers[hIdx];
        this.fiber.handlerStack.push({
          clauses: handlerDef.clauses.map((c) => ({
            effectNameConst: c.effectNameConst,
            clause: {
              tag: "Closure",
              fnIndex: c.clauseFnIndex,
              env: frame.env,
            } as Closure,
          })),
          onReturn:
            handlerDef.returnFnIndex === 0xffff
              ? null
              : ({
                  tag: "Closure",
                  fnIndex: handlerDef.returnFnIndex,
                  env: frame.env,
                } as Closure),
          baseCallDepth: this.fiber.callStack.length,
          baseValueHeight: this.fiber.valueStack.length,
          doneFnIndex: frame.fnIndex,
          donePc: donePc,
        });
        break;
      }
      case Opcode.POP_HANDLER:
        this.fiber.handlerStack.pop();
        break;
      case Opcode.PERFORM: {
        const nameIdx = this.readU16(frame, fn);
        const argc = this.readU16(frame, fn);
        const args = new Array(argc);
        for (let i = argc - 1; i >= 0; i--) args[i] = this.pop();
        this.performEffect(nameIdx, args);
        break;
      }
      case Opcode.HANDLE_DONE:
        // Kernel will handle fiber return via isHandleDoneReached
        break;

      case Opcode.SAFEPOINT:
        return { status: VMStatus.SAFEPOINT, cycles: 1 };

      case Opcode.SYS: {
        const sysno = this.readU16(frame, fn);
        return { status: VMStatus.SYSCALL, sysno, cycles: 1 };
      }

      default:
        throw new Error(`Unknown opcode: 0x${(opcode as number).toString(16)}`);
    }

    return { status: VMStatus.RUNNING, cycles: 1 };
  }

  private binaryOp(
    op: (a: number | boolean | string, b: number | boolean | string) => Value,
    _name: string,
  ): void {
    const b = this.pop();
    const a = this.pop();
    if (
      a === null ||
      b === null ||
      typeof a === "object" ||
      typeof b === "object"
    ) {
      throw new Error("RuntimeError: Binary operation on non-primitive");
    }
    this.push(op(a, b));
  }

  private performEffect(effectNameConst: number, args: Value[]): void {
    let handlerIndex = -1;
    let clauseClosure: Closure | null = null;
    for (let i = this.fiber.handlerStack.length - 1; i >= 0; i--) {
      const h = this.fiber.handlerStack[i];
      const c = h.clauses.find((cl) => cl.effectNameConst === effectNameConst);
      if (c) {
        handlerIndex = i;
        clauseClosure = c.clause;
        break;
      }
    }
    if (!clauseClosure)
      throw new Error(`UnhandledEffect: ${this.tbc.consts[effectNameConst]}`);

    const H = this.fiber.handlerStack[handlerIndex];
    const cont: Continuation = {
      tag: "Cont",
      used: false,
      snap: this.deepCopyFiber(this.fiber, H.doneFnIndex, H.donePc),
    };

    this.fiber.callStack = this.fiber.callStack.slice(0, H.baseCallDepth);
    this.fiber.valueStack = this.fiber.valueStack.slice(0, H.baseValueHeight);
    this.fiber.handlerStack = this.fiber.handlerStack.slice(0, handlerIndex);
    this.fiber.callStack[this.fiber.callStack.length - 1].ip = H.donePc;
    this.callValue(clauseClosure, [...args, cont]);
  }

  private callValue(callee: Value, args: Value[]): void {
    if (callee && typeof callee === "object") {
      if (callee.tag === "Closure") {
        const fn = this.tbc.functions[callee.fnIndex];
        if (args.length !== fn.arity)
          throw new Error(`ArityError: ${fn.arity} expected`);
        const env = new Env(callee.env, fn.locals);
        for (let i = 0; i < args.length; i++) {
          env.slots[i] = args[i];
          env.written[i] = true;
        }
        this.fiber.callStack.push({ fnIndex: callee.fnIndex, ip: 0, env });
        return;
      } else if (callee.tag === "Cont") {
        if (callee.used) throw new Error("ContinuationAlreadyUsed");
        callee.used = true;
        const parent = this.fiber;
        this.fiber = this.restoreFiberFromSnapshot(callee.snap);
        this.fiber.parent = parent;
        this.fiber.yielding = true;
        this.push(args[0]);
        return;
      }
    }
    throw new Error("CallNonCallable");
  }

  private returnToParentFiber(): void {
    const res = this.pop();
    const parent = this.fiber.parent;
    if (!parent) throw new Error("No parent fiber");
    this.fiber = parent;
    this.push(res);
  }

  private isHandleDoneReached(): boolean {
    const frame = this.fiber.callStack[this.fiber.callStack.length - 1];
    return (
      frame.fnIndex === this.fiber.yieldFnIndex &&
      frame.ip === this.fiber.yieldPc
    );
  }

  private isTruthy(v: Value): boolean {
    return v !== false && v !== null;
  }
  public push(v: Value) {
    this.fiber.valueStack.push(v);
  }
  public pop(): Value {
    return this.fiber.valueStack.pop()!;
  }
  private peek(): Value {
    return this.fiber.valueStack[this.fiber.valueStack.length - 1];
  }
  private readU16(frame: Frame, fn: TBCFunction): number {
    return fn.code[frame.ip++] | (fn.code[frame.ip++] << 8);
  }
  private readU32(frame: Frame, fn: TBCFunction): number {
    return (
      fn.code[frame.ip++] |
      (fn.code[frame.ip++] << 8) |
      (fn.code[frame.ip++] << 16) |
      (fn.code[frame.ip++] << 24)
    );
  }

  private deepCopyFiber(
    fiber: Fiber,
    yieldFnIndex: number,
    yieldPc: number,
  ): FiberSnapshot {
    return {
      valueStack: [...fiber.valueStack],
      callStack: fiber.callStack.map((f) => ({ ...f })),
      handlerStack: fiber.handlerStack.map((h) => ({
        ...h,
        clauses: h.clauses.map((c) => ({ ...c })),
      })),
      yieldFnIndex,
      yieldPc,
    };
  }

  private restoreFiberFromSnapshot(snap: FiberSnapshot): Fiber {
    const f = new Fiber();
    f.valueStack = [...snap.valueStack];
    f.callStack = snap.callStack.map((fs) => ({ ...fs }));
    f.handlerStack = snap.handlerStack.map((hs) => ({
      ...hs,
      clauses: hs.clauses.map((c) => ({ ...c })),
    }));
    f.yieldFnIndex = snap.yieldFnIndex;
    f.yieldPc = snap.yieldPc;
    return f;
  }
}
