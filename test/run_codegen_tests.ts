import * as assert from "assert";

import { Opcode } from "../src/bytecode/opcode";
import { Codegen } from "../src/lang/codegen";
import { Lexer } from "../src/lang/lexer";
import { Parser } from "../src/lang/parser";
import { Resolver } from "../src/lang/resolver";

function testCodegen() {
  console.log("Running Codegen tests...");

  // Test 1: Simple constant and arithmetic
  {
    const source = "1 + 2;";
    const tokens = new Lexer(source).tokenize();
    const program = new Parser(tokens).parse();
    const result = new Resolver().resolve(program);
    const codegen = new Codegen(result);
    const tbc = codegen.generate(program);

    // Check if entry function (fnIndex 0) has ADD instruction
    const fn0 = tbc.functions[0];
    const opcodes = [];
    for (let i = 0; i < fn0.code.length; i++) {
      // This is a bit simplified, we just want to see if ADD (0x10) is there.
      // In a real test, we'd disassemble properly.
      opcodes.push(fn0.code[i]);
    }
    assert.ok(opcodes.includes(Opcode.ADD));
    console.log("  ✓ Simple arithmetic codegen");
  }

  console.log("All Codegen tests passed!");
}

try {
  testCodegen();
} catch (e) {
  console.error("Test failed!");
  console.error(e);
  process.exit(1);
}
