// AssemblyScript WASM shim for `product_spec.md` B. Worker ↔ WASM ABI.
//
// Note: This is intentionally a thin bridge. The "real" engine currently lives
// in TypeScript in the Worker and is called via imports.

@external("env", "js_deos_alloc")
declare function js_deos_alloc(size: u32): u32;
@external("env", "js_deos_free")
declare function js_deos_free(ptr: u32, size: u32): void;

@external("env", "js_deos_init")
declare function js_deos_init(
  cyclesPerTick: u32,
  timesliceTicks: u32,
  snapshotEveryTicks: u32,
  eventMask: u32,
): i32;
@external("env", "js_deos_reset")
declare function js_deos_reset(): i32;

@external("env", "js_deos_load_module")
declare function js_deos_load_module(
  namePtr: u32,
  nameLen: u32,
  tbcPtr: u32,
  tbcLen: u32,
): i32;
@external("env", "js_deos_unload_all_modules")
declare function js_deos_unload_all_modules(): i32;

@external("env", "js_deos_create_task")
declare function js_deos_create_task(
  tid: u32,
  namePtr: u32,
  nameLen: u32,
  entryFnIndex: u32,
  domainId: u32,
): i32;
@external("env", "js_deos_kill_task")
declare function js_deos_kill_task(tid: u32): i32;

@external("env", "js_deos_set_scheduler_policy")
declare function js_deos_set_scheduler_policy(namePtr: u32, nameLen: u32): i32;

@external("env", "js_deos_input_kbd")
declare function js_deos_input_kbd(byte: u32, isDown: u32): i32;

@external("env", "js_deos_schedule_kbd")
declare function js_deos_schedule_kbd(
  atCycleLo: u32,
  atCycleHi: u32,
  byte: u32,
  isDown: u32,
): i32;

@external("env", "js_deos_step")
declare function js_deos_step(n: u32): u32;

@external("env", "js_deos_run_until_tick")
declare function js_deos_run_until_tick(targetTick: u32, maxInstructions: u32): u32;

@external("env", "js_deos_set_paused")
declare function js_deos_set_paused(paused: u32): void;
@external("env", "js_deos_get_paused")
declare function js_deos_get_paused(): u32;

@external("env", "js_deos_record_start")
declare function js_deos_record_start(): i32;
@external("env", "js_deos_record_stop")
declare function js_deos_record_stop(): i32;
@external("env", "js_deos_replay_start")
declare function js_deos_replay_start(): i32;
@external("env", "js_deos_replay_stop")
declare function js_deos_replay_stop(): i32;

@external("env", "js_deos_get_state_json")
declare function js_deos_get_state_json(detail: u32, outPtr: u32, outLen: u32): i32;
@external("env", "js_deos_export_snapshot_json")
declare function js_deos_export_snapshot_json(outPtr: u32, outLen: u32): i32;
@external("env", "js_deos_load_snapshot_json")
declare function js_deos_load_snapshot_json(jsonPtr: u32, jsonLen: u32): i32;

@external("env", "js_deos_poll_event_json")
declare function js_deos_poll_event_json(outPtr: u32, outLen: u32): i32;

@external("env", "js_deos_get_last_error_json")
declare function js_deos_get_last_error_json(outPtr: u32, outLen: u32): i32;

export function deos_api_version(): u32 {
  return 0x0001_0000;
}

export function deos_alloc(size: u32): u32 {
  return js_deos_alloc(size);
}

export function deos_free(ptr: u32, size: u32): void {
  js_deos_free(ptr, size);
}

export function deos_init(
  cyclesPerTick: u32,
  timesliceTicks: u32,
  snapshotEveryTicks: u32,
  eventMask: u32,
): i32 {
  return js_deos_init(cyclesPerTick, timesliceTicks, snapshotEveryTicks, eventMask);
}

export function deos_reset(): i32 {
  return js_deos_reset();
}

export function deos_load_module(
  namePtr: u32,
  nameLen: u32,
  tbcPtr: u32,
  tbcLen: u32,
): i32 {
  return js_deos_load_module(namePtr, nameLen, tbcPtr, tbcLen);
}

export function deos_unload_all_modules(): i32 {
  return js_deos_unload_all_modules();
}

export function deos_create_task(
  tid: u32,
  namePtr: u32,
  nameLen: u32,
  entryFnIndex: u32,
  domainId: u32,
): i32 {
  return js_deos_create_task(tid, namePtr, nameLen, entryFnIndex, domainId);
}

export function deos_kill_task(tid: u32): i32 {
  return js_deos_kill_task(tid);
}

export function deos_set_scheduler_policy(namePtr: u32, nameLen: u32): i32 {
  return js_deos_set_scheduler_policy(namePtr, nameLen);
}

export function deos_input_kbd(byte: u32, isDown: u32): i32 {
  return js_deos_input_kbd(byte, isDown);
}

export function deos_schedule_kbd(
  atCycleLo: u32,
  atCycleHi: u32,
  byte: u32,
  isDown: u32,
): i32 {
  return js_deos_schedule_kbd(atCycleLo, atCycleHi, byte, isDown);
}

export function deos_step(n: u32): u32 {
  return js_deos_step(n);
}

export function deos_run_until_tick(targetTick: u32, maxInstructions: u32): u32 {
  return js_deos_run_until_tick(targetTick, maxInstructions);
}

export function deos_set_paused(paused: u32): void {
  js_deos_set_paused(paused);
}

export function deos_get_paused(): u32 {
  return js_deos_get_paused();
}

export function deos_record_start(): i32 {
  return js_deos_record_start();
}
export function deos_record_stop(): i32 {
  return js_deos_record_stop();
}
export function deos_replay_start(): i32 {
  return js_deos_replay_start();
}
export function deos_replay_stop(): i32 {
  return js_deos_replay_stop();
}

export function deos_get_state_json(detail: u32, outPtr: u32, outLen: u32): i32 {
  return js_deos_get_state_json(detail, outPtr, outLen);
}
export function deos_export_snapshot_json(outPtr: u32, outLen: u32): i32 {
  return js_deos_export_snapshot_json(outPtr, outLen);
}
export function deos_load_snapshot_json(jsonPtr: u32, jsonLen: u32): i32 {
  return js_deos_load_snapshot_json(jsonPtr, jsonLen);
}

export function deos_poll_event_json(outPtr: u32, outLen: u32): i32 {
  return js_deos_poll_event_json(outPtr, outLen);
}

export function deos_get_last_error_json(outPtr: u32, outLen: u32): i32 {
  return js_deos_get_last_error_json(outPtr, outLen);
}

