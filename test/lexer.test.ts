import { describe, it, expect } from "vitest";
import { Lexer } from "../src/lang/lexer";
import { TokenType } from "../src/lang/token";

describe("Lexer", () => {
  it("should tokenize basic operators and delimiters", () => {
    const source = "( ) { } , ; + - * / = == < > =>";
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    const expectedTypes = [
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

    expect(tokens.map((t) => t.type)).toEqual(expectedTypes);
  });

  it("should tokenize literals", () => {
    const source = '123 3.14 "hello" "world\\n" true false null';
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    expect(tokens[0].type).toBe(TokenType.NUMBER);
    expect(tokens[0].literal).toBe(123);
    expect(tokens[1].type).toBe(TokenType.NUMBER);
    expect(tokens[1].literal).toBe(3.14);
    expect(tokens[2].type).toBe(TokenType.STRING);
    expect(tokens[2].literal).toBe("hello");
    expect(tokens[3].type).toBe(TokenType.STRING);
    expect(tokens[3].literal).toBe("world\n");
    expect(tokens[4].type).toBe(TokenType.TRUE);
    expect(tokens[5].type).toBe(TokenType.FALSE);
    expect(tokens[6].type).toBe(TokenType.NULL);
  });

  it("should tokenize keywords and identifiers", () => {
    const source =
      "let myVar = fun() => handle perform return with if else while";
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    const expectedTypes = [
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

    expect(tokens.map((t) => t.type)).toEqual(expectedTypes);
  });
});
