import { Lexer } from "../src/lang/lexer";
import { Parser } from "../src/lang/parser";
import { Resolver } from "../src/lang/resolver";
import { Codegen } from "../src/lang/codegen";
import { Kernel } from "../src/kernel/kernel";
import * as assert from "assert";

function testRecordReplay() {
  console.log("Running Record/Replay tests...");

  // Source with some complexity (loop, variables)
  const _source = `
    let x = 0;
    while (x < 3) {
      print(x);
      x = x + 1;
    }
  `;
  // Wait, I don't have assignment `x = x + 1` yet?
  // Spec shows `let x = ...` but not mutation.
  // Let's re-read spec 11.1: "Immutable Bindings - By default, all let bindings are immutable."
  // So I need to use recursion or just a simple sequence for now.

  const sourceSequence = `
    print(1);
    print(2);
    print(3);
  `;

  const tokens = new Lexer(sourceSequence).tokenize();
  const program = new Parser(tokens).parse();
  const result = new Resolver().resolve(program);
  const tbc = new Codegen(result).generate(program);

  // 1. Record
  const kernelRec = new Kernel(tbc);
  kernelRec.setRecordMode("test-hash");
  kernelRec.spawnEntry(0);
  kernelRec.run();

  const trace = kernelRec.getTrace();
  assert.ok(trace);
  assert.ok(trace.events.length > 0);
  console.log(`  ✓ Recorded ${String(trace.events.length)} events`);

  // 2. Replay
  const kernelRep = new Kernel(tbc);
  kernelRep.setReplayMode(trace);
  kernelRep.spawnEntry(0);

  // To test mismatch detection, we can take frequent snapshots
  // Actually, let's just run it.
  try {
    kernelRep.run();
    console.log("  ✓ Replayed successfully without hash mismatches");
  } catch (e) {
    console.error("  ✗ Replay failed!");
    throw e;
  }

  console.log("All Record/Replay tests passed!");
}

try {
  testRecordReplay();
} catch (e) {
  console.error("Test failed!");
  console.error(e);
  process.exit(1);
}
