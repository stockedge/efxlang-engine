import {
  type BlockExpr,
  type CallExpr,
  type Expr,
  type ExprStmt,
  type FunExpr,
  type HandleExpr,
  type IfExpr,
  type LetStmt,
  type OpClause,
  type PerformExpr,
  type Program,
  type ReturnClause,
  type Stmt,
  type WhileExpr,
} from "./ast";
import { type Token, TokenType } from "./token";

export class Parser {
  private current = 0;

  constructor(private tokens: Token[]) {}

  parse(): Program {
    const statements: Stmt[] = [];
    while (!this.isAtEnd()) {
      statements.push(this.statement());
    }
    return { statements };
  }

  private statement(): Stmt {
    if (this.match(TokenType.LET)) return this.letStatement();
    return this.expressionStatement();
  }

  private letStatement(): LetStmt {
    const name = this.consume(TokenType.IDENTIFIER, "Expect variable name.");
    this.consume(TokenType.EQUAL, "Expect '=' after variable name.");
    const initializer = this.expression();
    this.consume(TokenType.SEMICOLON, "Expect ';' after variable declaration.");
    return { kind: "LetStmt", name, initializer };
  }

  private expressionStatement(): ExprStmt {
    const expr = this.expression();
    this.consume(TokenType.SEMICOLON, "Expect ';' after expression.");
    return { kind: "ExprStmt", expr };
  }

  private expression(): Expr {
    return this.comparison();
  }

  private comparison(): Expr {
    let expr = this.term();

    while (
      this.match(TokenType.EQUAL_EQUAL, TokenType.LESS, TokenType.GREATER)
    ) {
      const operator = this.previous();
      const right = this.term();
      expr = { kind: "BinaryExpr", left: expr, operator, right };
    }

    return expr;
  }

  private term(): Expr {
    let expr = this.factor();

    while (this.match(TokenType.PLUS, TokenType.MINUS)) {
      const operator = this.previous();
      const right = this.factor();
      expr = { kind: "BinaryExpr", left: expr, operator, right };
    }

    return expr;
  }

  private factor(): Expr {
    let expr = this.unary(); // The spec doesn't list unary, but good to have if needed.
    // Actually, factor is the next level. Let's call it 'call' directly if no unary.

    while (this.match(TokenType.STAR, TokenType.SLASH)) {
      const operator = this.previous();
      const right = this.unary();
      expr = { kind: "BinaryExpr", left: expr, operator, right };
    }

    return expr;
  }

  private unary(): Expr {
    // Spec doesn't mention unary - or !.
    // It says call is most prioritized.
    return this.call();
  }

  private call(): Expr {
    let expr = this.primary();

    for (;;) {
      if (this.match(TokenType.LEFT_PAREN)) {
        expr = this.finishCall(expr);
      } else {
        break;
      }
    }

    return expr;
  }

  private finishCall(callee: Expr): CallExpr {
    const args: Expr[] = [];
    if (!this.check(TokenType.RIGHT_PAREN)) {
      do {
        args.push(this.expression());
      } while (this.match(TokenType.COMMA));
    }
    this.consume(TokenType.RIGHT_PAREN, "Expect ')' after arguments.");
    return { kind: "CallExpr", callee, args };
  }

  private primary(): Expr {
    if (this.match(TokenType.FALSE))
      return { kind: "LiteralExpr", value: false };
    if (this.match(TokenType.TRUE)) return { kind: "LiteralExpr", value: true };
    if (this.match(TokenType.NULL)) return { kind: "LiteralExpr", value: null };

    if (this.match(TokenType.NUMBER, TokenType.STRING)) {
      return { kind: "LiteralExpr", value: this.previous().literal };
    }

    if (this.match(TokenType.IDENTIFIER)) {
      return { kind: "VarExpr", name: this.previous() };
    }

    if (this.match(TokenType.LEFT_PAREN)) {
      const expr = this.expression();
      this.consume(TokenType.RIGHT_PAREN, "Expect ')' after expression.");
      return expr;
    }

    if (this.match(TokenType.LEFT_BRACE)) return this.block();

    if (this.match(TokenType.FUN)) return this.funExpr();
    if (this.match(TokenType.IF)) return this.ifExpr();
    if (this.match(TokenType.WHILE)) return this.whileExpr();
    if (this.match(TokenType.PERFORM)) return this.performExpr();
    if (this.match(TokenType.HANDLE)) return this.handleExpr();

    throw new Error(
      `Expect expression at line ${String(this.peek().line)}, found ${this.peek().type} ('${this.peek().lexeme}')`,
    );
  }

  private block(): BlockExpr {
    const statements: Stmt[] = [];
    let tailExpr: Expr | undefined = undefined;

    while (!this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()) {
      // Check if it's an expression without semicolon (tail expression)
      // This is slightly tricky. If it's the last thing in the block and doesn't have a semicolon.

      // Lookahead to see if we have a semicolon
      if (this.check(TokenType.LET)) {
        statements.push(this.statement());
      } else {
        // It could be an ExprStmt or a tailExpr.
        const expr = this.expression();
        if (this.match(TokenType.SEMICOLON)) {
          statements.push({ kind: "ExprStmt", expr });
        } else {
          // Must be tailExpr or error if not followed by }
          if (this.check(TokenType.RIGHT_BRACE)) {
            tailExpr = expr;
          } else {
            // Try to consume semicolon to give a better error
            this.consume(TokenType.SEMICOLON, "Expect ';' after expression.");
          }
        }
      }
    }

    this.consume(TokenType.RIGHT_BRACE, "Expect '}' after block.");
    return { kind: "BlockExpr", statements, tailExpr };
  }

  private funExpr(): FunExpr {
    this.consume(TokenType.LEFT_PAREN, "Expect '(' after 'fun'.");
    const params: Token[] = [];
    if (!this.check(TokenType.RIGHT_PAREN)) {
      do {
        params.push(
          this.consume(TokenType.IDENTIFIER, "Expect parameter name."),
        );
      } while (this.match(TokenType.COMMA));
    }
    this.consume(TokenType.RIGHT_PAREN, "Expect ')' after parameters.");
    this.consume(TokenType.ARROW, "Expect '=>' after function parameters.");
    const body = this.expression();
    return { kind: "FunExpr", params, body };
  }

  private ifExpr(): IfExpr {
    this.consume(TokenType.LEFT_PAREN, "Expect '(' after 'if'.");
    const condition = this.expression();
    this.consume(TokenType.RIGHT_PAREN, "Expect ')' after if condition.");

    // Spec says 'block' not 'expr' for then/else
    this.consume(TokenType.LEFT_BRACE, "Expect '{' before then block.");
    const thenBranch = this.block();

    this.consume(TokenType.ELSE, "Expect 'else' after if block.");
    this.consume(TokenType.LEFT_BRACE, "Expect '{' before else block.");
    const elseBranch = this.block();

    return { kind: "IfExpr", condition, thenBranch, elseBranch };
  }

  private whileExpr(): WhileExpr {
    this.consume(TokenType.LEFT_PAREN, "Expect '(' after 'while'.");
    const condition = this.expression();
    this.consume(TokenType.RIGHT_PAREN, "Expect ')' after while condition.");

    this.consume(TokenType.LEFT_BRACE, "Expect '{' before while body.");
    const body = this.block();

    return { kind: "WhileExpr", condition, body };
  }

  private performExpr(): PerformExpr {
    const opName = this.consume(TokenType.IDENTIFIER, "Expect effect name.");
    this.consume(TokenType.LEFT_PAREN, "Expect '(' after effect name.");
    const args: Expr[] = [];
    if (!this.check(TokenType.RIGHT_PAREN)) {
      do {
        args.push(this.expression());
      } while (this.match(TokenType.COMMA));
    }
    this.consume(TokenType.RIGHT_PAREN, "Expect ')' after arguments.");
    return { kind: "PerformExpr", opName, args };
  }

  private handleExpr(): HandleExpr {
    const body = this.expression();
    this.consume(TokenType.WITH, "Expect 'with' after handle expression body.");
    this.consume(
      TokenType.LEFT_BRACE,
      "Expect '{' to start handler definition.",
    );

    const opClauses: OpClause[] = [];
    let returnClause: ReturnClause | undefined = undefined;

    while (!this.check(TokenType.RIGHT_BRACE) && !this.isAtEnd()) {
      if (this.match(TokenType.RETURN)) {
        this.consume(TokenType.LEFT_PAREN, "Expect '(' after 'return'.");
        const param = this.consume(
          TokenType.IDENTIFIER,
          "Expect return parameter name.",
        );
        this.consume(
          TokenType.RIGHT_PAREN,
          "Expect ')' after return parameter.",
        );
        this.consume(TokenType.ARROW, "Expect '=>' before return clause body.");
        const bodyExpr = this.expression();
        this.consume(TokenType.SEMICOLON, "Expect ';' after return clause.");
        returnClause = { param, body: bodyExpr };
      } else {
        const opName = this.consume(
          TokenType.IDENTIFIER,
          "Expect effect name in clause.",
        );
        this.consume(TokenType.LEFT_PAREN, "Expect '(' after effect name.");
        const params: Token[] = [];
        if (!this.check(TokenType.RIGHT_PAREN)) {
          do {
            params.push(
              this.consume(
                TokenType.IDENTIFIER,
                "Expect parameter or continuation name.",
              ),
            );
          } while (this.match(TokenType.COMMA));
        }
        this.consume(TokenType.RIGHT_PAREN, "Expect ')' after parameters.");

        // Final param is k
        if (params.length === 0) {
          throw new Error(
            "Handler clause must have at least a continuation parameter.",
          );
        }
        const kName = params.pop();
        if (!kName) {
          throw new Error(
            "Handler clause must have at least a continuation parameter.",
          );
        }

        this.consume(TokenType.ARROW, "Expect '=>' before clause body.");
        const bodyExpr = this.expression();
        this.consume(TokenType.SEMICOLON, "Expect ';' after clause.");
        opClauses.push({ opName, params, kName, body: bodyExpr });
      }
    }

    this.consume(TokenType.RIGHT_BRACE, "Expect '}' after handler definition.");
    return { kind: "HandleExpr", body, handler: { returnClause, opClauses } };
  }

  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private consume(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance();
    const found = this.peek().type;
    throw new Error(
      `${message} Found ${found} ('${this.peek().lexeme}') at line ${String(this.peek().line)}`,
    );
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }
}
