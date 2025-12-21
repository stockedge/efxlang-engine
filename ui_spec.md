# DEOS Browser UI プロダクト仕様 v1.0

**OOUI + モデルベースUI設計**

## 1. 設計方針

### 1.1 OOUI（Object-Oriented UI）の原則（このUIの軸）

- ユーザーが触る中心は **オブジェクト**（Sample / Run / Trace / Task / Policy / Event / Snapshot）
- アクション（Run / Replay / Reverse / Download）は「選択したオブジェクトに対する操作」として現れる
- 画面遷移は「別の場所へ行く」より「対象オブジェクトを切り替える（焦点移動）」を優先する

### 1.2 モデルベースUI設計（実装に落ちる形）

- **ドメインモデル**（下に定義）を唯一の正とし
- UIは **「タスク（ユーザーの目的）→ 表示（ビュー）→ 操作（コマンド）」** の写像として設計する
- UIコンポーネントは原則として「モデルの投影」で、モデルが変わるとUIも変わる

---

# 2. ドメインモデル（UIが扱うオブジェクト定義）

## 2.1 オブジェクト一覧（必須）

### Sample（サンプル）

- `id: string`
- `name: string`
- `purpose: string`（何が確認できるか）
- `programSources: { [moduleName: string]: string }`（EfxLangコード）
- `policySource?: string`（scheduler policy のEfxLangコード）
- `engineConfig: { cyclesPerTick, timesliceTicks }`
- `tasks: Array<{ tid, moduleName, entryFnIndex, domainId }>`
- `inputTape?: InputTape`（固定入力）
- `assertions: Assertion[]`（期待結果）

### SampleSuite（サンプル集）

- `id: string`
- `name: string`（例：“DEOS Standard Suite”）
- `samples: Sample[]`

### Run（実行結果の実体：最重要オブジェクト）

- `id: string`
- `sampleId: string`
- `status: "queued"|"running"|"passed"|"failed"|"error"`
- `mode: "run"|"record"|"replay"|"suite"`
- `startedAtCycle: string`
- `endedAtCycle?: string`
- `consoleText: string`（結合済み）
- `events: DeosUiEvent[]`（タイムライン用）
- `finalStateSummary: StateSummary`
- `artifacts: { traceJson?: string; snapshots?: number[] }`
- `result: { passCount, failCount, errors[] }`

### Trace（記録データ）

- `id: string`
- `name: string`
- `jsonText: string`
- `meta: { cyclesPerTick, timesliceTicks, snapshotEveryTicks }`

### Task（OSのタスク）

- `tid: number`
- `state: "RUNNABLE"|"BLOCKED"|"EXITED"`
- `domainId: number`
- `stats: { switches, syscalls, performs }`

### Policy（スケジューラ方針）

- `id: string`
- `name: string`
- `source: string`
- `sandbox: { maxStepsPerHook, allowSys: false, allowPerform: false }`

### TimelineEvent（イベント）

- これはWASMイベントJSON（後述）をそのまま採用

### Snapshot（巻き戻しポイント）

- `tick: number`
- `cycle: string`
- `reason: "interval"|"manual"|"suite"`

---

## 2.2 オブジェクト関係（UIに必要な関係）

- `SampleSuite 1 ──* Sample`
- `Sample 1 ──* Run`（同じサンプルを何度も実行する）
- `Run 1 ──0..1 Trace`
- `Run 1 ──* TimelineEvent`
- `Run 1 ──* Task`
- `Trace 1 ──* Snapshot`

---

# 3. ユーザータスクモデル（“ユーザーがしたいこと”）

v1.0で重要なタスクは5つに絞る（これ以上増やすとUIが濁る）。

1. **全サンプル一括検証する（Run All）**
2. **1つのサンプルを実行し、動き（タイムライン・タスク切替・perform）を理解する**
3. **記録（Record）→ 再生（Replay）→ 一致確認する**
4. **タイムトラベル（Reverse-to-tick）して原因箇所を直感的に追う**
5. **policyを切り替えて挙動差（インターリーブの変化）を見る**

---

# 4. 情報設計（画面＝“オブジェクトのビュー”）

## 4.1 ナビゲーション（OOUI）

画面遷移は最小にする。基本は「選択→詳細」。

- **Home（Lab Bench）**：SampleSuite（サンプル群）を俯瞰し、Run All を押す場所
- **Run Studio**：選択したRunを観察・操作する場所（タイムライン中心）
- **Library**：保存したTrace/Runを再利用する場所（v1.0では簡易でOK）

※遷移は3つだけ。ほとんどの操作は Run Studio で完結させる。

---

# 5. 画面仕様（グラフィカル＆直感的）

## 5.1 Home：Lab Bench（最重要）

「**ボタン1つで全サンプル実行**」をここに置く。

### レイアウト（概念）

```
┌─────────────────────────────────────────────────────────┐
│  [▶ Run All Samples]  (Quick / Full)   Progress: 7/10    │
│  Suite: DEOS Standard Suite   Last: PASS 9 / FAIL 1      │
├───────────────────────┬─────────────────────────────────┤
│ Sample Gallery (Cards)│ Selected Sample Preview          │
│  [card][card][card]   │  - Purpose                       │
│  [card][card][card]   │  - Expected Output               │
│  [card][card][card]   │  - Key events (icons)            │
│                       │  [Run This Sample] [Open Studio] │
└───────────────────────┴─────────────────────────────────┘
```

### グラフィカル要素（必須）

- **Run All ボタン**：巨大・単一主役（1クリックで検証）
- **Suite結果**：緑（PASS）/赤（FAIL）の“スコアボード”
- **Sample Card**：
  - タイトル
  - “何が見えるか”アイコン（🧠 effect / ⏱ tick / 🔁 replay / 🧵 task / 🎛 policy）
  - 直近結果バッジ（PASS/FAIL）
  - 小さなミニタイムライン（イベント密度を棒で表示）

### Homeのユーザー操作（イベント→コマンド）

- `[▶ Run All Samples]` → `runSampleSuite(mode="full")`
- Sample cardクリック → `selectSample(sampleId)`（UI状態）
- `[Run This Sample]` → `runSample(sampleId, mode="run")`
- `[Open Studio]` → `openRunStudio(lastRunId or newRunId)`

---

## 5.2 Run Studio（Runを観察する“計測器”）

ここは「OS/VM/言語が動いてる感」を出す場所。**グラフィカルが主役**。

### レイアウト（概念）

```
┌─────────────────────────────────────────────────────────┐
│ Run: #A-2025...  Status: RUNNING  tick: 12 cycle: 12345  │
│ [⏯ Play/Pause] [Step] [Run-to-tick] [Reverse-to-tick]     │
├─────────────────────────────────────────────────────────┤
│  Timeline Canvas (SVG/Canvas)                              │
│   - lanes: Task 1 / Task 2 / Idle                          │
│   - playhead                                                │
│   - snapshot flags                                          │
│   - event glyphs (perform, syscall, switch, input)          │
├───────────────────────┬─────────────────────────────────┤
│ Inspector (selected)  │ Console                           │
│  - Event details      │  streaming output                 │
│  - Task state         │  filter by tid                    │
│  - Stacks summary     │  clear/autoscroll                 │
└───────────────────────┴─────────────────────────────────┘
```

### Timeline Canvas（ここが“直感的”の核）

**必須表現**

- タスクごとに横レーン（tid=1,2,…, idle）
- 上に **playhead（現在位置）**
- tickごとに軽いグリッド
- イベントはアイコンで置く
  - taskSwitch：レーン間に矢印
  - perform：⚡（effect名をツールチップ）
  - contCall/Return：↩︎
  - inputConsumed：⌨
  - console：🖨（出力がある地点）

**必須インタラクション**

- クリック：イベント選択 → Inspectorがそのイベントを表示
- ドラッグ：playheadを移動（これ自体は「表示位置変更」）
- 右クリック or ボタン：`Reverse-to-tick`（実行状態をそこへ戻す）

> 重要：**ドラッグで即reverse**すると重いので、
> “ドラッグ＝視点移動” / “Reverseボタン＝状態移動” を分けるのが実用的。

---

## 5.3 Inspector（OOUIの“選択したオブジェクトの詳細”）

Inspectorは「選択されたオブジェクト」の投影。

### 選択対象ごとの表示

- **Event選択**：イベントJSONの整形表示＋関連tid＋effect名＋理由
- **Task選択**：state / runnable / blocked / exited、統計、直近のcallStack深さなど
- **Run選択**：assertion結果（PASS/FAIL詳細）、trace有無、再生可能か
- **Snapshot選択**：tick/cycle、そこへreverse可能

---

## 5.4 Console（結果が即見える場所）

- `print` は **改行付き**で出す（読みやすさ優先）
- `putc` は文字として出す（0..255をLatin-1で表示。不可視は `\xNN`）

### Consoleの機能

- tidフィルタ（All / tid=1 / tid=2 …）
- autoscroll
- copy
- clear

---

## 5.5 “One Button Run All” の体験設計（最重要）

Run Allは「実行」ではなく「**検証**」が目的。

### Run All の表示（Homeに常設）

- 進捗バー（sample数 / 実行中サンプル名）
- PASS/FAILカウンタ
- 失敗サンプルが出たら、そのカードが赤く点滅→クリックでRun Studioへ

### Run All の検証内容（v1.0固定）

各サンプルについて、**最低限これを自動でやる**：

1. compile → load → run（終了 or エラー）
2. assertion検証（出力/エラー/イベント条件）
3. （Fullモードのとき）record → replay で **出力一致**確認
4. （Fullモードのとき）reverse-to-tick（代表tick）→ run → **出力一致**確認

---

# 6. UIイベントとシステムイベント（モデルベースの“イベント表”）

## 6.1 UIイベント（ユーザー操作）

- `RUN_ALL_CLICK`
- `SAMPLE_RUN_CLICK(sampleId)`
- `OPEN_STUDIO(runId)`
- `PLAY_PAUSE_TOGGLE`
- `STEP_CLICK(n)`
- `RUN_TO_TICK(tick)`
- `REVERSE_TO_TICK(tick)`
- `POLICY_SELECT(policyId)`
- `INPUT_TAPE_EDIT(text)`
- `DOWNLOAD_TRACE_CLICK`
- `LOAD_TRACE(file)`

## 6.2 システムイベント（WASMイベント → UIに流れる）

（ここは前回定義したWASMイベントJSONをそのまま採用）

- `console`
- `tick`
- `taskSwitch`
- `perform`
- `contCall`
- `contReturn`
- `inputConsumed`
- `policyPick`
- `error`

---

# 7. 実装チーム向け：追加コマンド（Run Allを確実にする）

UI側で逐次操作してもできるが、**1ボタンの確実性**のため、Workerに“スイート実行”を持たせる。

## 7.1 UI→Worker：runSampleSuite（追加）

```ts
type CmdRunSampleSuite = {
  version: "1.0";
  type: "command";
  command: "runSampleSuite";
  requestId: string;
  payload: {
    mode: "quick" | "full";
    suiteId: string; // "deos-standard"
    stopOnFirstFail: boolean; // true推奨
  };
};
```

**応答（サマリ）**

```ts
type RespRunSampleSuite = {
  version: "1.0";
  type: "response";
  requestId: string;
  ok: true;
  payload: {
    suiteId: string;
    runs: Array<{
      sampleId: string;
      runId: string;
      status: "passed" | "failed" | "error";
    }>;
    passCount: number;
    failCount: number;
  };
};
```

---

# 8. 付属サンプル（実用性のある“意味のある”セット）

ここが弱いと「動くけど何の役に立つの？」になるので、**最初から“用途が分かる”サンプル**を同梱します。
（EfxLangが基本的に不変なので、**状態は効果（State effect）でモデル化**します。これが実用性の中心。）

> 以降のサンプルはすべて `print(x)` が改行付き出力である前提。
> 期待出力は “完全一致” を基本にし、必要に応じて “含む” でも可。

---

## Sample Suite: “DEOS Standard Suite”（推奨 8本）

### S1: Effect 基本（握りつぶし）

**目的**：perform→handle捕捉が動く
**プログラム**

```txt
print(handle { perform Foo(1); } with {
  Foo(x,k) => 42;
});
```

**期待**：`42\n`

---

### S2: Effect 再開（kで戻る）

**目的**：継続再開が正しい

```txt
print(handle { 1 + perform Foo(0); } with {
  Foo(x,k) => k(10);
});
```

**期待**：`11\n`

---

### S3: one-shot 継続エラー

**目的**：kの2回呼び出しが禁止されている

```txt
print(handle { perform Foo(0); } with {
  Foo(x,k) => k(1) + k(2);
});
```

**期待**：エラー `ContinuationAlreadyUsed`

---

### S4: State effect（実用：カウンタ）

**目的**：不変言語でも “状態” を効果で実装できる（実用性がある）

```txt
let withState = fun(s, thunk) =>
  handle thunk() with {
    return(r) => r;
    Get(x,k) => withState(s, fun() => k(s));
    Put(newS,k) => withState(newS, fun() => k(null));
  };

let inc = fun() => {
  let n = perform Get(null);
  perform Put(n + 1);
  n + 1
};

print(withState(0, fun() => {
  inc();
  inc();
  inc()
}));
```

**期待**：`3\n`
**重要イベント**：perform(Get), perform(Put) が複数回出る

---

### S5: Logger effect（実用：ログの分離）

**目的**：副作用（ログ出力）を効果として横断的に差し込める

```txt
let withLogger = fun(thunk) =>
  handle thunk() with {
    return(r) => r;
    Log(msg,k) => { print(msg); k(null) }
  };

print(withLogger(fun() => {
  perform Log("start");
  perform Log("middle");
  perform Log("end");
  123
}));
```

**期待**（完全一致）：
`start\nmiddle\nend\n123\n`

---

### S6: タスク（OS）協調：Ping-Pong

**目的**：複数タスク＋yieldで切替が見える
**タスクA**

```txt
{
  print("A1");
  yield();
  print("A2");
  yield();
  print("A3");
  exit(0)
}
```

**タスクB**

```txt
{
  print("B1");
  yield();
  print("B2");
  yield();
  print("B3");
  exit(0)
}
```

**期待**：タスク切替（taskSwitch）が複数回可視化される
**期待出力**はスケジューラ次第なので v1.0では「含む検証」にする：

- A1,A2,A3,B1,B2,B3 が全て出ていること
- 行数が6であること
  （順序完全一致は policy・timeslice に依存しやすいので固定しない方が堅い）

---

### S7: Policy 差し替えで“公平⇔飢餓”が見える

**目的**：policy plane が実際に挙動を変える（意味がある）

**タスクA**

```txt
let loop = fun(n) =>
  if (n == 0) { exit(0); 0 }
  else { print("A"); loop(n - 1) };

loop(5);
```

**タスクB**

```txt
let loop = fun(n) =>
  if (n == 0) { exit(0); 0 }
  else { print("B"); loop(n - 1) };

loop(5);
```

**policy（RoundRobin）**

```txt
// export: sched_pickIndex
let sched_pickIndex = fun(nowTick, currentTid, currentIndex, runnableCount, domainId) =>
  (currentIndex + 1) % runnableCount;
```

**policy（AlwaysFirst）**

```txt
let sched_pickIndex = fun(nowTick, currentTid, currentIndex, runnableCount, domainId) =>
  0;
```

**期待**：

- RoundRobin時：AとBが混ざる（timelineでtaskSwitchが多い）
- AlwaysFirst時：Aが先に終わり、その後B（timelineで片寄る）
- policyPickイベントが出る

---

### S8: Record/Replay（実用：入力テープの確実再現）

**目的**：入力→出力の完全再現（R/Rが“使える”と分かる）
**プログラム**

```txt
{
  let a = getc();
  putc(a);
  let b = getc();
  putc(b);
  let c = getc();
  putc(c);
  exit(0)
}
```

**入力テープ**：`abc`（kbd byte: 97,98,99）
**期待出力**：`abc`（完全一致）
**期待**：record→replayで同一になる（Run All “full”で確認）

---

# 9. 画面に載せる“直感性”の仕掛け（グラフィカル強化の具体）

ここが薄いとただのログ画面になる。最初から入れる。

## 9.1 “動作が見える”表現（最低限）

- **タイムライン**：タスクレーン＋イベントアイコン＋playhead
- **状態の信号機**：Runカードに PASS/FAIL だけでなく
  - 🧵 task切替が起きた
  - ⚡ perform が起きた
  - 🔁 replay一致
  - ⏪ reverse一致
    を小アイコンで点灯

## 9.2 “ワンクリック検証”の気持ちよさ

- Run All中はカードが次々に “実行中” アニメ（波紋/スキャン）
- 失敗したら、そのカードが赤で固定＆クリックでRun Studioにジャンプ（失敗点へ）

## 9.3 失敗時のUX（重要）

- エラーが出たRunは、Inspectorの最上段に
  - error code
  - 直前イベント
  - 該当tick
    を固定表示（再現性が武器なので「ここで壊れた」が即見える必要がある）

---

# 10. 実装者向け：UI最小要件（MVPの線引き）

「グラフィカル」を入れつつ、MVPで終わらせるための線引き。

**MVPに必須**

- Home（Run All + Sample cards + 結果）
- Run Studio（Timeline + Console + Inspector）
- 8サンプル同梱
- Run All full（record/replay + reverse確認）

**MVPで捨てる**

- 行番号ハイライト（ソースマップ）
- 高機能Traceライブラリ
- カスタムイベントフィルタの複雑化

---

# 11. 追加で必要なら（次の一手）

あなたが「より直感的」を本気で狙うなら、次に効くのはこれです。

- `.tbc` にソースマップ（ip→(file,line,col)）を埋め、Timelineクリックでエディタの該当行を光らせる
- Run Studioで「perform→どのhandlerに捕捉されたか」を矢印で表示する（理解が爆速になる）
