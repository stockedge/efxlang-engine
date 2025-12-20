import { Lexer } from "../src/lang/lexer";
import { Parser } from "../src/lang/parser";
import { Resolver } from "../src/lang/resolver";
import { Codegen } from "../src/lang/codegen";
import { TBCEncoder, TBCDecoder } from "../src/bytecode/bin";
import * as assert from "assert";

function testBin() {
  console.log("Running Binary TBC tests...");

  const source = `
    let x = 10;
    handle {
        perform Foo(x);
    } with {
        Foo(v, k) => v + 1;
    };
  `;
  const tokens = new Lexer(source).tokenize();
  const program = new Parser(tokens).parse();
  const result = new Resolver().resolve(program);
  const tbc = new Codegen(result).generate(program);

  const encoder = new TBCEncoder();
  const bytes = encoder.encode(tbc);

  const decoder = new TBCDecoder(bytes);
  const decoded = decoder.decode();

  assert.strictEqual(decoded.consts.length, tbc.consts.length);
  assert.strictEqual(decoded.functions.length, tbc.functions.length);

  for (let i = 0; i < tbc.functions.length; i++) {
    assert.strictEqual(decoded.functions[i].arity, tbc.functions[i].arity);
    assert.strictEqual(decoded.functions[i].locals, tbc.functions[i].locals);
    assert.deepStrictEqual(decoded.functions[i].code, tbc.functions[i].code);
    assert.strictEqual(
      decoded.functions[i].handlers.length,
      tbc.functions[i].handlers.length,
    );
  }

  console.log("  ✓ TBC Encoding/Decoding matches");
  console.log("All Binary TBC tests passed!");
}

try {
  testBin();
} catch (e) {
  console.error("Test failed!");
  console.error(e);
  process.exit(1);
}
