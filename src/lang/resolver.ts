import {
  Program,
  Stmt,
  Expr,
  LetStmt,
  BlockExpr,
  VarExpr,
  FunExpr,
  ReturnClause,
  OpClause,
} from "./ast";
import { Token } from "./token";

export interface Resolution {
  depth: number;
  slot: number;
}

export interface ResolveResult {
  resolutions: Map<Expr, Resolution>;
  letSlots: Map<LetStmt, number>;
  paramSlots: Map<Token, number>;
  maxSlots: Map<number, number>; // fnIdx -> locals
  fnIdxMap: Map<ResolveNode, number>; // node -> fnIdx
}

type ResolveNode = Program | FunExpr | ReturnClause | OpClause;

type Scope = Map<string, number>;

export class Resolver {
  private scopes: Scope[] = [];
  private resolutions = new Map<Expr, Resolution>();
  private letSlots = new Map<LetStmt, number>();
  private paramSlots = new Map<Token, number>();
  private maxSlots = new Map<number, number>();
  private fnIdxMap = new Map<ResolveNode, number>();

  private currentSlot = 0;
  private fnCount = 0;
  private functionBoundaryIndices: Set<number> = new Set();

  resolve(program: Program): ResolveResult {
    this.beginScope(); // Global/Built-in scope
    this.scopes[0].set("print", -1);
    this.scopes[0].set("yield", -1);
    this.scopes[0].set("sleep", -1);
    this.scopes[0].set("putc", -1);
    this.scopes[0].set("getc", -1);
    this.scopes[0].set("exit", -1);

    this.resolveFunction(program, [], program.statements, true);

    this.endScope();

    return {
      resolutions: this.resolutions,
      letSlots: this.letSlots,
      paramSlots: this.paramSlots,
      maxSlots: this.maxSlots,
      fnIdxMap: this.fnIdxMap,
    };
  }

  private resolveStmt(stmt: Stmt): void {
    switch (stmt.kind) {
      case "LetStmt": {
        const slot = this.define(stmt.name.lexeme);
        this.letSlots.set(stmt, slot);
        this.resolveExpr(stmt.initializer);
        break;
      }
      case "ExprStmt":
        this.resolveExpr(stmt.expr);
        break;
    }
  }

  private resolveExpr(expr: Expr): void {
    switch (expr.kind) {
      case "LiteralExpr":
        break;
      case "VarExpr":
        this.resolveLocal(expr);
        break;
      case "BinaryExpr":
        this.resolveExpr(expr.left);
        this.resolveExpr(expr.right);
        break;
      case "CallExpr":
        this.resolveExpr(expr.callee);
        for (const arg of expr.args) {
          this.resolveExpr(arg);
        }
        break;
      case "FunExpr":
        this.resolveFunction(expr, expr.params, expr.body);
        break;
      case "IfExpr":
        this.resolveExpr(expr.condition);
        this.resolveBlock(expr.thenBranch);
        this.resolveBlock(expr.elseBranch);
        break;
      case "WhileExpr":
        this.resolveExpr(expr.condition);
        this.resolveBlock(expr.body);
        break;
      case "BlockExpr":
        this.resolveBlock(expr);
        break;
      case "PerformExpr":
        for (const arg of expr.args) {
          this.resolveExpr(arg);
        }
        break;
      case "HandleExpr":
        this.resolveExpr(expr.body);
        if (expr.handler.returnClause) {
          this.resolveFunction(
            expr.handler.returnClause,
            [expr.handler.returnClause.param],
            expr.handler.returnClause.body,
          );
        }
        for (const clause of expr.handler.opClauses) {
          this.resolveFunction(
            clause,
            [...clause.params, clause.kName],
            clause.body,
          );
        }
        break;
    }
  }

  private resolveLocal(expr: VarExpr): void {
    let depth = 0;
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(expr.name.lexeme)) {
        this.resolutions.set(expr, {
          depth,
          slot: this.scopes[i].get(expr.name.lexeme)!,
        });
        return;
      }
      if (this.functionBoundaryIndices.has(i)) {
        depth++;
      }
    }
    throw new Error(
      `Undefined variable '${expr.name.lexeme}' at line ${expr.name.line}`,
    );
  }

  private resolveFunction(
    node: ResolveNode,
    params: Token[],
    bodyOrStmts: Expr | Stmt[],
    _isEntry = false,
  ): void {
    const fnIdx = this.fnCount++;
    this.fnIdxMap.set(node, fnIdx);

    this.functionBoundaryIndices.add(this.scopes.length);
    this.beginScope();

    const saveSlot = this.currentSlot;
    this.currentSlot = 0;

    for (const param of params) {
      const slot = this.define(param.lexeme);
      this.paramSlots.set(param, slot);
    }

    if (Array.isArray(bodyOrStmts)) {
      for (const stmt of bodyOrStmts) this.resolveStmt(stmt);
    } else {
      this.resolveExpr(bodyOrStmts);
    }

    this.maxSlots.set(fnIdx, this.currentSlot);
    this.currentSlot = saveSlot;

    this.endScope();
    this.functionBoundaryIndices.delete(this.scopes.length);
  }

  private resolveBlock(block: BlockExpr): void {
    this.beginScope();
    for (const stmt of block.statements) {
      this.resolveStmt(stmt);
    }
    if (block.tailExpr) {
      this.resolveExpr(block.tailExpr);
    }
    this.endScope();
  }

  private beginScope(): void {
    this.scopes.push(new Map());
  }

  private endScope(): void {
    this.scopes.pop();
  }

  private define(name: string): number {
    const slot = this.currentSlot++;
    this.scopes[this.scopes.length - 1].set(name, slot);
    return slot;
  }
}
