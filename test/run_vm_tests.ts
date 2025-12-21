import { Lexer } from "../src/lang/lexer";
import { Parser } from "../src/lang/parser";
import { Resolver } from "../src/lang/resolver";
import { Codegen } from "../src/lang/codegen";
import { VM } from "../src/vm/vm";
import { VMStatus } from "../src/vm/status";
import * as assert from "assert";

function testVM() {
  console.log("Running VM tests...");

  // Test 1: Simple arithmetic
  {
    const source = "1 + 2 * 3;";
    const tokens = new Lexer(source).tokenize();
    const program = new Parser(tokens).parse();
    const result = new Resolver().resolve(program);
    const tbc = new Codegen(result).generate(program);

    const vm = new VM(tbc);
    const res = runUntilHalt(vm);
    assert.strictEqual(res, 7);
    console.log("  ✓ Simple arithmetic");
  }

  // Test 2: Function call
  {
    const source = "let add = fun(a, b) => a + b; add(10, 20);";
    const tokens = new Lexer(source).tokenize();
    const program = new Parser(tokens).parse();
    const result = new Resolver().resolve(program);
    const tbc = new Codegen(result).generate(program);

    const vm = new VM(tbc);
    const res = runUntilHalt(vm);
    assert.strictEqual(res, 30);
    console.log("  ✓ Function call");
  }

  // Test 3: Effect handler (basic)
  {
    const source = "handle { perform Foo(10) } with { Foo(x, k) => x + 1; };";
    const tokens = new Lexer(source).tokenize();
    const program = new Parser(tokens).parse();
    const result = new Resolver().resolve(program);
    const tbc = new Codegen(result).generate(program);

    const vm = new VM(tbc);
    const res = runUntilHalt(vm);
    assert.strictEqual(res, 11);
    console.log("  ✓ Effect handler (no resume)");
  }

  // Test 4: Effect handler with resume
  {
    const source =
      "handle { 1 + perform Foo(10) } with { Foo(x, k) => k(x * 2); };";
    const tokens = new Lexer(source).tokenize();
    const program = new Parser(tokens).parse();
    const result = new Resolver().resolve(program);
    const tbc = new Codegen(result).generate(program);

    const vm = new VM(tbc);
    const res = runUntilHalt(vm);
    assert.strictEqual(res, 21);
    console.log("  ✓ Effect handler (with resume)");
  }

  console.log("All VM tests passed!");
}

function runUntilHalt(vm: VM) {
  for (;;) {
    const res = vm.run();
    if (res.status === VMStatus.HALTED) return res.value ?? null;
    if (res.status === VMStatus.SAFEPOINT) continue;
    throw new Error(`Unexpected VM status: ${String(res.status)}`);
  }
}

try {
  testVM();
} catch (e) {
  console.error("Test failed!");
  console.error(e);
  process.exit(1);
}
