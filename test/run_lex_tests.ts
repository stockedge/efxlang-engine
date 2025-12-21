import * as assert from "assert";

import { Lexer } from "../src/lang/lexer";
import { TokenType } from "../src/lang/token";

function testLexer() {
  console.log("Running Lexer tests...");

  // Test 1: Operators
  {
    const source = "( ) { } , ; + - * / = == < > =>";
    const tokens = new Lexer(source).tokenize();
    const types = tokens.map((t) => t.type);
    const expected = [
      TokenType.LEFT_PAREN,
      TokenType.RIGHT_PAREN,
      TokenType.LEFT_BRACE,
      TokenType.RIGHT_BRACE,
      TokenType.COMMA,
      TokenType.SEMICOLON,
      TokenType.PLUS,
      TokenType.MINUS,
      TokenType.STAR,
      TokenType.SLASH,
      TokenType.EQUAL,
      TokenType.EQUAL_EQUAL,
      TokenType.LESS,
      TokenType.GREATER,
      TokenType.ARROW,
      TokenType.EOF,
    ];
    assert.deepStrictEqual(types, expected);
    console.log("  ✓ Basic operators and delimiters");
  }

  // Test 2: Literals
  {
    const source = '123 3.14 "hello" "world\\n" true false null';
    const tokens = new Lexer(source).tokenize();
    assert.strictEqual(tokens[0].type, TokenType.NUMBER);
    assert.strictEqual(tokens[0].literal, 123);
    assert.strictEqual(tokens[1].type, TokenType.NUMBER);
    assert.strictEqual(tokens[1].literal, 3.14);
    assert.strictEqual(tokens[2].type, TokenType.STRING);
    assert.strictEqual(tokens[2].literal, "hello");
    assert.strictEqual(tokens[3].type, TokenType.STRING);
    assert.strictEqual(tokens[3].literal, "world\n");
    assert.strictEqual(tokens[4].type, TokenType.TRUE);
    assert.strictEqual(tokens[5].type, TokenType.FALSE);
    assert.strictEqual(tokens[6].type, TokenType.NULL);
    console.log("  ✓ Literals");
  }

  // Test 3: Keywords
  {
    const source =
      "let myVar = fun() => handle perform return with if else while";
    const tokens = new Lexer(source).tokenize();
    const expected = [
      TokenType.LET,
      TokenType.IDENTIFIER,
      TokenType.EQUAL,
      TokenType.FUN,
      TokenType.LEFT_PAREN,
      TokenType.RIGHT_PAREN,
      TokenType.ARROW,
      TokenType.HANDLE,
      TokenType.PERFORM,
      TokenType.RETURN,
      TokenType.WITH,
      TokenType.IF,
      TokenType.ELSE,
      TokenType.WHILE,
      TokenType.EOF,
    ];
    assert.deepStrictEqual(
      tokens.map((t) => t.type),
      expected,
    );
    console.log("  ✓ Keywords and identifiers");
  }

  console.log("All Lexer tests passed!");
}

try {
  testLexer();
} catch (e) {
  console.error("Test failed!");
  console.error(e);
  process.exit(1);
}
