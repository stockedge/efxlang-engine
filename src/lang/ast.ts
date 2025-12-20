import { Token } from "./token";

export type Stmt = LetStmt | ExprStmt;

export interface LetStmt {
  kind: "LetStmt";
  name: Token;
  initializer: Expr;
}

export interface ExprStmt {
  kind: "ExprStmt";
  expr: Expr;
}

export type Expr =
  | LiteralExpr
  | VarExpr
  | BinaryExpr
  | CallExpr
  | FunExpr
  | IfExpr
  | WhileExpr
  | BlockExpr
  | PerformExpr
  | HandleExpr;

export interface LiteralExpr {
  kind: "LiteralExpr";
  value: number | boolean | string | null;
}

export interface VarExpr {
  kind: "VarExpr";
  name: Token;
}

export interface BinaryExpr {
  kind: "BinaryExpr";
  left: Expr;
  operator: Token;
  right: Expr;
}

export interface CallExpr {
  kind: "CallExpr";
  callee: Expr;
  args: Expr[];
}

export interface FunExpr {
  kind: "FunExpr";
  params: Token[];
  body: Expr;
}

export interface IfExpr {
  kind: "IfExpr";
  condition: Expr;
  thenBranch: BlockExpr;
  elseBranch: BlockExpr;
}

export interface WhileExpr {
  kind: "WhileExpr";
  condition: Expr;
  body: BlockExpr;
}

export interface BlockExpr {
  kind: "BlockExpr";
  statements: Stmt[];
  tailExpr?: Expr;
}

export interface PerformExpr {
  kind: "PerformExpr";
  opName: Token;
  args: Expr[];
}

export interface HandleExpr {
  kind: "HandleExpr";
  body: Expr;
  handler: HandlerDef;
}

export interface HandlerDef {
  returnClause?: ReturnClause;
  opClauses: OpClause[];
}

export interface ReturnClause {
  param: Token;
  body: Expr;
}

export interface OpClause {
  opName: Token;
  params: Token[];
  kName: Token;
  body: Expr;
}

export interface Program {
  statements: Stmt[];
}
