import { Value, FiberSnapshot } from "../vm/value";
import { Env } from "../vm/env";
import { Fiber, Frame, HandlerFrame } from "../vm/fiber";
import { Task, TaskState } from "../kernel/task";
import { fnv1a } from "./hashing";

interface SerializedEnv {
  tag: "Env";
  slots: unknown[];
  written: boolean[];
  parent: number | null;
}

interface SerializedClosureHeapEntry {
  id: number;
  fnIndex: number;
  env: number;
}

interface SerializedContHeapEntry {
  id: number;
  snap: SerializedFiberSnapshot;
}

interface SerializedFiber {
  valueStack: unknown[];
  callStack: unknown[];
  handlerStack: unknown[];
  yielding: boolean;
  yieldFnIndex: number;
  yieldPc: number;
  parent: SerializedFiber | null;
}

interface SerializedFiberSnapshot {
  valueStack: unknown[];
  callStack: unknown[];
  handlerStack: unknown[];
  yieldFnIndex: number;
  yieldPc: number;
}

interface SerializedTask {
  id: number;
  state: string;
  priority: number;
  waitCycle: string;
  fiber: SerializedFiber;
}

export class StateSerializer {
  private idMap = new Map<object, number>();
  private nextId = 1;
  private objects: unknown[] = [];

  constructor() {}

  serializeTasks(tasks: Task[]): { tasks: SerializedTask[]; heap: unknown[] } {
    this.idMap.clear();
    this.nextId = 1;
    this.objects = [];

    const root = tasks.map((t) => this.serializeTask(t));

    return {
      tasks: root,
      heap: this.objects,
    };
  }

  private serializeTask(t: Task): SerializedTask {
    return {
      id: t.id,
      state: t.state,
      priority: t.priority,
      waitCycle: t.waitCycle.toString(),
      fiber: this.serializeFiber(t.fiber),
    };
  }

  private serializeFiber(f: Fiber): SerializedFiber {
    return {
      valueStack: f.valueStack.map((v) => this.serializeValue(v)),
      callStack: f.callStack.map((fr) => this.serializeFrame(fr)),
      handlerStack: f.handlerStack.map((h) => this.serializeHandlerFrame(h)),
      yielding: f.yielding,
      yieldFnIndex: f.yieldFnIndex,
      yieldPc: f.yieldPc,
      parent: f.parent ? this.serializeFiber(f.parent) : null,
    };
  }

  private serializeFrame(fr: Frame): unknown {
    return {
      fnIndex: fr.fnIndex,
      ip: fr.ip,
      env: this.getObjectId(fr.env, () => this.serializeEnv(fr.env)),
    };
  }

  private serializeHandlerFrame(h: HandlerFrame): unknown {
    return {
      clauses: h.clauses.map((c) => ({
        effectNameConst: c.effectNameConst,
        clause: this.serializeValue(c.clause),
      })),
      onReturn: h.onReturn ? this.serializeValue(h.onReturn) : null,
      baseCallDepth: h.baseCallDepth,
      baseValueHeight: h.baseValueHeight,
      doneFnIndex: h.doneFnIndex,
      donePc: h.donePc,
    };
  }

  private serializeValue(v: Value): unknown {
    if (
      v === null ||
      typeof v === "number" ||
      typeof v === "boolean" ||
      typeof v === "string"
    ) {
      return v;
    }
    if (v.tag === "Closure") {
      return {
        tag: "Closure",
        ref: this.getObjectId(v, () => ({
          fnIndex: v.fnIndex,
          env: this.getObjectId(v.env, () => this.serializeEnv(v.env)),
        })),
      };
    }
    if (v.tag === "Cont") {
      return {
        tag: "Cont",
        used: v.used,
        ref: this.getObjectId(v, () => ({
          snap: this.serializeSnapshot(v.snap),
        })),
      };
    }
    return null;
  }

  private serializeEnv(env: Env): SerializedEnv {
    return {
      tag: "Env",
      slots: env.slots.map((v) => this.serializeValue(v)),
      written: env.written,
      parent: env.parent
        ? this.getObjectId(env.parent, () => this.serializeEnv(env.parent!))
        : null,
    };
  }

  private serializeSnapshot(snap: FiberSnapshot): unknown {
    return {
      valueStack: snap.valueStack.map((v) => this.serializeValue(v)),
      callStack: snap.callStack.map((fr) => this.serializeFrame(fr)),
      handlerStack: snap.handlerStack.map((h) => this.serializeHandlerFrame(h)),
      yieldFnIndex: snap.yieldFnIndex,
      yieldPc: snap.yieldPc,
    };
  }

  private getObjectId(obj: object, create: () => unknown): number {
    if (this.idMap.has(obj)) return this.idMap.get(obj)!;
    const id = this.nextId++;
    this.idMap.set(obj, id);
    const entry = { id, ...(create() as object) };
    this.objects.push(entry);
    return id;
  }

  public static hashState(serialized: unknown): string {
    // Deterministic JSON stringify
    const json = JSON.stringify(serialized, (_key, value) => {
      // if (value instanceof Map) return Array.from(value.entries()); // shouldn't happen here
      return value;
    });
    return fnv1a(json);
  }
}

type SerializedValue =
  | null
  | number
  | boolean
  | string
  | { tag: "Closure"; ref: number }
  | { tag: "Cont"; used: boolean; ref: number };

type HeapEntry =
  | SerializedEnv
  | SerializedClosureHeapEntry
  | SerializedContHeapEntry;

export class StateDeserializer {
  deserializeTasks(serialized: {
    tasks: SerializedTask[];
    heap: unknown[];
  }): Task[] {
    const heap = this.normalizeHeap(serialized.heap);
    const objById = new Map<number, object>();

    for (const entry of heap) {
      if (this.isSerializedEnv(entry)) {
        objById.set(entry.id, new Env(undefined, 0));
        continue;
      }
      if (this.isSerializedContHeapEntry(entry)) {
        objById.set(entry.id, { tag: "Cont", used: false, snap: null } as any);
        continue;
      }
      if (this.isSerializedClosureHeapEntry(entry)) {
        objById.set(entry.id, { tag: "Closure", fnIndex: 0, env: null } as any);
        continue;
      }
      throw new Error(`Unknown heap entry: ${JSON.stringify(entry)}`);
    }

    const decodeValue = (v: unknown): Value => {
      if (
        v === null ||
        typeof v === "number" ||
        typeof v === "boolean" ||
        typeof v === "string"
      ) {
        return v;
      }
      if (typeof v !== "object" || v === null) return null;

      const tag = (v as { tag?: unknown }).tag;
      if (tag === "Closure") {
        const ref = (v as { ref?: unknown }).ref;
        if (typeof ref !== "number") throw new Error("Bad Closure ref");
        return objById.get(ref) as Value;
      }
      if (tag === "Cont") {
        const ref = (v as { ref?: unknown }).ref;
        const used = (v as { used?: unknown }).used;
        if (typeof ref !== "number") throw new Error("Bad Cont ref");
        if (typeof used !== "boolean") throw new Error("Bad Cont used");
        const cont = objById.get(ref) as any;
        cont.used = used;
        return cont as Value;
      }
      return null;
    };

    const decodeFrame = (fr: unknown): Frame => {
      if (typeof fr !== "object" || fr === null) throw new Error("Bad frame");
      const fnIndex = (fr as { fnIndex?: unknown }).fnIndex;
      const ip = (fr as { ip?: unknown }).ip;
      const envRef = (fr as { env?: unknown }).env;
      if (typeof fnIndex !== "number") throw new Error("Bad frame.fnIndex");
      if (typeof ip !== "number") throw new Error("Bad frame.ip");
      if (typeof envRef !== "number") throw new Error("Bad frame.env");
      const env = objById.get(envRef);
      if (!(env instanceof Env)) throw new Error("Bad env ref");
      return { fnIndex, ip, env };
    };

    const decodeHandlerFrame = (h: unknown): HandlerFrame => {
      if (typeof h !== "object" || h === null)
        throw new Error("Bad handler frame");
      const baseCallDepth = (h as { baseCallDepth?: unknown }).baseCallDepth;
      const baseValueHeight = (h as { baseValueHeight?: unknown })
        .baseValueHeight;
      const doneFnIndex = (h as { doneFnIndex?: unknown }).doneFnIndex;
      const donePc = (h as { donePc?: unknown }).donePc;
      const clauses = (h as { clauses?: unknown }).clauses;
      const onReturn = (h as { onReturn?: unknown }).onReturn;

      if (typeof baseCallDepth !== "number")
        throw new Error("Bad handler.baseCallDepth");
      if (typeof baseValueHeight !== "number")
        throw new Error("Bad handler.baseValueHeight");
      if (typeof doneFnIndex !== "number")
        throw new Error("Bad handler.doneFnIndex");
      if (typeof donePc !== "number") throw new Error("Bad handler.donePc");
      if (!Array.isArray(clauses)) throw new Error("Bad handler.clauses");

      return {
        clauses: clauses.map((c) => {
          if (typeof c !== "object" || c === null)
            throw new Error("Bad clause");
          const effectNameConst = (c as { effectNameConst?: unknown })
            .effectNameConst;
          const clauseVal = (c as { clause?: unknown }).clause;
          if (typeof effectNameConst !== "number")
            throw new Error("Bad clause.effectNameConst");
          const decoded = decodeValue(clauseVal);
          if (
            !decoded ||
            typeof decoded !== "object" ||
            (decoded as any).tag !== "Closure"
          ) {
            throw new Error("Bad clause.clause");
          }
          return { effectNameConst, clause: decoded as any };
        }),
        onReturn: onReturn ? (decodeValue(onReturn) as any) : null,
        baseCallDepth,
        baseValueHeight,
        doneFnIndex,
        donePc,
      };
    };

    const decodeFiberSnapshot = (s: SerializedFiberSnapshot): FiberSnapshot => {
      return {
        valueStack: s.valueStack.map((v) => decodeValue(v)),
        callStack: s.callStack.map((fr) => decodeFrame(fr)),
        handlerStack: s.handlerStack.map((h) => decodeHandlerFrame(h)),
        yieldFnIndex: s.yieldFnIndex,
        yieldPc: s.yieldPc,
      };
    };

    for (const entry of heap) {
      if (this.isSerializedEnv(entry)) {
        const env = objById.get(entry.id) as Env;
        env.slots = entry.slots.map((v) => decodeValue(v));
        env.written = [...entry.written];
        env.parent =
          entry.parent === null
            ? undefined
            : (objById.get(entry.parent) as Env);
        continue;
      }
      if (this.isSerializedClosureHeapEntry(entry)) {
        const cl = objById.get(entry.id) as any;
        cl.fnIndex = entry.fnIndex;
        cl.env = objById.get(entry.env) as Env;
        continue;
      }
      if (this.isSerializedContHeapEntry(entry)) {
        const cont = objById.get(entry.id) as any;
        cont.snap = decodeFiberSnapshot(entry.snap);
        continue;
      }
    }

    return serialized.tasks.map((t) => {
      const decodeFiber = (sf: SerializedFiber): Fiber => {
        const fiber = new Fiber();
        fiber.valueStack = sf.valueStack.map((v) => decodeValue(v));
        fiber.callStack = sf.callStack.map((fr) => decodeFrame(fr));
        fiber.handlerStack = sf.handlerStack.map((h) => decodeHandlerFrame(h));
        fiber.yielding = sf.yielding;
        fiber.yieldFnIndex = sf.yieldFnIndex;
        fiber.yieldPc = sf.yieldPc;
        fiber.parent = sf.parent ? decodeFiber(sf.parent) : undefined;
        return fiber;
      };
      const fiber = decodeFiber(t.fiber);

      return {
        id: t.id,
        state: t.state as TaskState,
        priority: t.priority,
        waitCycle: BigInt(t.waitCycle),
        fiber,
      };
    });
  }

  private normalizeHeap(heap: unknown[]): HeapEntry[] {
    if (!Array.isArray(heap)) throw new Error("Bad heap");
    return heap as HeapEntry[];
  }

  private isSerializedEnv(v: unknown): v is SerializedEnv & { id: number } {
    return (
      typeof v === "object" &&
      v !== null &&
      (v as { tag?: unknown }).tag === "Env" &&
      typeof (v as { id?: unknown }).id === "number"
    );
  }

  private isSerializedClosureHeapEntry(
    v: unknown,
  ): v is SerializedClosureHeapEntry {
    return (
      typeof v === "object" &&
      v !== null &&
      typeof (v as { id?: unknown }).id === "number" &&
      typeof (v as { fnIndex?: unknown }).fnIndex === "number" &&
      typeof (v as { env?: unknown }).env === "number" &&
      (v as { tag?: unknown }).tag === undefined &&
      (v as { snap?: unknown }).snap === undefined
    );
  }

  private isSerializedContHeapEntry(v: unknown): v is SerializedContHeapEntry {
    return (
      typeof v === "object" &&
      v !== null &&
      typeof (v as { id?: unknown }).id === "number" &&
      typeof (v as { snap?: unknown }).snap === "object" &&
      (v as { tag?: unknown }).tag === undefined
    );
  }
}
