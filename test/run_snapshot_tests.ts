import { StateSerializer } from "../src/trace/snapshot";
import { Env } from "../src/vm/env";
import { Fiber } from "../src/vm/fiber";
import { type Task, TaskState } from "../src/kernel/task";
import * as assert from "assert";

function testSnapshot() {
  console.log("Running Snapshot tests...");

  // Test 1: Simple task serialization
  {
    const f = new Fiber();
    f.valueStack.push(123);
    const env = new Env(undefined, 2);
    env.set(0, 0, "hello");
    f.callStack.push({ fnIndex: 0, ip: 5, env });

    const tasks: Task[] = [
      {
        id: 0,
        fiber: f,
        state: TaskState.READY,
        priority: 100,
        waitCycle: 0n,
      },
    ];

    const ser = new StateSerializer();
    const data = ser.serializeTasks(tasks);

    const hash1 = StateSerializer.hashState(data);
    const hash2 = StateSerializer.hashState(data);
    assert.strictEqual(hash1, hash2, "Hashing must be deterministic");

    // Verify Env is in heap
    assert.ok(
      data.heap.some(
        (obj) =>
          (obj as { tag: string; slots: unknown[] }).tag === "Env" &&
          (obj as { tag: string; slots: unknown[] }).slots[0] === "hello",
      ),
    );
    console.log("  ✓ Basic task serialization and hashing");
  }

  // Test 2: Cyclic references
  {
    const env = new Env(undefined, 1);
    const closure = { tag: "Closure", fnIndex: 0, env } as const;
    env.set(0, 0, closure); // Cycle: Env -> Closure -> Env

    const f = new Fiber();
    f.callStack.push({ fnIndex: 0, ip: 0, env });

    const tasks: Task[] = [
      {
        id: 0,
        fiber: f,
        state: TaskState.READY,
        priority: 100,
        waitCycle: 0n,
      },
    ];

    const ser = new StateSerializer();
    const data = ser.serializeTasks(tasks);

    // Should not throw stack overflow
    // data.heap should contain the Env and the Closure exactly once (by ID)
    const envObj = data.heap.find(
      (o) => (o as { tag: string }).tag === "Env",
    ) as { tag: string; slots: unknown[] };
    const closureRef = envObj.slots[0] as { tag: string; ref: number };
    assert.strictEqual(closureRef.tag, "Closure");
    assert.ok(closureRef.ref >= 0);

    console.log("  ✓ Cyclic reference handling in snapshot");
  }

  console.log("All Snapshot tests passed!");
}

try {
  testSnapshot();
} catch (e) {
  console.error("Test failed!");
  console.error(e);
  process.exit(1);
}
