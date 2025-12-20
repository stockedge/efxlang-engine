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

class ByteWriter {
  private buffer: Uint8Array;
  private view: DataView;
  private offset = 0;

  constructor(size: number) {
    this.buffer = new Uint8Array(size);
    this.view = new DataView(this.buffer.buffer);
  }

  writeU8(v: number) {
    this.ensure(1);
    this.buffer[this.offset++] = v & 0xff;
  }

  writeU16(v: number) {
    this.ensure(2);
    this.view.setUint16(this.offset, v, true);
    this.offset += 2;
  }

  writeU32(v: number) {
    this.ensure(4);
    this.view.setUint32(this.offset, v, true);
    this.offset += 4;
  }

  writeF64(v: number) {
    this.ensure(8);
    this.view.setFloat64(this.offset, v, true);
    this.offset += 8;
  }

  writeBytes(v: Uint8Array) {
    this.ensure(v.length);
    this.buffer.set(v, this.offset);
    this.offset += v.length;
  }

  writeString(v: string) {
    const bytes = new TextEncoder().encode(v);
    this.writeU16(bytes.length);
    this.writeBytes(bytes);
  }

  finish(): Uint8Array {
    return this.buffer.subarray(0, this.offset);
  }

  private ensure(n: number) {
    if (this.offset + n <= this.buffer.length) return;

    let nextSize = this.buffer.length;
    while (this.offset + n > nextSize) nextSize *= 2;

    const next = new Uint8Array(nextSize);
    next.set(this.buffer);
    this.buffer = next;
    this.view = new DataView(this.buffer.buffer);
  }
}

class ByteReader {
  private view: DataView;
  private offset = 0;

  constructor(private buffer: Uint8Array) {
    this.view = new DataView(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    );
  }

  readU8() {
    return this.buffer[this.offset++];
  }
  readU16() {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }
  readU32() {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }
  readF64() {
    const v = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return v;
  }
  readBytes(n: number) {
    const v = this.buffer.subarray(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }
  readString() {
    const len = this.readU16();
    const b = this.readBytes(len);
    return new TextDecoder("utf-8").decode(b);
  }
}

export class TBCEncoder {
  constructor(size: number = 1024 * 1024) {
    this.initialSize = size;
    this.writer = new ByteWriter(size);
  }

  private initialSize: number;
  private writer: ByteWriter;

  encode(tbc: TBCFile): Uint8Array {
    this.writer = new ByteWriter(this.initialSize);

    // Header
    this.writer.writeU8(0xde);
    this.writer.writeU8(0x05);
    this.writer.writeU8(0x00);
    this.writer.writeU8(0x01);

    // Constant Pool
    this.writer.writeU16(tbc.consts.length);
    for (const c of tbc.consts) {
      if (c === null) {
        this.writer.writeU8(ConstType.NULL);
      } else if (typeof c === "boolean") {
        this.writer.writeU8(ConstType.BOOL);
        this.writer.writeU8(c ? 1 : 0);
      } else if (typeof c === "number") {
        this.writer.writeU8(ConstType.NUM);
        this.writer.writeF64(c);
      } else if (typeof c === "string") {
        this.writer.writeU8(ConstType.STR);
        this.writer.writeString(c);
      } else {
        throw new Error("Unsupported constant type");
      }
    }

    // Function Table
    this.writer.writeU16(tbc.functions.length);
    for (const f of tbc.functions) {
      this.writer.writeU16(f.arity);
      this.writer.writeU16(f.locals);
      this.writer.writeU32(f.code.length);
      this.writer.writeBytes(f.code);

      this.writer.writeU16(f.handlers.length);
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
        this.writer.writeU32(h.donePc || 0);
        this.writer.writeU16(h.returnFnIndex);
        this.writer.writeU16(h.clauses.length);
        for (const cl of h.clauses) {
          this.writer.writeU16(cl.effectNameConst);
          this.writer.writeU16(cl.clauseFnIndex);
        }
      }
    }

    // Export Table (empty for now)
    this.writer.writeU16(0);

    return this.writer.finish();
  }
}

export class TBCDecoder {
  private reader: ByteReader;
  constructor(data: Uint8Array) {
    this.reader = new ByteReader(data);
  }

  decode(): TBCFile {
    const magic = this.reader.readBytes(4);
    if (magic[0] !== 0xde || magic[1] !== 0x05)
      throw new Error("Invalid TBC magic");

    const constCount = this.reader.readU16();
    const consts: Value[] = [];
    for (let _i = 0; _i < constCount; _i++) {
      const type = this.reader.readU8();
      switch (type) {
        case ConstType.NULL:
          consts.push(null);
          break;
        case ConstType.BOOL:
          consts.push(this.reader.readU8() !== 0);
          break;
        case ConstType.NUM:
          consts.push(this.reader.readF64());
          break;
        case ConstType.STR:
          consts.push(this.reader.readString());
          break;
        default:
          throw new Error(`Unknown const type ${type}`);
      }
    }

    const fnCount = this.reader.readU16();
    const functions: TBCFunction[] = [];
    for (let _i = 0; _i < fnCount; _i++) {
      const arity = this.reader.readU16();
      const locals = this.reader.readU16();
      const codeLen = this.reader.readU32();
      const code = this.reader.readBytes(codeLen);
      const handlerCount = this.reader.readU16();
      const handlers: TBCHandler[] = [];
      for (let _j = 0; _j < handlerCount; _j++) {
        const donePc = this.reader.readU32();
        const returnFnIndex = this.reader.readU16();
        const clauseCount = this.reader.readU16();
        const clauses: { effectNameConst: number; clauseFnIndex: number }[] =
          [];
        for (let _k = 0; _k < clauseCount; _k++) {
          clauses.push({
            effectNameConst: this.reader.readU16(),
            clauseFnIndex: this.reader.readU16(),
          });
        }
        handlers.push({ returnFnIndex, clauses, donePc });
      }
      functions.push({ arity, locals, code, handlers });
    }

    return { consts, functions };
  }
}
