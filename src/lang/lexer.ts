import { Token, TokenType } from "./token";

export class Lexer {
  private tokens: Token[] = [];
  private start = 0;
  private current = 0;
  private line = 1;

  private static readonly keywords: { [key: string]: TokenType } = {
    let: TokenType.LET,
    fun: TokenType.FUN,
    if: TokenType.IF,
    else: TokenType.ELSE,
    while: TokenType.WHILE,
    true: TokenType.TRUE,
    false: TokenType.FALSE,
    null: TokenType.NULL,
    handle: TokenType.HANDLE,
    with: TokenType.WITH,
    perform: TokenType.PERFORM,
    return: TokenType.RETURN,
  };

  constructor(private source: string) {}

  tokenize(): Token[] {
    while (!this.isAtEnd()) {
      this.start = this.current;
      this.scanToken();
    }

    this.tokens.push({
      type: TokenType.EOF,
      lexeme: "",
      literal: null,
      line: this.line,
    });
    return this.tokens;
  }

  private scanToken(): void {
    const c = this.advance();
    switch (c) {
      case "(":
        this.addToken(TokenType.LEFT_PAREN);
        break;
      case ")":
        this.addToken(TokenType.RIGHT_PAREN);
        break;
      case "{":
        this.addToken(TokenType.LEFT_BRACE);
        break;
      case "}":
        this.addToken(TokenType.RIGHT_BRACE);
        break;
      case ",":
        this.addToken(TokenType.COMMA);
        break;
      case ";":
        this.addToken(TokenType.SEMICOLON);
        break;
      case "+":
        this.addToken(TokenType.PLUS);
        break;
      case "-":
        this.addToken(TokenType.MINUS);
        break;
      case "*":
        this.addToken(TokenType.STAR);
        break;
      case "/":
        this.addToken(TokenType.SLASH);
        break;
      case "=":
        if (this.match(">")) {
          this.addToken(TokenType.ARROW);
        } else if (this.match("=")) {
          this.addToken(TokenType.EQUAL_EQUAL);
        } else {
          this.addToken(TokenType.EQUAL);
        }
        break;
      case "<":
        this.addToken(TokenType.LESS);
        break;
      case ">":
        this.addToken(TokenType.GREATER);
        break;

      case " ":
      case "\r":
      case "\t":
        // Ignore whitespace.
        break;

      case "\n":
        this.line++;
        break;

      case '"':
        this.string();
        break;

      default:
        if (this.isDigit(c)) {
          this.number();
        } else if (this.isAlpha(c)) {
          this.identifier();
        } else {
          // Keep it simple, just skip or throw
          console.error(
            `Error: Unexpected character ${c} at line ${this.line}`,
          );
        }
        break;
    }
  }

  private identifier(): void {
    while (this.isAlphaNumeric(this.peek())) {
      this.advance();
    }

    const text = this.source.substring(this.start, this.current);
    let type = Lexer.keywords[text];
    if (type === undefined) {
      type = TokenType.IDENTIFIER;
    }
    this.addToken(type);
  }

  private number(): void {
    while (this.isDigit(this.peek())) {
      this.advance();
    }

    // Look for a fractional part.
    if (this.peek() === "." && this.isDigit(this.peekNext())) {
      // Consume the "."
      this.advance();

      while (this.isDigit(this.peek())) {
        this.advance();
      }
    }

    const value = parseFloat(this.source.substring(this.start, this.current));
    this.addToken(TokenType.NUMBER, value);
  }

  private string(): void {
    let value = "";
    while (this.peek() !== '"' && !this.isAtEnd()) {
      if (this.peek() === "\n") {
        this.line++;
      }

      if (this.peek() === "\\") {
        this.advance(); // consume \
        const next = this.advance();
        switch (next) {
          case "n":
            value += "\n";
            break;
          case "t":
            value += "\t";
            break;
          case "\\":
            value += "\\";
            break;
          case '"':
            value += '"';
            break;
          default:
            value += "\\" + next;
            break;
        }
      } else {
        value += this.advance();
      }
    }

    if (this.isAtEnd()) {
      console.error(`Error: Unterminated string at line ${this.line}`);
      return;
    }

    // The closing ".
    this.advance();

    this.addToken(TokenType.STRING, value);
  }

  private match(expected: string): boolean {
    if (this.isAtEnd()) return false;
    if (this.source.charAt(this.current) !== expected) return false;

    this.current++;
    return true;
  }

  private peek(): string {
    if (this.isAtEnd()) return "\0";
    return this.source.charAt(this.current);
  }

  private peekNext(): string {
    if (this.current + 1 >= this.source.length) return "\0";
    return this.source.charAt(this.current + 1);
  }

  private isAlpha(c: string): boolean {
    return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
  }

  private isAlphaNumeric(c: string): boolean {
    return this.isAlpha(c) || this.isDigit(c);
  }

  private isDigit(c: string): boolean {
    return c >= "0" && c <= "9";
  }

  private isAtEnd(): boolean {
    return this.current >= this.source.length;
  }

  private advance(): string {
    return this.source.charAt(this.current++);
  }

  private addToken(
    type: TokenType,
    literal: number | boolean | string | null = null,
  ): void {
    const text = this.source.substring(this.start, this.current);
    this.tokens.push({ type, lexeme: text, literal, line: this.line });
  }
}
