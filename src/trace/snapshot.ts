import { Value, FiberSnapshot } from "../vm/value";
import { Env } from "../vm/env";
import { Fiber, Frame, HandlerFrame } from "../vm/fiber";
import { Task } from "../kernel/task";
import { fnv1a } from "./hashing";

interface SerializedEnv {
  tag: "Env";
  slots: unknown[];
  written: boolean[];
  parent: number | null;
}

interface SerializedFiber {
  valueStack: unknown[];
  callStack: unknown[];
  handlerStack: unknown[];
  yielding: boolean;
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
