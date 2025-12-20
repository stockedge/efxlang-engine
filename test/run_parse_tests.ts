import { Lexer } from "../src/lang/lexer";
import { Parser } from "../src/lang/parser";
import * as assert from "assert";

function testParser() {
  console.log("Running Parser tests...");

  // Test 1: Simple let and binary expr
  {
    const source = "let x = 1 + 2;";
    const tokens = new Lexer(source).tokenize();
    const program = new Parser(tokens).parse();

    assert.strictEqual(program.statements.length, 1);
    const stmt = program.statements[0];
    assert.strictEqual(stmt.kind, "LetStmt");
    if (stmt.kind === "LetStmt") {
      assert.strictEqual(stmt.name.lexeme, "x");
      assert.strictEqual(stmt.initializer.kind, "BinaryExpr");
    }
    console.log("  ✓ Simple let and binary expr");
  }

  // Test 2: Function expression
  {
    const source = "let f = fun(a, b) => a + b;";
    const tokens = new Lexer(source).tokenize();
    const program = new Parser(tokens).parse();
    const stmt = program.statements[0];
    if (stmt.kind === "LetStmt") {
      assert.strictEqual(stmt.initializer.kind, "FunExpr");
    }
    console.log("  ✓ Function expression");
  }

  // Test 3: Handle / Perform
  {
    const source = `
      handle {
        perform Log("hello");
      } with {
        Log(msg, k) => {
          print(msg);
          k(null);
        };
        return(x) => x;
      };
    `;
    const tokens = new Lexer(source).tokenize();
    const program = new Parser(tokens).parse();
    const stmt = program.statements[0];
    assert.strictEqual(stmt.kind, "ExprStmt");
    if (stmt.kind === "ExprStmt") {
      assert.strictEqual(stmt.expr.kind, "HandleExpr");
    }
    console.log("  ✓ Handle / Perform expressions");
  }

  console.log("All Parser tests passed!");
}

try {
  testParser();
} catch (e) {
  console.error("Test failed!");
  console.error(e);
  process.exit(1);
}
