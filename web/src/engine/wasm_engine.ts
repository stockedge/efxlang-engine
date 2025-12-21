import { DeosEngine } from "./deos_engine";
import type { Engine } from "./engine_factory";

type DeosWasmExports = {
  memory: WebAssembly.Memory;
  deos_api_version: () => number;
  deos_alloc: (size: number) => number;
  deos_free: (ptr: number, size: number) => void;
  deos_init: (
    cyclesPerTick: number,
    timesliceTicks: number,
    snapshotEveryTicks: number,
    eventMask: number,
  ) => number;
  deos_reset: () => number;
  deos_load_module: (
    namePtr: number,
    nameLen: number,
    tbcPtr: number,
    tbcLen: number,
  ) => number;
  deos_unload_all_modules: () => number;
  deos_create_task: (
    tid: number,
    namePtr: number,
    nameLen: number,
    entryFnIndex: number,
    domainId: number,
  ) => number;
  deos_kill_task: (tid: number) => number;
  deos_set_scheduler_policy: (namePtr: number, nameLen: number) => number;
  deos_input_kbd: (byte: number, isDown: number) => number;
  deos_schedule_kbd: (
    atCycleLo: number,
    atCycleHi: number,
    byte: number,
    isDown: number,
  ) => number;
  deos_step: (n: number) => number;
  deos_run_until_tick: (targetTick: number, maxInstructions: number) => number;
  deos_set_paused: (paused: number) => void;
  deos_get_paused: () => number;
  deos_record_start: () => number;
  deos_record_stop: () => number;
  deos_replay_start: () => number;
  deos_replay_stop: () => number;
  deos_get_state_json: (
    detail: number,
    outPtr: number,
    outLen: number,
  ) => number;
  deos_export_snapshot_json: (outPtr: number, outLen: number) => number;
  deos_load_snapshot_json: (jsonPtr: number, jsonLen: number) => number;
  deos_poll_event_json: (outPtr: number, outLen: number) => number;
  deos_get_last_error_json: (outPtr: number, outLen: number) => number;
};

type FreeBlock = { ptr: number; size: number };

const WASM_PAGE_BYTES = 64 * 1024;

function u32(n: number): number {
  return n >>> 0;
}

function ensureOk(res: Response): void {
  if (res.ok) return;
  throw new Error(`WASM fetch failed: ${String(res.status)} ${res.statusText}`);
}

class WasmDeosEngine implements Engine {
  constructor(
    private exports: DeosWasmExports,
    private textDecoder: TextDecoder,
    private textEncoder: TextEncoder,
  ) {}

  init(
    cyclesPerTick: number,
    timesliceTicks: number,
    snapshotEveryTicks: number,
    eventMask: number,
  ): number {
    return this.exports.deos_init(
      cyclesPerTick,
      timesliceTicks,
      snapshotEveryTicks,
      eventMask,
    );
  }

  reset(): number {
    return this.exports.deos_reset();
  }

  loadModule(moduleName: string, tbcBytes: Uint8Array): number {
    const name = this.allocUtf8(moduleName);
    const tbc = this.allocBytes(tbcBytes);
    try {
      return this.exports.deos_load_module(
        name.ptr,
        name.len,
        tbc.ptr,
        tbc.len,
      );
    } finally {
      this.exports.deos_free(tbc.ptr, tbc.len);
      this.exports.deos_free(name.ptr, name.len);
    }
  }

  unloadAllModules(): number {
    return this.exports.deos_unload_all_modules();
  }

  createTask(
    tid: number,
    moduleName: string,
    entryFnIndex: number,
    domainId: number,
  ): number {
    const name = this.allocUtf8(moduleName);
    try {
      return this.exports.deos_create_task(
        u32(tid),
        name.ptr,
        name.len,
        u32(entryFnIndex),
        u32(domainId),
      );
    } finally {
      this.exports.deos_free(name.ptr, name.len);
    }
  }

  killTask(tid: number): number {
    return this.exports.deos_kill_task(u32(tid));
  }

  setSchedulerPolicy(moduleNameOrNull: string | null): number {
    if (!moduleNameOrNull) return this.exports.deos_set_scheduler_policy(0, 0);
    const name = this.allocUtf8(moduleNameOrNull);
    try {
      return this.exports.deos_set_scheduler_policy(name.ptr, name.len);
    } finally {
      this.exports.deos_free(name.ptr, name.len);
    }
  }

  inputKbd(byte: number, isDown: boolean): number {
    return this.exports.deos_input_kbd(u32(byte), isDown ? 1 : 0);
  }

  scheduleKbd(atCycle: bigint, byte: number, isDown: boolean): number {
    const lo = Number(atCycle & 0xffff_ffffn);
    const hi = Number((atCycle >> 32n) & 0xffff_ffffn);
    return this.exports.deos_schedule_kbd(
      u32(lo),
      u32(hi),
      u32(byte),
      isDown ? 1 : 0,
    );
  }

  setPaused(paused: boolean): void {
    this.exports.deos_set_paused(paused ? 1 : 0);
  }

  getPaused(): boolean {
    return this.exports.deos_get_paused() !== 0;
  }

  step(n: number): number {
    return this.exports.deos_step(u32(n));
  }

  runUntilTick(targetTick: number, maxInstructions: number): 0 | 1 {
    const ret = this.exports.deos_run_until_tick(
      u32(targetTick),
      u32(maxInstructions),
    );
    return ret === 0 ? 0 : 1;
  }

  pollEventJson(): string | null {
    return this.readOutStringNullable((outPtr, outLen) =>
      this.exports.deos_poll_event_json(outPtr, outLen),
    );
  }

  getStateJson(detail: "summary" | "full"): string {
    const d = detail === "summary" ? 0 : 1;
    return this.readOutString((outPtr, outLen) =>
      this.exports.deos_get_state_json(d, outPtr, outLen),
    );
  }

  exportSnapshotJson(): string {
    return this.readOutString((outPtr, outLen) =>
      this.exports.deos_export_snapshot_json(outPtr, outLen),
    );
  }

  loadSnapshotJson(json: string): number {
    const buf = this.allocUtf8(json);
    try {
      return this.exports.deos_load_snapshot_json(buf.ptr, buf.len);
    } finally {
      this.exports.deos_free(buf.ptr, buf.len);
    }
  }

  recordStart(): number {
    return this.exports.deos_record_start();
  }
  recordStop(): number {
    return this.exports.deos_record_stop();
  }
  replayStart(): number {
    return this.exports.deos_replay_start();
  }
  replayStop(): number {
    return this.exports.deos_replay_stop();
  }

  getLastErrorJson(): string {
    return this.readOutString((outPtr, outLen) =>
      this.exports.deos_get_last_error_json(outPtr, outLen),
    );
  }

  private allocUtf8(str: string): { ptr: number; len: number } {
    const bytes = this.textEncoder.encode(str);
    const ptr = this.exports.deos_alloc(bytes.length);
    const mem = new Uint8Array(this.exports.memory.buffer, ptr, bytes.length);
    mem.set(bytes);
    return { ptr, len: bytes.length };
  }

  private allocBytes(bytes: Uint8Array): { ptr: number; len: number } {
    const ptr = this.exports.deos_alloc(bytes.length);
    const mem = new Uint8Array(this.exports.memory.buffer, ptr, bytes.length);
    mem.set(bytes);
    return { ptr, len: bytes.length };
  }

  private readOutString(
    fn: (outPtr: number, outLen: number) => number,
  ): string {
    let outLen = 16 * 1024;
    for (;;) {
      const outPtr = this.exports.deos_alloc(outLen);
      const ret = fn(outPtr, outLen);
      if (ret === 0) {
        this.exports.deos_free(outPtr, outLen);
        return "";
      }
      if (ret > 0) {
        const bytes = new Uint8Array(this.exports.memory.buffer, outPtr, ret);
        const s = this.textDecoder.decode(bytes);
        this.exports.deos_free(outPtr, outLen);
        return s;
      }
      const required = -ret;
      this.exports.deos_free(outPtr, outLen);
      outLen = required;
    }
  }

  private readOutStringNullable(
    fn: (outPtr: number, outLen: number) => number,
  ): string | null {
    let outLen = 4 * 1024;
    for (;;) {
      const outPtr = this.exports.deos_alloc(outLen);
      const ret = fn(outPtr, outLen);
      if (ret === 0) {
        this.exports.deos_free(outPtr, outLen);
        return null;
      }
      if (ret > 0) {
        const bytes = new Uint8Array(this.exports.memory.buffer, outPtr, ret);
        const s = this.textDecoder.decode(bytes);
        this.exports.deos_free(outPtr, outLen);
        return s;
      }
      const required = -ret;
      this.exports.deos_free(outPtr, outLen);
      outLen = required;
    }
  }
}

export async function createWasmEngine(): Promise<Engine> {
  const jsEngine = new DeosEngine();
  const textDecoder = new TextDecoder();
  const textEncoder = new TextEncoder();

  let wasmMemory: WebAssembly.Memory | null = null;
  const freeBlocks: FreeBlock[] = [];
  let heapEnd = 0;

  const getMemory = (): WebAssembly.Memory => {
    if (!wasmMemory) throw new Error("WASM memory not ready");
    return wasmMemory;
  };

  const ensureCapacity = (endByteOffset: number): void => {
    const mem = getMemory();
    const cur = mem.buffer.byteLength;
    if (endByteOffset <= cur) return;
    const needed = endByteOffset - cur;
    const pages = Math.ceil(needed / WASM_PAGE_BYTES);
    mem.grow(pages);
  };

  const alloc = (size: number): number => {
    const n = (u32(size) + 7) & ~7;
    for (let i = 0; i < freeBlocks.length; i++) {
      const b = freeBlocks[i];
      if (b.size < n) continue;
      const ptr = b.ptr;
      if (b.size === n) freeBlocks.splice(i, 1);
      else freeBlocks[i] = { ptr: b.ptr + n, size: b.size - n };
      return ptr;
    }

    const ptr = heapEnd;
    const end = ptr + n;
    ensureCapacity(end);
    heapEnd = end;
    return ptr;
  };

  const free = (ptr: number, size: number): void => {
    if (ptr === 0 || size === 0) return;
    const n = (u32(size) + 7) & ~7;
    freeBlocks.push({ ptr: u32(ptr), size: n });
  };

  const readUtf8 = (ptr: number, len: number): string => {
    const bytes = new Uint8Array(getMemory().buffer, ptr, len);
    return textDecoder.decode(bytes);
  };

  const writeUtf8 = (str: string, outPtr: number, outLen: number): number => {
    const bytes = textEncoder.encode(str);
    if (bytes.length > outLen) return -bytes.length;
    new Uint8Array(getMemory().buffer, outPtr, bytes.length).set(bytes);
    return bytes.length;
  };

  const imports: WebAssembly.Imports = {
    env: {
      abort(_msg: number, _file: number, line: number, col: number) {
        throw new Error(`WASM abort at ${String(line)}:${String(col)}`);
      },

      js_deos_alloc(size: number) {
        return alloc(size);
      },
      js_deos_free(ptr: number, size: number) {
        free(ptr, size);
      },

      js_deos_init(
        cyclesPerTick: number,
        timesliceTicks: number,
        snapshotEveryTicks: number,
        eventMask: number,
      ) {
        return jsEngine.init(
          u32(cyclesPerTick),
          u32(timesliceTicks),
          u32(snapshotEveryTicks),
          u32(eventMask),
        );
      },
      js_deos_reset() {
        return jsEngine.reset();
      },

      js_deos_load_module(
        namePtr: number,
        nameLen: number,
        tbcPtr: number,
        tbcLen: number,
      ) {
        const name = readUtf8(namePtr, nameLen);
        const bytes = new Uint8Array(getMemory().buffer, tbcPtr, tbcLen);
        jsEngine.loadModule(name, new Uint8Array(bytes));
        return 0;
      },
      js_deos_unload_all_modules() {
        return jsEngine.unloadAllModules();
      },

      js_deos_create_task(
        tid: number,
        namePtr: number,
        nameLen: number,
        entryFnIndex: number,
        domainId: number,
      ) {
        const name = readUtf8(namePtr, nameLen);
        jsEngine.createTask(u32(tid), name, u32(entryFnIndex), u32(domainId));
        return 0;
      },
      js_deos_kill_task(tid: number) {
        return jsEngine.killTask(u32(tid));
      },

      js_deos_set_scheduler_policy(namePtr: number, nameLen: number) {
        if (nameLen === 0) return jsEngine.setSchedulerPolicy(null);
        return jsEngine.setSchedulerPolicy(readUtf8(namePtr, nameLen));
      },

      js_deos_input_kbd(byte: number, isDown: number) {
        return jsEngine.inputKbd(u32(byte), isDown !== 0);
      },

      js_deos_schedule_kbd(
        atCycleLo: number,
        atCycleHi: number,
        byte: number,
        isDown: number,
      ) {
        const atCycle =
          (BigInt(u32(atCycleHi)) << 32n) | BigInt(u32(atCycleLo));
        return jsEngine.scheduleKbd(atCycle, u32(byte), isDown !== 0);
      },

      js_deos_step(n: number) {
        return jsEngine.step(u32(n));
      },

      js_deos_run_until_tick(targetTick: number, maxInstructions: number) {
        return jsEngine.runUntilTick(u32(targetTick), u32(maxInstructions));
      },

      js_deos_set_paused(paused: number) {
        jsEngine.setPaused(paused !== 0);
      },
      js_deos_get_paused() {
        return jsEngine.getPaused() ? 1 : 0;
      },

      js_deos_record_start() {
        return jsEngine.recordStart();
      },
      js_deos_record_stop() {
        return jsEngine.recordStop();
      },
      js_deos_replay_start() {
        return jsEngine.replayStart();
      },
      js_deos_replay_stop() {
        return jsEngine.replayStop();
      },

      js_deos_get_state_json(detail: number, outPtr: number, outLen: number) {
        const json = jsEngine.getStateJson(detail === 0 ? "summary" : "full");
        return writeUtf8(json, outPtr, outLen);
      },
      js_deos_export_snapshot_json(outPtr: number, outLen: number) {
        const json = jsEngine.exportSnapshotJson();
        return writeUtf8(json, outPtr, outLen);
      },
      js_deos_load_snapshot_json(jsonPtr: number, jsonLen: number) {
        const json = readUtf8(jsonPtr, jsonLen);
        return jsEngine.loadSnapshotJson(json);
      },

      js_deos_poll_event_json(outPtr: number, outLen: number) {
        const json = jsEngine.pollEventJson();
        if (!json) return 0;
        return writeUtf8(json, outPtr, outLen);
      },

      js_deos_get_last_error_json(outPtr: number, outLen: number) {
        const json = jsEngine.getLastErrorJson();
        return writeUtf8(json, outPtr, outLen);
      },
    },
  };

  const res = await fetch("/deos_engine.wasm");
  ensureOk(res);

  const { instance } = await WebAssembly.instantiate(
    await res.arrayBuffer(),
    imports,
  );

  const exports = instance.exports as unknown as Partial<DeosWasmExports>;
  if (!exports.memory) throw new Error("WASM missing memory export");
  wasmMemory = exports.memory;
  heapEnd = wasmMemory.buffer.byteLength;

  const deos = exports as DeosWasmExports;
  if (deos.deos_api_version() !== 0x0001_0000) {
    throw new Error("WASM api version mismatch");
  }

  return new WasmDeosEngine(deos, textDecoder, textEncoder);
}
