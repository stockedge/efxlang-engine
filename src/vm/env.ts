import { Value } from "./value";

export class Env {
  public slots: Value[];
  public written: boolean[];

  constructor(
    public parent?: Env,
    size: number = 0,
  ) {
    this.slots = new Array(size).fill(null);
    this.written = new Array(size).fill(false);
  }

  get(depth: number, slot: number): Value {
    if (depth === 0) return this.slots[slot];
    let env = this.parent;
    for (let i = 1; i < depth; i++) {
      env = env?.parent;
    }
    if (!env) throw new Error("Environment depth out of bounds");
    return env.slots[slot];
  }

  set(depth: number, slot: number, value: Value): void {
    if (depth === 0) {
      if (this.written[slot]) throw new Error("ImmutableBindingReassigned");
      this.slots[slot] = value;
      this.written[slot] = true;
      return;
    }
    let env = this.parent;
    for (let i = 1; i < depth; i++) {
      env = env?.parent;
    }
    if (!env) throw new Error("Environment depth out of bounds");

    if (env.written[slot]) {
      throw new Error("ImmutableBindingReassigned");
    }

    env.slots[slot] = value;
    env.written[slot] = true;
  }
}
