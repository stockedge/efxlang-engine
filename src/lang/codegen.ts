import { type Program, type Stmt, type Expr, type BlockExpr } from "./ast";
import { type ResolveResult } from "./resolver";
import { Opcode, SyscallType } from "../bytecode/opcode";
import { TokenType } from "./token";
import { type Value } from "../vm/value";

export interface TBCFile {
  consts: Value[];
  functions: TBCFunction[];
}

export interface TBCFunction {
  arity: number;
  locals: number;
  handlers: TBCHandler[];
  code: Uint8Array;
}

export interface TBCHandler {
  returnFnIndex: number;
  donePc: number;
  clauses: {
    effectNameConst: number;
    clauseFnIndex: number;
  }[];
}

export class Codegen {
  private consts: Value[] = [];
  private functions: TBCFunction[] = [];
  private currentCode: number[] = [];
  private currentHandlers: TBCHandler[] = [];

  private syscalls: Map<string, SyscallType> = new Map([
    ["print", SyscallType.SYS_PRINT],
    ["yield", SyscallType.SYS_YIELD],
    ["sleep", SyscallType.SYS_SLEEP],
    ["getc", SyscallType.SYS_GETC],
    ["putc", SyscallType.SYS_PUTC],
    ["exit", SyscallType.SYS_EXIT],
  ]);

  constructor(private result: ResolveResult) {}

  generate(program: Program): TBCFile {
    const fnIdx = this.result.fnIdxMap.get(program);
    if (fnIdx === undefined) throw new Error("Missing program fnIdx");
    this.genFunction(
      fnIdx,
      Array.isArray(program.statements)
        ? program.statements
        : [program.statements],
    );
    return {
      consts: this.consts,
      functions: this.functions,
    };
  }

  private genFunction(
    fnIdx: number,
    body: Stmt[] | Expr,
    arity: number = 0,
  ): void {
    const saveCode = this.currentCode;
    const saveHandlers = this.currentHandlers;
    this.currentCode = [];
    this.currentHandlers = [];

    this.emit(Opcode.SAFEPOINT);

    if (Array.isArray(body)) {
      for (const stmt of body) this.genStmt(stmt);
    } else {
      this.genExpr(body);
    }

    const lastByte = this.peekCode();
    if (fnIdx === 0 && (lastByte as Opcode) !== Opcode.HALT) {
      this.emit(Opcode.HALT);
    } else if ((lastByte as Opcode) !== Opcode.RET) {
      this.emit(Opcode.RET);
    }

    this.functions[fnIdx] = {
      arity,
      locals: this.result.maxSlots.get(fnIdx) ?? 0,
      handlers: this.currentHandlers,
      code: new Uint8Array(this.currentCode),
    };

    this.currentCode = saveCode;
    this.currentHandlers = saveHandlers;
  }

  private genStmt(stmt: Stmt): void {
    switch (stmt.kind) {
      case "LetStmt": {
        this.genExpr(stmt.initializer);
        const slot = this.result.letSlots.get(stmt);
        if (slot === undefined) throw new Error("Missing let slot");
        this.emit(Opcode.STORE);
        this.emitU16(0);
        this.emitU16(slot);
        this.emit(Opcode.POP);
        break;
      }
      case "ExprStmt":
        this.genExpr(stmt.expr);
        this.emit(Opcode.POP);
        break;
    }
  }

  private genExpr(expr: Expr): void {
    switch (expr.kind) {
      case "LiteralExpr":
        this.emit(Opcode.CONST);
        this.emitU16(this.addConst(expr.value));
        break;
      case "VarExpr": {
        const res = this.result.resolutions.get(expr);
        if (!res) throw new Error(`Unresolved variable: ${expr.name.lexeme}`);
        this.emit(Opcode.LOAD);
        this.emitU16(res.depth);
        this.emitU16(res.slot);
        break;
      }
      case "BinaryExpr":
        this.genExpr(expr.left);
        this.genExpr(expr.right);
        switch (expr.operator.type) {
          case TokenType.PLUS:
            this.emit(Opcode.ADD);
            break;
          case TokenType.MINUS:
            this.emit(Opcode.SUB);
            break;
          case TokenType.STAR:
            this.emit(Opcode.MUL);
            break;
          case TokenType.SLASH:
            this.emit(Opcode.DIV);
            break;
          case TokenType.EQUAL_EQUAL:
            this.emit(Opcode.EQ);
            break;
          case TokenType.LESS:
            this.emit(Opcode.LT);
            break;
          case TokenType.GREATER:
            this.emit(Opcode.GT);
            break;
        }
        break;
      case "CallExpr":
        if (expr.callee.kind === "VarExpr") {
          const sys = this.syscalls.get(expr.callee.name.lexeme);
          if (sys !== undefined) {
            for (const arg of expr.args) this.genExpr(arg);
            this.emit(Opcode.SYS);
            this.emitU16(sys);
            return;
          }
        }
        this.genExpr(expr.callee);
        for (const arg of expr.args) this.genExpr(arg);
        this.emit(Opcode.CALL);
        this.emitU16(expr.args.length);
        break;
      case "FunExpr": {
        const fnIdx = this.result.fnIdxMap.get(expr);
        if (fnIdx === undefined) throw new Error("Missing function fnIdx");
        this.genFunction(fnIdx, expr.body, expr.params.length);
        this.emit(Opcode.CLOSURE);
        this.emitU16(fnIdx);
        break;
      }
      case "IfExpr": {
        this.genExpr(expr.condition);
        const jmpfPos = this.emitJumpF();
        this.genBlock(expr.thenBranch);
        const jmpPos = this.emitJump();
        this.patchJump(jmpfPos);
        this.genBlock(expr.elseBranch);
        this.patchJump(jmpPos);
        break;
      }
      case "WhileExpr": {
        const startPos = this.currentCode.length;
        this.emit(Opcode.SAFEPOINT);
        this.genExpr(expr.condition);
        const jmpfPos = this.emitJumpF();
        this.genBlock(expr.body);
        this.emit(Opcode.JMP);
        this.emitU32(startPos);
        this.patchJump(jmpfPos);
        this.emit(Opcode.CONST);
        this.emitU16(this.addConst(null));
        break;
      }
      case "BlockExpr":
        this.genBlock(expr);
        break;
      case "PerformExpr":
        for (const arg of expr.args) this.genExpr(arg);
        this.emit(Opcode.PERFORM);
        this.emitU16(this.addConst(expr.opName.lexeme));
        this.emitU16(expr.args.length);
        break;
      case "HandleExpr": {
        const hIdx = this.currentHandlers.length;
        const handler: TBCHandler = {
          returnFnIndex: 0xffff,
          clauses: [],
          donePc: 0,
        };
        this.currentHandlers.push(handler);
        const hDoneLabel = this.createLabel();
        this.emit(Opcode.PUSH_HANDLER);
        this.emitU16(hIdx);
        const donePatchPos = this.currentCode.length;
        this.emitU32(0);

        this.genExpr(expr.body);
        this.emit(Opcode.POP_HANDLER);

        if (expr.handler.returnClause) {
          const retFnIdx = this.result.fnIdxMap.get(expr.handler.returnClause);
          if (retFnIdx === undefined)
            throw new Error("Missing returnClause fnIdx");
          this.genFunction(retFnIdx, expr.handler.returnClause.body, 1);
          handler.returnFnIndex = retFnIdx;
          this.emit(Opcode.CLOSURE);
          this.emitU16(retFnIdx);
          this.emit(Opcode.SWAP);
          this.emit(Opcode.CALL);
          this.emitU16(1);
        }

        this.patchLabel(hDoneLabel);
        if (hDoneLabel.pos === null)
          throw new Error("Missing handler done label pos");
        this.patchU32(donePatchPos, hDoneLabel.pos);
        handler.donePc = hDoneLabel.pos;
        this.emit(Opcode.HANDLE_DONE);

        this.emit(Opcode.JMP);
        this.emitU32(0);
        const jmpAfterClausesPos = this.currentCode.length - 4;

        // Clauses (evaluated outside the handler)
        for (const clause of expr.handler.opClauses) {
          const cFnIdx = this.result.fnIdxMap.get(clause);
          if (cFnIdx === undefined) throw new Error("Missing clause fnIdx");
          this.genFunction(cFnIdx, clause.body, clause.params.length + 1);
          handler.clauses.push({
            effectNameConst: this.addConst(clause.opName.lexeme),
            clauseFnIndex: cFnIdx,
          });
        }
        this.patchU32(jmpAfterClausesPos, this.currentCode.length);
        break;
      }
    }
  }

  private genBlock(block: BlockExpr): void {
    let hasValueOnStack = false;

    for (let i = 0; i < block.statements.length; i++) {
      const stmt = block.statements[i];
      const isLast = i === block.statements.length - 1;

      // Treat the last expression statement as the block value even if it has a semicolon.
      if (!block.tailExpr && isLast && stmt.kind === "ExprStmt") {
        this.genExpr(stmt.expr);
        hasValueOnStack = true;
        continue;
      }

      this.genStmt(stmt);
    }

    if (block.tailExpr) {
      this.genExpr(block.tailExpr);
      hasValueOnStack = true;
    }

    if (!hasValueOnStack) {
      this.emit(Opcode.CONST);
      this.emitU16(this.addConst(null));
    }
  }

  private addConst(val: Value): number {
    const existing = this.consts.findIndex((v) => v === val);
    if (existing !== -1 && typeof val !== "object") return existing;
    this.consts.push(val);
    return this.consts.length - 1;
  }

  private emit(op: Opcode) {
    this.currentCode.push(op);
  }
  private emitU16(v: number) {
    this.currentCode.push(v & 0xff, (v >> 8) & 0xff);
  }
  private emitU32(v: number) {
    this.currentCode.push(
      v & 0xff,
      (v >> 8) & 0xff,
      (v >> 16) & 0xff,
      (v >> 24) & 0xff,
    );
  }
  private peekCode() {
    return this.currentCode.at(-1);
  }
  private emitJump() {
    this.emit(Opcode.JMP);
    const pos = this.currentCode.length;
    this.emitU32(0);
    return pos;
  }
  private emitJumpF() {
    this.emit(Opcode.JMPF);
    const pos = this.currentCode.length;
    this.emitU32(0);
    return pos;
  }
  private patchJump(pos: number) {
    this.patchU32(pos, this.currentCode.length);
  }
  private patchU32(pos: number, val: number) {
    this.currentCode[pos] = val & 0xff;
    this.currentCode[pos + 1] = (val >> 8) & 0xff;
    this.currentCode[pos + 2] = (val >> 16) & 0xff;
    this.currentCode[pos + 3] = (val >> 24) & 0xff;
  }
  private createLabel() {
    return { pos: null as number | null };
  }
  private patchLabel(label: { pos: number | null }) {
    label.pos = this.currentCode.length;
  }
}
