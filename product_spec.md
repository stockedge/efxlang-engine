# プロダクト仕様書: DEOS Browser v1.0

**Deterministic Effect OS + EfxLang (handle/perform) in Browser**

## 1. 製品概要

### 1.1 ユーザーができること（v1.0）

- EfxLangのコードをブラウザで編集して **実行結果（console出力）を見る**
- 実行を **Step/Run/Pause/Run-to-tick/Reverse-to-tick** で操作する
- 実行中の内部状態（タスク、スタック、ハンドラ、継続）を可視化する
- **Record** で trace（入力イベント＋スナップショット）を生成し、**Replay** で完全再現する
- スケジューラpolicy（EfxLangモジュール）を差し替えて、タスク実行順が変わることを確認する

### 1.2 非目標（v1.0ではやらない）

- SharedArrayBuffer/Threadsを使ったWASMマルチスレッド（配布難度が跳ねるので禁止）
- ソースレベルデバッガ（行番号ハイライトなど。v1.1以降）
- ネットワーク/FS/ディスク（v1.0はKBDとconsoleだけ）

---

## 2. 実行アーキテクチャ（必須）

UIが固まらないこと、決定性が壊れないことを優先。

```
[Main Thread (UI)]
  - Editor / Controls / Views
  - DOM rendering
  - user interactions (keyboard, buttons)
        |
        | postMessage (structured clone)
        v
[Web Worker]
  - EfxLang compiler (TS/JS)  ※WASM外でも良い
  - Engine controller (run loop, batching, trace builder)
  - WASM instance (DEOS Engine)
        |
        | WebAssembly (memory + exports)
        v
[WASM (DEOS Engine)]
  - Kernel (tasks, scheduler, syscalls)
  - EfxLang VM (bytecode, effects)
  - Deterministic clock (cycle/tick)
  - Event emit buffer (UI/trace向け)
```

---

## 3. 境界仕様の全体像（3つのAPI）

1. **UI ↔ Worker メッセージAPI**（アプリ機能の操作）
2. **Worker ↔ WASM 外部API**（エンジン制御、状態取得、イベント取得）
3. **WASM内イベント形式**（UI表示・Trace構築の元になる）

この3つを固定します。

---

# A. UI ↔ Worker メッセージAPI 仕様

## A-1. 共通ルール

- すべてのメッセージは JSON（structured clone可能なオブジェクト）
- `requestId` で対応を取る（UIは応答を待てる）
- Worker→UIの通知（イベント）は `type: "event"`、操作応答は `type: "response"`

### メッセージ共通ヘッダ

```ts
type MsgBase = {
  version: "1.0";
  requestId?: string; // response用（eventには不要）
};
```

---

## A-2. UI → Worker コマンド一覧（必須）

### 1) エンジン初期化

```ts
type CmdInit = MsgBase & {
  type: "command";
  command: "init";
  payload: {
    cyclesPerTick: number; // 例 10000
    timesliceTicks: number; // 例 1
    snapshotEveryTicks: number; // 例 100（record用）
    eventMask: number; // 後述（どのイベントをUIへ流すか）
  };
};
```

### 2) コンパイル（EfxLang → .tbc bytes）

v1.0ではコンパイラはWorker側（TS/JS）で動かす。WASMに入れない。

```ts
type CmdCompile = MsgBase & {
  type: "command";
  command: "compile";
  payload: {
    sourceName: string; // 例 "progA.efx"
    sourceText: string;
  };
};
```

**compile response**

```ts
type RespCompile = MsgBase & {
  type: "response";
  requestId: string;
  ok: true;
  payload: {
    tbc: ArrayBuffer; // .tbc bytes
    diagnostics: Array<{
      severity: "warn" | "info";
      message: string;
      line?: number;
      col?: number;
    }>;
  };
};
```

失敗時は `ok:false` と `error` を返す（後述）。

### 3) モジュールロード（.tbcをエンジンへ）

```ts
type CmdLoadModule = MsgBase & {
  type: "command";
  command: "loadModule";
  payload: {
    moduleName: string; // "progA" / "sched"
    tbc: ArrayBuffer;
  };
};
```

### 4) タスク作成

```ts
type CmdCreateTask = MsgBase & {
  type: "command";
  command: "createTask";
  payload: {
    tid: number; // 例 1
    moduleName: string; // 例 "progA"
    entryFnIndex?: number; // v1は0固定でも可
    domainId?: number; // v1は0固定でも可
  };
};
```

### 5) policy設定（scheduler）

```ts
type CmdSetSchedulerPolicy = MsgBase & {
  type: "command";
  command: "setSchedulerPolicy";
  payload: {
    moduleName: string | null; // nullならデフォルト
  };
};
```

### 6) 実行制御

#### Step

```ts
type CmdStep = MsgBase & {
  type: "command";
  command: "step";
  payload: { instructions: number }; // 例 1 / 100 / 10000
};
```

#### Run（一定tickまで or 無制限）

```ts
type CmdRun = MsgBase & {
  type: "command";
  command: "run";
  payload: {
    untilTick?: number; // 指定があればそこまで
    maxInstructions?: number; // 安全のため上限（例 5_000_000）
  };
};
```

#### Pause

```ts
type CmdPause = MsgBase & {
  type: "command";
  command: "pause";
};
```

#### Reverse-to-tick

```ts
type CmdReverseToTick = MsgBase & {
  type: "command";
  command: "reverseToTick";
  payload: { tick: number };
};
```

#### Reset（全消し）

```ts
type CmdReset = MsgBase & {
  type: "command";
  command: "reset";
};
```

### 7) Record/Replay

#### Record開始/停止

```ts
type CmdRecordStart = MsgBase & { type: "command"; command: "recordStart" };
type CmdRecordStop = MsgBase & { type: "command"; command: "recordStop" };
```

#### Record成果物取得（trace JSON）

```ts
type CmdGetTrace = MsgBase & {
  type: "command";
  command: "getTrace";
};
```

#### Replayロード

```ts
type CmdLoadTrace = MsgBase & {
  type: "command";
  command: "loadTrace";
  payload: { traceJsonText: string }; // v1.0はテキストで受ける
};
```

#### Replay開始（replayモードに切替）

```ts
type CmdReplayStart = MsgBase & { type: "command"; command: "replayStart" };
```

### 8) 状態取得（UI表示用）

```ts
type CmdGetState = MsgBase & {
  type: "command";
  command: "getState";
  payload: { detail: "summary" | "full" };
};
```

---

## A-3. Worker → UI 応答フォーマット

共通レスポンス：

```ts
type RespOk = MsgBase & {
  type: "response";
  requestId: string;
  ok: true;
  payload?: any;
};

type RespErr = MsgBase & {
  type: "response";
  requestId: string;
  ok: false;
  error: {
    code: string; // 例: "CompileError", "EngineError"
    message: string; // ユーザー向け
    details?: any; // 実装者向け
  };
};
```

---

## A-4. Worker → UI イベント（通知）

WorkerはWASMから取り出したイベントをUIへ転送する。

```ts
type UiEvent = MsgBase & {
  type: "event";
  event: DeosUiEvent;
};
```

`DeosUiEvent` は後述の「WASMイベントJSON仕様」と一致させる（変換しない）。
UIは `event.type` で分岐して表示する。

---

# B. Worker ↔ WASM 外部API（JS↔WASM ABI）仕様

## B-1. 前提

- WASMは **wasm32**（ポインタはu32）
- 文字列は **UTF-8**
- データ入出力は「WASM linear memory」を介する

## B-2. WASM exports（必須）

### 0) 互換性

```c
// returns packed version: major<<16 | minor
u32 deos_api_version();
```

期待: `0x00010000`（1.0）

### 1) メモリ確保（入力/出力バッファ用）

```c
u32 deos_alloc(u32 size);
void deos_free(u32 ptr, u32 size);
```

- JSは `deos_alloc` で確保し、memoryに書き込んで渡す
- 読み取り後もJSが `deos_free` で解放する

### 2) エンジン初期化／リセット

```c
i32 deos_init(u32 cyclesPerTick, u32 timesliceTicks, u32 snapshotEveryTicks, u32 eventMask);
i32 deos_reset();
```

- `eventMask` はどのイベントを内部バッファに積むか（後述）

### 3) モジュール操作

```c
// nameUtf8 is used as key
i32 deos_load_module(u32 namePtr, u32 nameLen, u32 tbcPtr, u32 tbcLen);
i32 deos_unload_all_modules();
```

### 4) タスク操作

```c
i32 deos_create_task(u32 tid, u32 namePtr, u32 nameLen, u32 entryFnIndex, u32 domainId);
i32 deos_kill_task(u32 tid);
```

### 5) policy設定

```c
// moduleName null扱い: nameLen=0
i32 deos_set_scheduler_policy(u32 namePtr, u32 nameLen);
```

### 6) 入力注入（ライブ入力）

```c
// enqueue host input; processed at SAFEPOINT
i32 deos_input_kbd(u32 byte, u32 isDown);
```

### 7) 実行制御

```c
// run exactly n instructions (across tasks), return executed instructions
u32 deos_step(u32 n);

// run until tick >= targetTick OR executed >= maxInstructions
// return 0 on normal stop, 1 if hit maxInstructions
u32 deos_run_until_tick(u32 targetTick, u32 maxInstructions);

// pause flag (deos_step/deos_run* should stop if paused==1)
void deos_set_paused(u32 paused);
u32  deos_get_paused();
```

### 8) Record/Replay（エンジン側のモード制御）

v1.0は trace本体はWorkerで組み立てるが、エンジンは「record中/ replay中」の挙動が変わるためモードを持つ。

```c
i32 deos_record_start();
i32 deos_record_stop();
i32 deos_replay_start();
i32 deos_replay_stop();
```

### 9) Replay用イベント投入（traceスケジュール）

```c
// schedule event for replay; injected when cycle reaches at SAFEPOINT
i32 deos_schedule_kbd(u32 atCycleLo, u32 atCycleHi, u32 byte, u32 isDown);
```

### 10) 状態・スナップショット取得/ロード（JSON）

#### state dump（UI表示）

```c
// write JSON into out buffer
// returns: >0 bytesWritten, 0 means empty, <0 means required size = -ret
i32 deos_get_state_json(u32 detail /*0 summary,1 full*/, u32 outPtr, u32 outLen);
```

#### snapshot export/import（Record/Replay）

```c
i32 deos_export_snapshot_json(u32 outPtr, u32 outLen);
i32 deos_load_snapshot_json(u32 jsonPtr, u32 jsonLen);
```

### 11) WASMイベント取り出し（poll方式）

WASM内部にイベントFIFO（UTF-8 JSON）を持つ。WorkerがpollしてUI/traceに流す。

```c
// returns: >0 bytesWritten into outPtr, 0 if no event, <0 required size
i32 deos_poll_event_json(u32 outPtr, u32 outLen);
```

### 12) last error（デバッグ用）

```c
i32 deos_get_last_error_json(u32 outPtr, u32 outLen);
```

- 直近エラーのJSON（code/message/details）を返す

---

## B-3. eventMask（WASM→JSへ流すイベントの種類）

`eventMask` はbit OR。

- `1<<0` Console出力
- `1<<1` Tick更新
- `1<<2` Task切替
- `1<<3` Effect perform
- `1<<4` Continuation call / return
- `1<<5` Input消費（record用の「いつ消費したか」）
- `1<<6` Policy decision（pickIndex結果）
- `1<<7` Error

v1.0推奨: `Console + Tick + TaskSwitch + Perform + Cont + InputConsumed + Error`

---

# C. WASMイベントJSON仕様（UI表示・trace構築の“唯一の真実”）

WASMから `deos_poll_event_json` で返るJSONは、UIとtrace構築がそのまま使う前提。

## C-1. 共通フィールド

すべてのイベントに以下を含める。

```json
{
  "type": "console|tick|taskSwitch|perform|contCall|contReturn|inputConsumed|policyPick|error",
  "cycle": "123456", // u64を文字列（BigInt不要にする）
  "tick": 12, // u64でもv1はnumber範囲で運用
  "tid": 1 // 関係するなら
}
```

`cycle` は文字列（10進）。UIは表示用にNumberへ落としても良いが、traceは文字列のまま保持。

---

## C-2. イベント種別

### 1) console

```json
{
  "type": "console",
  "cycle": "200",
  "tick": 0,
  "tid": 1,
  "text": "hello\n"
}
```

### 2) tick

tickが増えた時のみ出す（毎命令は出さない）。

```json
{
  "type": "tick",
  "cycle": "10000",
  "tick": 1
}
```

### 3) taskSwitch

```json
{
  "type": "taskSwitch",
  "cycle": "10000",
  "tick": 1,
  "fromTid": 1,
  "toTid": 2,
  "reason": "timeslice|yield|sleepWake"
}
```

### 4) perform（効果発火）

```json
{
  "type": "perform",
  "cycle": "12345",
  "tick": 1,
  "tid": 1,
  "effect": "Foo",
  "argc": 2
}
```

### 5) contCall（k(v)呼び出し）

```json
{
  "type": "contCall",
  "cycle": "12346",
  "tick": 1,
  "tid": 1,
  "oneShotUsedBefore": false
}
```

### 6) contReturn（HANDLE_DONEで親へ戻った）

```json
{
  "type": "contReturn",
  "cycle": "12399",
  "tick": 1,
  "tid": 1
}
```

### 7) inputConsumed（recordの根拠）

SAFEPOINTで「host input queue から実際に消費して kbdQueue に入れた」瞬間に出す。

```json
{
  "type": "inputConsumed",
  "cycle": "15000",
  "tick": 1,
  "kind": "KBD",
  "byte": 97,
  "isDown": true
}
```

### 8) policyPick（policy差し替えの可視化）

```json
{
  "type": "policyPick",
  "cycle": "10000",
  "tick": 1,
  "currentTid": 1,
  "pickedIndex": 0,
  "runnableTids": [1, 2]
}
```

### 9) error

```json
{
  "type": "error",
  "cycle": "123",
  "tick": 0,
  "tid": 1,
  "code": "ContinuationAlreadyUsed",
  "message": "ContinuationAlreadyUsed",
  "details": {}
}
```

---

# D. ブラウザ画面仕様（コンポーネント/イベント/表示項目）

## D-1. 画面レイアウト（1画面で完結）

**3ペイン構成**を固定すると実装が早い。

```
┌───────────────────────────────────────────────┐
│ TopBar: Project / Run Controls / Record/Replay │
├───────────────┬───────────────────────────────┤
│ Left: Editors │ Right: Tabs (Timeline/State/Trace) │
│  - prog.efx   │                               │
│  - policy.efx │                               │
├───────────────┴───────────────────────────────┤
│ Bottom: Console                                │
└───────────────────────────────────────────────┘
```

---

## D-2. コンポーネント一覧

### 1) TopBar

**表示項目**

- App名 `DEOS Browser`
- 実行状態: `Paused/Running/Replay/Recording`
- 現在 tick / cycle（cycleは短縮表示）

**操作**

- `Run` / `Pause` / `Step` / `Step xN` / `Run to tick` / `Reverse to tick` / `Reset`
- `Record Start/Stop`
- `Replay Load`（ファイル選択 or テキスト貼り付け） / `Replay Start/Stop`
- `Download Trace`（recordStop後に有効）

**UIイベント→Workerコマンド**

- Run → `run`
- Pause → `pause`
- Step → `step {instructions:1}`
- Step xN → `step {instructions:N}`
- Run to tick → `run {untilTick:T}`
- Reverse to tick → `reverseToTick {tick:T}`
- Reset → `reset`
- Record Start → `recordStart`
- Record Stop → `recordStop`
- Download Trace → `getTrace`
- Replay Load → `loadTrace`
- Replay Start/Stop → `replayStart / (replayStop = loadTraceなしにstopコマンドでも可)`

---

### 2) Editors（Left Pane）

**タブ**

- `Program`（prog.efx）
- `Scheduler Policy`（policy.efx）
- （任意）Examples

**操作**

- `Compile & Load Program`
- `Compile & Load Policy`
- エラーダイアグ表示（行/列が取れるなら表示）

**UIイベント→Worker**

- Compile Program: `compile` → `loadModule("progA")`
- Compile Policy: `compile` → `loadModule("sched")` → `setSchedulerPolicy("sched")`

---

### 3) Console（Bottom）

**表示**

- consoleログ（`console`イベントの `text` を追記）
- フィルタ（tid別 / 全部）
- `Clear` ボタン
- `Auto-scroll` toggle

**Workerイベント**

- `type:"console"` をそのまま追記

---

### 4) Timeline Tab（Right）

**目的**

- “OS上でVMが動いている”を見せる主役。tick単位の出来事を時系列で見せる。

**表示項目**

- X軸: tick（またはイベント順）
- 行（レーン）
  - Tick
  - TaskSwitch
  - Perform
  - Continuation
  - InputConsumed
  - PolicyPick

**インタラクション**

- クリックしたtick → `Reverse to tick` の入力欄に反映（ただし自動実行はしない）
- `Follow current tick` toggle（実行中に自動スクロール）

**入力イベント**

- Workerから届く `tick/taskSwitch/perform/contCall/contReturn/inputConsumed/policyPick` をすべて追記

---

### 5) State Tab（Right）

**目的**

- VM内部状態の“見える化”。

**表示項目（summary）**

- currentTid
- runnable/block/exitの一覧
- 各タスクの
  - callStack depth
  - valueStack height
  - handlerStack depth
  - yielding（継続復帰中か）

**表示項目（full）**

- current taskの:
  - callStack（fnIndex, ip）
  - valueStack（トップ数十件。多すぎると重いので上限50）
  - handlerStack（donePc, base depths, clause effect名）

- policyがロードされている場合:
  - policy module名
  - 直近 policyPick

**更新タイミング**

- `Pause`時は自動で `getState(detail:"full")`
- 実行中は `getState(detail:"summary")` を 1秒に1回まで（負荷対策）
- `Step`後は `full`

---

### 6) Trace Tab（Right）

**目的**

- record/replayの操作と確認。

**表示項目**

- trace metadata
  - cyclesPerTick / timesliceTicks / snapshotEveryTicks
  - modules一覧（名前、サイズ）

- events統計
  - inputConsumed件数
  - console件数
  - snapshot件数

- snapshots一覧（tick）
- replay状態（現在のtick、次イベントindex）

**操作**

- `Download Trace`
- `Load Trace`
- `Validate Trace`（replayしてhash一致確認、v1.0は簡易でOK）

---

## D-3. ブラウザ入力（キーボード）の扱い

- UIは `keydown` を捕捉し、ASCII相当（0..255）に変換できるものだけ送る（v1.0）
- UI→Worker: `inputKbd(byte,isDown)`
  - Worker→WASM: `deos_input_kbd(byte,isDown)`

- record中は WASM が `inputConsumed` イベントを出し、Workerがtraceの `events[]` に積む

---

# E. Worker内部仕様（実装の落とし穴を潰す）

## E-1. Workerの責務（固定）

- WASMインスタンス生成
- `.tbc` をWASMへロード
- 実行のバッチング（run loop）
- `deos_poll_event_json` を定期的に回収し、UIへ `event` として転送
- record中は trace builder として
  - `inputConsumed` を `events[]` に追加
  - `console` を `output[]` に追加（任意だが推奨）
  - tickが `snapshotEveryTicks` 増えたら `export_snapshot_json` して `snapshots[]` に追加

- replay中は traceの `events[]` を atCycle順に見て、必要分を `deos_schedule_kbd` で投入

## E-2. 実行バッチング規約

UIフリーズを防ぐ。Worker内でもメッセージ処理を返すため、無限に回さない。

- `run` は内部で `maxBatchInstructions`（例: 50_000）ごとに区切り、区切りごとに
  - `poll_event_json` を空になるまで回収
  - `postMessage` でUIへ送る（まとめて）
  - `if paused` なら停止

- `step` は `n` をそのまま `deos_step(n)` して、同様にイベント回収

---

# F. v1.0 の受入条件（E2E）

実装チームが「できた」を判定できる条件。

1. **EfxLang効果ハンドラ**

- 3ケース（再開なし / 再開あり / one-shotエラー）がブラウザで実行でき、コンソール結果が一致

2. **マルチタスク**

- 2タスクを作成し、timesliceで切り替わる（TimelineにtaskSwitchが出る）

3. **record/replay**

- recordでtraceを生成し、保存→load→replayで同じconsole出力になる

4. **reverse-to-tick**

- tick=Kへreverseし、同tickまでrunしてconsole出力が一致する

5. **policy差し替え**

- デフォルトとpolicy有りで、taskSwitch順が変わる（policyPickが出る）

---

# G. 実装上の強制事項（守らないと壊れる）

- UIはWASMに直接触らず、必ずWorker経由
- WorkerはWASMのイベントを「順序を変えずに」UIへ流す（変換禁止）
- policy実行時は **SYS禁止・PERFORM禁止**（v1.0固定）
- `cycle` はイベント/traceでは **文字列**で扱う（Numberの丸め事故回避）
- `poll_event_json` は「空になるまで」回収する（取りこぼすとUIとtraceがズレる）
