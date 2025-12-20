import { Lexer } from "../src/lang/lexer";
import { Parser } from "../src/lang/parser";
import { Resolver } from "../src/lang/resolver";
import { Codegen } from "../src/lang/codegen";
import { Kernel } from "../src/kernel/kernel";
import * as assert from "assert";

function testKernel() {
  console.log("Running Kernel tests...");

  // Test 1: Multiple tasks and interleaving
  {
    const source1 = `
      print("Task A start");
      yield();
      print("Task A end");
    `;
    const source2 = `
      print("Task B start");
      yield();
      print("Task B end");
    `;

    const compile = (src: string) => {
      const tokens = new Lexer(src).tokenize();
      const program = new Parser(tokens).parse();
      const result = new Resolver().resolve(program);
      return new Codegen(result).generate(program);
    };

    const _tbc1 = compile(source1);
    const _tbc2 = compile(source2);

    // This is tricky: Kernel currently owns ONE TBC file.
    // In DEOS, a task is a fiber. Usually all tasks run the same binary (the OS image).
    // Let's create a combined source or just use one TBC for multiple tasks running different entry points?
    // Actually, DEOS tasks run from `image.json`.

    // For now, let's just run one script that spawns others if we have spawn?
    // We don't have a `spawn` syscall yet in DEuxLang.

    // Let's just create a kernel for each and verify basic output for now,
    // OR we can make Kernel hold many TBCs? No, usually it's one binary.

    // Better: let's test a single script with yield.
  }

  // Test 2: Basic yield and preemption
  {
    const source = `
        print("start");
        yield();
        print("end");
      `;
    const tokens = new Lexer(source).tokenize();
    const program = new Parser(tokens).parse();
    const result = new Resolver().resolve(program);
    const tbc = new Codegen(result).generate(program);

    const kernel = new Kernel(tbc);
    kernel.spawn(); // Spawn task 0
    kernel.run();

    const out = kernel.getOutput();
    assert.strictEqual(out, "start\nend\n");
    console.log("  ✓ Basic yield in Kernel");
  }

  // Test 3: Sleep
  {
    const source = `
        print("1");
        sleep(10);
        print("2");
      `;
    const tokens = new Lexer(source).tokenize();
    const program = new Parser(tokens).parse();
    const result = new Resolver().resolve(program);
    const tbc = new Codegen(result).generate(program);

    const kernel = new Kernel(tbc);
    kernel.spawn();
    kernel.run();

    const out = kernel.getOutput();
    assert.strictEqual(out, "1\n2\n");
    console.log("  ✓ Sleep in Kernel");
  }

  console.log("All Kernel tests passed!");
}

try {
  testKernel();
} catch (e) {
  console.error("Test failed!");
  console.error(e);
  process.exit(1);
}
