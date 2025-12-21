import { Lexer } from "../src/lang/lexer";
import { Parser } from "../src/lang/parser";
import { Resolver } from "../src/lang/resolver";
import { type LetStmt, type FunExpr, type VarExpr } from "../src/lang/ast";
import * as assert from "assert";

function testResolver() {
  console.log("Running Resolver tests...");

  // Test 1: Simple local resolution
  {
    const source = "let x = 1; let y = x;";
    const tokens = new Lexer(source).tokenize();
    const program = new Parser(tokens).parse();
    const resolver = new Resolver();
    const result = resolver.resolve(program);

    // x is slot 0, y is slot 1
    // In 'let y = x', x should be (depth: 0, slot: 0)
    // We need a way to inspect the resolution of the VarExpr 'x' in the second statement.
    const yStmt = program.statements[1] as LetStmt;
    const xExpr = yStmt.initializer;
    const res = result.resolutions.get(xExpr);
    assert.deepStrictEqual(res, { depth: 0, slot: 0 });
    console.log("  ✓ Simple local resolution");
  }

  // Test 2: Closure resolution
  {
    const source = "let x = 1; let f = fun() => x;";
    const tokens = new Lexer(source).tokenize();
    const program = new Parser(tokens).parse();
    const resolver = new Resolver();
    const result = resolver.resolve(program);

    // x is at depth 1 in the function body
    const fStmt = program.statements[1] as LetStmt;
    const funExpr = fStmt.initializer as FunExpr;
    const xExpr = funExpr.body as VarExpr;
    const res = result.resolutions.get(xExpr);
    assert.deepStrictEqual(res, { depth: 1, slot: 0 });
    console.log("  ✓ Closure resolution");
  }

  console.log("All Resolver tests passed!");
}

try {
  testResolver();
} catch (e) {
  console.error("Test failed!");
  console.error(e);
  process.exit(1);
}
