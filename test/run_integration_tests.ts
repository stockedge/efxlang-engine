import * as assert from "assert";

import { Codegen } from "../src/lang/codegen";
import { Lexer } from "../src/lang/lexer";
import { Parser } from "../src/lang/parser";
import { Resolver } from "../src/lang/resolver";
import { VMStatus } from "../src/vm/status";
import { VM } from "../src/vm/vm";

function testIntegration() {
  console.log("Running Integration tests...");

  const compile = (src: string) => {
    const tokens = new Lexer(src).tokenize();
    const program = new Parser(tokens).parse();
    const result = new Resolver().resolve(program);
    return new Codegen(result).generate(program);
  };

  const runUntilHalt = (vm: VM) => {
    for (;;) {
      const res = vm.run();
      if (res.status === VMStatus.HALTED) {
        return res.value;
      }
      if (res.status === VMStatus.SAFEPOINT) {
        continue;
      }
      throw new Error(`Unexpected VM status: ${String(res.status)}`);
    }
  };

  // Test 1: Recursion (Fibonacci)
  {
    const source = `
            let fib = fun(n) => {
                if (n < 2) { n } else { fib(n - 1) + fib(n - 2) }
            };
            fib(10);
        `;
    const tbc = compile(source);
    const vm = new VM(tbc);
    const res = runUntilHalt(vm);
    assert.strictEqual(res, 55);
    console.log("  ✓ Recursion (Fibonacci)");
  }

  // Test 2: State Effect (Get/Set)
  {
    // State Monad implementation using effect handlers
    const source = `
            handle {
                let x = perform Get();
                perform Set(x + 10);
                x + perform Get();
            } with {
                Get(k) => fun(s) => k(s)(s);
                Set(v, k) => fun(s) => k(null)(v);
                return(x) => fun(s) => x;
            } (5);
        `;
    const tbc = compile(source);
    const vm = new VM(tbc);
    console.log("--- TRACE TEST 2 START ---");
    const res = runUntilHalt(vm);
    console.log("--- TRACE TEST 2 END ---");
    assert.strictEqual(res, 20);
    console.log("  ✓ State Handlers (State Passing Style)");
  }

  // Test 3: Generator (Yield as Effect)
  {
    const source = `
            handle {
                perform Yield(1);
                perform Yield(2);
                perform Yield(3);
                0 // done
            } with {
                Yield(v, k) => {
                   v + k(null)
                };
                return(x) => x;
            };
        `;
    const tbc = compile(source);
    const vm = new VM(tbc);
    const res = runUntilHalt(vm);
    assert.strictEqual(res, 6);
    console.log("  ✓ Generator/Iterator Pattern");
  }

  console.log("All Integration tests passed!");
}

try {
  testIntegration();
} catch (e) {
  console.error("Test failed!");
  console.error(e);
  process.exit(1);
}
