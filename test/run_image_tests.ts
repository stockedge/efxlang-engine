import * as assert from "assert";

import { TBCEncoder } from "../src/bytecode/bin";
import { type ImageFormat, Kernel } from "../src/kernel/kernel";
import { Codegen } from "../src/lang/codegen";
import { Lexer } from "../src/lang/lexer";
import { Parser } from "../src/lang/parser";
import { Resolver } from "../src/lang/resolver";

function testImage() {
  console.log("Running Image loading tests...");

  const source = `print("Hello from Image!");`;
  const compileToB64 = (src: string) => {
    const tokens = new Lexer(src).tokenize();
    const program = new Parser(tokens).parse();
    const result = new Resolver().resolve(program);
    const tbc = new Codegen(result).generate(program);
    const bytes = new TBCEncoder().encode(tbc);
    return Buffer.from(bytes).toString("base64");
  };

  const image: ImageFormat = {
    tbc: compileToB64(source),
    tasks: [{ fn: 0, priority: 100 }],
  };

  const kernel = Kernel.fromImage(image);
  kernel.run();

  assert.strictEqual(kernel.getOutput(), "Hello from Image!\n");
  console.log("  ✓ Kernel loaded and ran from ImageFormat");
  console.log("All Image loading tests passed!");
}

try {
  testImage();
} catch (e) {
  console.error("Test failed!");
  console.error(e);
  process.exit(1);
}
