export enum TokenType {
  // Single-character tokens
  LEFT_PAREN = "(",
  RIGHT_PAREN = ")",
  LEFT_BRACE = "{",
  RIGHT_BRACE = "}",
  COMMA = ",",
  SEMICOLON = ";",
  PLUS = "+",
  MINUS = "-",
  STAR = "*",
  SLASH = "/",

  // One or two character tokens
  EQUAL = "=",
  EQUAL_EQUAL = "==",
  LESS = "<",
  GREATER = ">",
  ARROW = "=>",

  // Literals
  IDENTIFIER = "IDENTIFIER",
  STRING = "STRING",
  NUMBER = "NUMBER",

  // Keywords
  LET = "let",
  FUN = "fun",
  IF = "if",
  ELSE = "else",
  WHILE = "while",
  TRUE = "true",
  FALSE = "false",
  NULL = "null",
  HANDLE = "handle",
  WITH = "with",
  PERFORM = "perform",
  RETURN = "return",

  // Special
  EOF = "EOF",
}

export interface Token {
  type: TokenType;
  lexeme: string;
  literal: number | boolean | string | null;
  line: number;
}
