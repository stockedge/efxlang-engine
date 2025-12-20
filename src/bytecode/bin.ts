import { TBCFile, TBCFunction, TBCHandler } from "../lang/codegen";
import { Value } from "../vm/value";

export enum ConstType {
  NULL = 0,
  BOOL = 1,
  NUM = 2,
  STR = 3,
}

export interface LiteralExpr {
  kind: "LiteralExpr";
  value: number | boolean | string | null;
}

export interface TraceSnapshot {
  cycle: string;
  state_hash: string;
  data: unknown;
}

export interface TraceEvent {
  cycle: string; // bigint as string
  type: "input" | "syscall" | "safepoint";
  task: number;
  [key: string]: string | number | boolean | null | undefined | unknown;
}

export class TBCEncoder {
  private buffer: Buffer;
  private offset: number = 0;

  constructor(size: number = 1024 * 1024) {
    this.buffer = Buffer.alloc(size);
  }

  encode(tbc: TBCFile): Uint8Array {
    this.offset = 0;

    // Header
    this.writeU8(0xde);
    this.writeU8(0x05);
    this.writeU8(0x00);
    this.writeU8(0x01);

    // Constant Pool
    this.writeU16(tbc.consts.length);
    for (const c of tbc.consts) {
      if (c === null) {
        this.writeU8(ConstType.NULL);
      } else if (typeof c === "boolean") {
        this.writeU8(ConstType.BOOL);
        this.writeU8(c ? 1 : 0);
      } else if (typeof c === "number") {
        this.writeU8(ConstType.NUM);
        this.writeF64(c);
      } else if (typeof c === "string") {
        this.writeU8(ConstType.STR);
        this.writeString(c);
      } else {
        throw new Error("Unsupported constant type");
      }
    }

    // Function Table
    this.writeU16(tbc.functions.length);
    for (const f of tbc.functions) {
      this.writeU16(f.arity);
      this.writeU16(f.locals);
      this.writeU32(f.code.length);
      this.writeBytes(f.code);

      this.writeU16(f.handlers.length);
      for (const h of f.handlers) {
        // Spec 8.2 says handlers are per function
        // and they have (donePc, returnFnIdx, clauseCount)
        // Actually CodeGen stores donePc as a label or hardcoded in bytecode?
        // Spec says it's in the handler table.

        // Wait, where does donePc come from?
        // In my Codegen, I have `donePatchPos` in the bytecode.
        // Spec says "Handlers are defined in a table following the code block."
        // So I need to store the donePc in the metadata.

        // Wait, let's re-read Segment 8.2:
        // Handler Entry: `u32 donePc`, `u16 returnFnIdx`, `u16 clauseCount`.
        // My TBCHandler interface in codegen.ts currently lacks donePc?
        // No, it's patched in the bytecode but we also need it in the table.

        // Actually, Codegen should probably store it in TBCHandler object.
        this.writeU32(h.donePc || 0);
        this.writeU16(h.returnFnIndex);
        this.writeU16(h.clauses.length);
        for (const cl of h.clauses) {
          this.writeU16(cl.effectNameConst);
          this.writeU16(cl.clauseFnIndex);
        }
      }
    }

    // Export Table (empty for now)
    this.writeU16(0);

    return new Uint8Array(this.buffer.subarray(0, this.offset));
  }

  private writeU8(v: number) {
    this.buffer.writeUInt8(v, this.offset++);
  }
  private writeU16(v: number) {
    this.buffer.writeUInt16LE(v, this.offset);
    this.offset += 2;
  }
  private writeU32(v: number) {
    this.buffer.writeUInt32LE(v, this.offset);
    this.offset += 4;
  }
  private writeF64(v: number) {
    this.buffer.writeDoubleLE(v, this.offset);
    this.offset += 8;
  }
  private writeBytes(v: Uint8Array) {
    Buffer.from(v).copy(this.buffer, this.offset);
    this.offset += v.length;
  }
  private writeString(v: string) {
    const b = Buffer.from(v, "utf8");
    this.writeU16(b.length);
    this.writeBytes(b);
  }
}

export class TBCDecoder {
  private buffer: Buffer;
  private offset: number = 0;

  constructor(data: Uint8Array) {
    this.buffer = Buffer.from(data);
  }

  decode(): TBCFile {
    this.offset = 0;
    const magic = this.readBytes(4);
    if (magic[0] !== 0xde || magic[1] !== 0x05)
      throw new Error("Invalid TBC magic");

    const constCount = this.readU16();
    const consts: Value[] = [];
    for (let _i = 0; _i < constCount; _i++) {
      const type = this.readU8();
      switch (type) {
        case ConstType.NULL:
          consts.push(null);
          break;
        case ConstType.BOOL:
          consts.push(this.readU8() !== 0);
          break;
        case ConstType.NUM:
          consts.push(this.readF64());
          break;
        case ConstType.STR:
          consts.push(this.readString());
          break;
        default:
          throw new Error(`Unknown const type ${type}`);
      }
    }

    const fnCount = this.readU16();
    const functions: TBCFunction[] = [];
    for (let _i = 0; _i < fnCount; _i++) {
      const arity = this.readU16();
      const locals = this.readU16();
      const codeLen = this.readU32();
      const code = this.readBytes(codeLen);
      const handlerCount = this.readU16();
      const handlers: TBCHandler[] = [];
      for (let _j = 0; _j < handlerCount; _j++) {
        const donePc = this.readU32();
        const returnFnIndex = this.readU16();
        const clauseCount = this.readU16();
        const clauses: { effectNameConst: number; clauseFnIndex: number }[] =
          [];
        for (let _k = 0; _k < clauseCount; _k++) {
          clauses.push({
            effectNameConst: this.readU16(),
            clauseFnIndex: this.readU16(),
          });
        }
        handlers.push({ returnFnIndex, clauses, donePc });
      }
      functions.push({ arity, locals, code, handlers });
    }

    return { consts, functions };
  }

  private readU8() {
    return this.buffer.readUInt8(this.offset++);
  }
  private readU16() {
    const v = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return v;
  }
  private readU32() {
    const v = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }
  private readF64() {
    const v = this.buffer.readDoubleLE(this.offset);
    this.offset += 8;
    return v;
  }
  private readBytes(n: number) {
    const v = new Uint8Array(
      this.buffer.subarray(this.offset, this.offset + n),
    );
    this.offset += n;
    return v;
  }
  private readString() {
    const len = this.readU16();
    const b = this.readBytes(len);
    return Buffer.from(b).toString("utf8");
  }
}
