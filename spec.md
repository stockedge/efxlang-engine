# DEOS 仕様書 v1.0

**Deterministic Effect OS + EfxLang（効果ハンドラ）**

## 0. ゴール（このプロジェクトで作るもの）

DEOSは「本物のOS」ではなく、**TypeScript上で動く決定的な仮想計算機**です。
その上で、**効果ハンドラ（handle/perform）を持つ小型言語 EfxLang** を **コンパイル→バイトコード→VM実行**し、さらに **OS的な機構（タスク、スケジューリング、syscall）** と **Record/Replay** と **policy（方針）差し替え**を提供します。

### 必達要件

1. **決定性**
   同じ初期状態＋同じ入力イベント列なら、必ず同じ出力と内部状態になる。

2. **Record/Replay**
   記録した実行を、後で完全に再生できる。スナップショットにより巻き戻し（reverse-to）できる。

3. **言語（EfxLang）**

- let（不変）、if/while、関数（クロージャ）、呼び出し
- **効果（perform）** と **ハンドラ（handle）**
- **継続 k は one-shot**（1回だけ呼べる）

4. **OS機構（Kernel）**

- 複数タスク（Task）
- タイムスライス（tick）で **SAFEPOINT** 境界にてプリエンプト
- syscall（print/yield/sleep/getc/putc/exit）
- **policy plane** でスケジューラ方針を差し替え可能（サンドボックス付き）

---

## 1. 用語（実装者向け）

- **cycle**: VM命令を1つ実行するたびに +1 される仮想時間（u64）
- **tick**: `tick = floor(cycle / CYCLES_PER_TICK)`（u64）
- **SAFEPOINT**: 割り込み/イベント注入/プリエンプトが起きてよい「安全点」。この命令でのみスケジュール切替する。
- **Task**: VMの独立実行単位。Fiber（VMスタックなど）＋入力/状態を持つ。
- **Effect / perform**: 計算を中断し、最も内側のhandleへ助けを求める操作
- **Handler / handle**: performを捕捉する枠。捕捉したら clause（節）を実行する
- **Continuation / k**: perform地点から再開する「再開ボタン」。v1.0では **one-shot（1回だけ）**
- **Record/Replay**: 入力イベント列＋スナップショットを保存し、後で同じ実行を再現する機能
- **Policy plane**: スケジューリング等の「方針」を差し替えできる仕組み（安全制限つき）

---

## 2. 決定性モデル（最重要・固定ルール）

### 2.1 仮想時間

- **VMは命令1つ実行するごとに必ず `cycle++`** する（例外なし）
- `tick = floor(cycle / CYCLES_PER_TICK)`
- `CYCLES_PER_TICK` は設定値（例: 10_000）で固定。**traceに保存**する。

### 2.2 外部入力はイベントとしてのみ注入

- 外部入力（キーボード等）は `InputEvent(atCycle, type, payload)` として扱う
- VM内部からホストの実時間は参照できない（禁止）

### 2.3 イベント注入タイミング

- **入力イベントの注入（可視化）は SAFEPOINT でのみ行う**
- SAFEPOINT実行時、`atCycle <= cycle` のイベントを **順番通り**に注入する

### 2.4 禁止事項（これを破ると決定性が壊れる）

- `Date.now()` / `performance.now()` / 実時間参照
- VMを `setTimeout` 等の非同期で進める（同期ループで回す）
- `Math.random()` 等の未固定乱数（必要なら seedをtraceに保存し、VM内の擬似乱数に限定）

---

## 3. EfxLang ソース言語仕様

### 3.1 字句（トークン）

- 識別子: `[A-Za-z_][A-Za-z0-9_]*`
- リテラル:
  - 数値: 10進（例 `123`, `3.14`） ※内部はJS Number
  - 真偽: `true`, `false`
  - null: `null`
  - 文字列: `"`…`"`（\n \t \ " をサポート）

- 予約語:
  - `let`, `fun`, `if`, `else`, `while`
  - `true`, `false`, `null`
  - `handle`, `with`, `perform`, `return`
  - 組み込み名（予約扱い）: `print`, `yield`, `sleep`, `getc`, `putc`, `exit`

- 記号:
  - `(` `)` `{` `}` `,` `;` `=>` `=`

- 演算子:
  - `+ - * / == < >`

### 3.2 文法（EBNF）

プログラムは文の列。`{...}` はブロック式で最後の式の値を返す。

```
program   := stmt* EOF

stmt      := 'let' IDENT '=' expr ';'
          |  expr ';'

expr      := block
          |  literal
          |  IDENT
          |  '(' expr ')'
          |  call
          |  funExpr
          |  ifExpr
          |  whileExpr
          |  performExpr
          |  handleExpr
          |  binary

call      := expr '(' args? ')'

funExpr   := 'fun' '(' params? ')' '=>' expr

ifExpr    := 'if' '(' expr ')' block 'else' block

whileExpr := 'while' '(' expr ')' block

performExpr := 'perform' IDENT '(' args? ')'

handleExpr  := 'handle' expr 'with' handler

block     := '{' stmt* expr? '}'

handler   := '{' handlerItem* '}'

handlerItem :=
          | 'return' '(' IDENT ')' '=>' expr ';'
          | IDENT '(' handlerParams? ')' '=>' expr ';'
            // handlerParams には必ず末尾に継続名 k を含める

handlerParams :=
    IDENT (',' IDENT)* ',' IDENT
    // 例: Foo(x,k) / Foo(a,b,k) など
    // 最後のIDENTが継続k名。先頭〜最後-1が perform 引数に対応。

params    := IDENT (',' IDENT)*
args      := expr (',' expr)*

binary    := expr binop expr
binop     := '+' | '-' | '*' | '/' | '==' | '<' | '>'
```

### 3.3 優先順位と結合性

- 最優先: 関数呼び出し `f(x)`
- 次: `* /`
- 次: `+ -`
- 次: `== < >`
- 全て左結合

### 3.4 ブロック `{...}` の意味

- `{ stmt* expr }` は最後の `expr` の値
- `{ stmt* }`（最後のexpr省略）は `null`
- `let` はブロック内スコープ。シャドウイング可。

### 3.5 真偽判定（if/whileの条件）

- `false` と `null` を偽
- それ以外（number, string, closure, cont）は真

---

## 4. 効果ハンドラの意味論（handle/perform/k）

### 4.1 handle の基本

`handle body with { ... }` を評価する。

- bodyが **通常の値 r を返した**場合:
  - handlerに `return(x)=>e` があれば、それを実行し結果が handle 全体の値
  - return節が無ければ handle全体の値は r（恒等）

- body内で `perform Op(args...)` が起きた場合:
  - **最も内側**の handle から順に、Op節を探す
  - 見つかったら、Op節 `Op(...,k)=>e` を実行する
    このとき **k は perform地点から再開する継続**（one-shot）として渡される

### 4.2 「節はハンドラの外側で動く」ルール（必須）

performを捕捉した節 `Op(...)=>...` の本体は **捕捉したhandleの外側**で評価される。
つまり節内でさらに `perform` が起きても、同じhandleでは捕捉されず外側へ伝播する。

→ VM実装では「perform時に handler境界まで巻き戻して、節を呼ぶ」ことで自然に成立する。

### 4.3 `k(v)`（one-shot継続）

- `k(v)` は perform地点から計算を再開し、perform式の評価結果を v にする
- 再開された計算は、最終的にその handle の完了地点まで走り、そこで停止し、`k(v)` が値を返す
- **同じkを2回呼ぶと実行時エラー**: `ContinuationAlreadyUsed`

---

## 5. 組み込み（syscall）仕様（ソース言語側）

以下の関数名は予約で、呼び出しはVM命令 `SYS` にコンパイルされる。シャドウイング禁止。

- `print(x)` → SYS_PRINT
- `yield()` → SYS_YIELD
- `sleep(ticks)` → SYS_SLEEP
- `getc()` → SYS_GETC
- `putc(c)` → SYS_PUTC
- `exit(code)` → SYS_EXIT

---

## 6. 実行時エラー（固定文字列）

VMはエラーを例外として投げてよいが、**種類名とメッセージを固定**する（テストが見る）。

- `UnhandledEffect: <name>`
- `ContinuationAlreadyUsed`
- `ContinuationArityError`
- `CallNonCallable`
- `ArityError: expected <n> got <m>`
- `TypeError: <op> expected number`
- `ImmutableBindingReassigned`（STOREが同slotに2回目の書き込みをした場合）
- `SyscallDenied`（policy内SYS禁止等）
- `PolicyStepLimitExceeded`
- `PolicyInvalidReturn`

---

## 7. コンパイラ仕様（lexer → parser → resolver → codegen）

### 7.1 AST（最低限の形）

実装は自由だが、以下が表現できること。

- Program(stmts[])
- Let(name, initExpr)
- ExprStmt(expr)
- Block(stmts[], tailExpr?)
- Literal, Var(name)
- Call(callee, args[])
- Fun(params[], bodyExpr)
- If(cond, thenBlock, elseBlock)
- While(cond, bodyBlock)
- Handle(bodyExpr, handlerDef)
- Perform(opName, args[])
- Binary(op, left, right)
- HandlerDef(returnClause?, opClauses[])
- OpClause(opName, params[], kName, bodyExpr)

### 7.2 Resolver（名前解決）

変数参照を `(depth, slot)` に落とす。

#### depthの意味

- depth=0: 現在の関数フレームのEnv
- depth=1: 1つ外側の関数フレームのEnv
- …（クロージャの親を辿る）

#### slotの意味

- そのEnv内のローカルスロット番号（0..locals-1）
- paramsは slot 0..arity-1 を使用
- `let` は次の空きslotを割り当て（ブロックスコープでシャドウイング可）
- v1.0は **slot再利用なし**（簡単さ優先）

#### 不変束縛の保証

- 同名 `let` はシャドウイングとして新slot
- 同一スコープ内で同名 `let` は禁止（実装簡単化のため推奨）
- 実行時は `STORE` が同slotに2回書こうとしたら `ImmutableBindingReassigned`

### 7.3 Codegen（式は「値をスタックに積む」）

- すべての式は評価結果を valueStack に push する
- stmt の `expr;` は exprを生成→最後に `POP`
- `let x = expr;` は expr生成→ `STORE(depth=0, slot)`（値を残す）→ stmtとしては最後に `POP`

### 7.4 SAFEPOINT挿入（必須）

コンパイラは次の位置に `SAFEPOINT` を挿入する：

- すべての関数の先頭
- whileループの先頭（毎イテレーション必ず踏む位置）
- （推奨）ブロック末尾の直前

---

## 8. バイトコード仕様（命令セット＋エンコーディング）

### 8.1 命令エンコード共通

- 1命令 = `[opcode:u8] + operands`
- u16/u32 は little-endian
- jump先は **関数code内の絶対byte offset（u32）**
- VMは **命令を1つ実行するごとに cycle++**（命令の種類に関係ない）

### 8.2 オペコード一覧（固定）

#### 基本

| opcode | 命令      | operands            | stack               |
| -----: | --------- | ------------------- | ------------------- |
|   0x01 | CONST     | u16 constIndex      | `→ v`               |
|   0x02 | POP       | -                   | `v →`               |
|   0x03 | DUP       | -                   | `v → v v`           |
|   0x04 | SWAP      | -                   | `a b → b a`         |
|   0x05 | LOAD      | u16 depth, u16 slot | `→ v`               |
|   0x06 | STORE     | u16 depth, u16 slot | `v → v`             |
|   0x07 | JMP       | u32 addr            | -                   |
|   0x08 | JMPF      | u32 addr            | `cond →`            |
|   0x09 | CLOSURE   | u16 fnIndex         | `→ closure`         |
|   0x0A | CALL      | u16 argc            | `callee arg… → ret` |
|   0x0B | RET       | -                   | `ret →`             |
|   0x0C | SYS       | u16 sysno           | `args… → ret`       |
|   0x0D | SAFEPOINT | -                   | -                   |
|   0x0E | HALT      | -                   | -                   |

#### 演算（numberのみ）

| opcode | 命令 | stack        |
| -----: | ---- | ------------ |
|   0x10 | ADD  | `a b → a+b`  |
|   0x11 | SUB  | `a b → a-b`  |
|   0x12 | MUL  | `a b → a*b`  |
|   0x13 | DIV  | `a b → a/b`  |
|   0x14 | EQ   | `a b → bool` |
|   0x15 | LT   | `a b → bool` |
|   0x16 | GT   | `a b → bool` |

#### 効果ハンドラ

| opcode | 命令         | operands                      |
| -----: | ------------ | ----------------------------- |
|   0x20 | PUSH_HANDLER | u16 handlerIndex, u32 donePc  |
|   0x21 | POP_HANDLER  | -                             |
|   0x22 | PERFORM      | u16 effectNameConst, u16 argc |
|   0x23 | HANDLE_DONE  | -                             |

---

## 9. .tbc（バイトコードファイル）フォーマット（完全定義）

v1.0は **バイナリ**で定義する（toolchainが生成し、VMが読み込む）。

### 9.1 エンディアン

- little-endian

### 9.2 ヘッダ

```
offset  size  field
0       4     magic = "EFX1" (0x45 0x46 0x58 0x31)
4       2     versionMajor = 1
6       2     versionMinor = 0
8       4     constCount (u32)
12      4     fnCount (u32)
16      4     exportCount (u32)
20      4     reserved (u32) = 0
```

### 9.3 定数プール（consts）

constCount個を順に並べる。各要素はタグ付き。

```
u8 tag
payload...
```

タグ:

- 0x00: null（payloadなし）
- 0x01: boolean（u8 0 or 1）
- 0x02: number（f64 IEEE-754 little-endian 8 bytes）
- 0x03: string（u32 byteLen + UTF-8 bytes）

### 9.4 関数テーブル（functions）

fnCount個を順に並べる。

各Fn:

```
u16 arity
u16 locals
u16 handlerCount
u16 reserved = 0
u32 codeSize
(handler defs...)
(code bytes[codeSize])
```

HandlerDef（handlerCount個）:

```
u16 returnFnIndexOrFFFF  // 0xFFFFならreturn節なし（恒等）
u16 clauseCount
repeat clauseCount:
  u16 effectNameConst
  u16 clauseFnIndex
```

### 9.5 Exportテーブル（exports）

exportCount個。

```
u16 nameConst
u16 globalSlot
```

### 9.6 制約

- `effectNameConst` と `nameConst` が指す const は必ず string でなければならない（違反はロード時エラー）
- エントリ関数は `fnIndex=0` とする（必須）

---

## 10. VM 仕様（データ構造と命令の意味）

### 10.1 Value型

```ts
type Value = number | boolean | string | null | Closure | Continuation;

interface Closure {
  tag: "Closure";
  fnIndex: number;
  env: Env; // 参照（IDではない）
}

interface Continuation {
  tag: "Cont";
  used: boolean; // one-shot
  snap: FiberSnapshot; // 復元用
}
```

### 10.2 Env（環境）

```ts
interface Env {
  parent?: Env;
  slots: Value[]; // length == locals
  written: boolean[]; // length == locals（STORE一回保証用）
}
```

- `written[slot]==true` のslotへSTOREしたら `ImmutableBindingReassigned`

### 10.3 Frame / Fiber

```ts
interface Frame {
  fnIndex: number;
  ip: number; // 次に読む byte index
  env: Env;
}

interface HandlerFrame {
  // clause lookupは配列で行う（Map禁止）
  clauses: Array<{ effectNameConst: number; clause: Closure }>;
  onReturn: Closure | null; // nullなら恒等（return節なし）

  baseCallDepth: number;
  baseValueHeight: number;

  doneFnIndex: number;
  donePc: number;
}

interface Fiber {
  valueStack: Value[];
  callStack: Frame[];
  handlerStack: HandlerFrame[];

  yielding: boolean;
  yieldFnIndex?: number;
  yieldPc?: number;

  parent?: Fiber;
}
```

### 10.4 FiberSnapshot（深コピー規則）

FiberSnapshotは **復元可能な純データ**。浅いコピー禁止。

```ts
interface FiberSnapshot {
  valueStack: Value[]; // 配列コピー（要素は参照でもOK）
  callStack: Frame[]; // Frame自体をコピー（ip共有禁止）
  handlerStack: HandlerFrame[]; // 配列コピー（HandlerFrameもコピー推奨）
  yieldFnIndex: number;
  yieldPc: number;
}
```

**重要**：Frame.ip を共有すると継続が壊れる。必ずコピーする。

---

## 11. 命令の実行仕様（核心部分だけ詳細）

### 11.1 共通：cycle++

- VMは命令をfetch→decode→executeする前後どちらでもよいが、**各命令につき必ずcycleを1増やす**。

### 11.2 LOAD/STORE

- LOAD(depth,slot): envをparent方向にdepth回辿り、slots[slot]をpush
- STORE(depth,slot): envを辿り、written[slot]がtrueならエラー。falseなら slots[slot]=v, written[slot]=true。スタック上のvは残す。

### 11.3 演算

ADD/SUB/MUL/DIV/EQ/LT/GT

- operandsを2つpop
- number以外なら `TypeError: <op> expected number`

### 11.4 CALL

- argc個の引数をpop（右から積まれているので、配列にして左順へ並べ替え）
- calleeをpop
- calleeがClosure:
  - args.lengthがfn.arityと一致しなければ `ArityError: expected n got m`
  - new Env(parent=closure.env, slots=locals分null, written=false)
  - slots[0..arity-1]にargsを入れてwritten=trueにしてよい（paramsは初期化済扱い）
  - callStackにFrame(fnIndex, ip=0, env) push

- calleeがContinuation:
  - argcは必ず1。違えば `ContinuationArityError`
  - usedなら `ContinuationAlreadyUsed`
  - used=true
  - 親fiber=現在fiber
  - 現在fiberを `cont.snap` から復元（callStack/valueStack/handlerStackを差し替え）
  - 復元fiber.yielding=true, yieldFnIndex/yieldPcをsnapから設定
  - 復元fiber.valueStack.push(arg0)
  - 復元fiber.parent=親fiber
  - 実行は復元fiberで継続

- それ以外: `CallNonCallable`

### 11.5 PUSH_HANDLER / POP_HANDLER（handleの設置と解除）

PUSH_HANDLER(handlerIndex, donePc):

- currentFn.handlers[handlerIndex] を読む
- onReturn:
  - returnFnIndexが0xFFFF → null（恒等）
  - それ以外 → Closure(fnIndex=returnFnIndex, env=currentEnv)

- clauses:
  - each clause → Closure(fnIndex=clauseFnIndex, env=currentEnv)
  - effectNameConstも一緒に保存

- HandlerFrameをpush:
  - baseCallDepth = callStack.length
  - baseValueHeight = valueStack.length
  - doneFnIndex = currentFrame.fnIndex
  - donePc = donePc

POP_HANDLER:

- handlerStack.pop()

### 11.6 handle の codegen形（必須パターン）

`handle body with handler` は必ず次の形にコンパイルする（donePcパッチあり）：

```
PUSH_HANDLER hIndex donePc_placeholder
  ... body ...       // bodyの結果 r が stack top
POP_HANDLER
  // return節があれば: return(r) を呼ぶ（handler外で動く）
  // 例:
  //   if return exists:
  //     CLOSURE returnFnIndex
  //     SWAP
  //     CALL 1
donePc:
HANDLE_DONE
```

### 11.7 PERFORM（実装順固定）

PERFORM(effectNameConst, argc):

1. argc個をpopして args配列（左順）
2. handlerStackを上から探索し、effectNameConst一致のclauseを持つ最初のHandlerFrame Hを探す
   - 無ければ `UnhandledEffect: <name>`

3. Continuation contを作る
   - cont.used=false
   - cont.snap = deepCopy(currentFiber)
     （Frame.ipは必ずコピー）
   - cont.snap.yieldFnIndex = H.doneFnIndex
   - cont.snap.yieldPc = H.donePc

4. unwind（巻き戻し）
   - callStack を H.baseCallDepth まで縮める
   - valueStack を H.baseValueHeight まで縮める
   - handlerStack を **Hより外側まで**縮める（Hを捨てる）

5. unwind後のトップFrameの ip を H.donePc にセット
6. clause closureを呼ぶ
   - 引数は `args...` の後に `cont` を最後に追加
   - `callClosure(clause, argsPlusCont)` をVM内部で直接呼んでよい

7. clauseが返す値が handle式の結果になり、donePcのHANDLE_DONEへ流れる

### 11.8 HANDLE_DONE（継続の戻り点）

- 通常はno-op
- ただし条件一致なら「親fiberへ戻る」：
  - fiber.yielding==true
  - currentFrame.fnIndex==fiber.yieldFnIndex
  - currentFrame.ip==fiber.yieldPc（= HANDLE_DONE位置）

- 戻り処理：
  1. result = valueStack.pop()
  2. parent = fiber.parent（必須）
  3. 現fiberを捨ててparentへ切替
  4. parent.valueStack.push(result)

---

## 12. Kernel（OS機構）仕様

### 12.1 Task

```ts
interface Task {
  tid: number;
  state: "RUNNABLE" | "BLOCKED" | "EXITED";
  wakeTick?: bigint; // BLOCKED解除tick
  fiber: Fiber;
  module: Module;
  cycle: bigint; // 共有のglobal cycleをKernelが持つならTaskは不要
  timesliceUsed: bigint; // tick単位の使用量
  domainId: number; // policy用（v1.0は0固定でも可）
  exitCode?: number;
}
```

実装上は `cycle` は **Kernelが単一で持つ**（推奨）。VM命令実行のたびにKernel.cycle++。

### 12.2 実行ループ（Kernel主導）

- Kernelは「現在タスク」を持つ
- 1ステップ: 現タスクのVMで **1命令**実行
- 命令が `SAFEPOINT` の場合、Kernelが `onSafepoint()` を呼ぶ

### 12.3 onSafepoint()（この順で固定）

1. 入力イベント注入（atCycle<=cycle）
2. BLOCKED解除
   - `task.state==BLOCKED && task.wakeTick<=tick` → RUNNABLE

3. timeslice判定
   - tickが進んだことを検出したら `timesliceUsed++`
   - `timesliceUsed >= TIMESLICE_TICKS` なら切替要求

4. 切替要求があればスケジュール
   - runnable tasksをtid昇順で並べる
   - policyがあれば policyを呼んで indexを得る
   - 次タスクへ切替し `timesliceUsed=0`

### 12.4 syscall（SYS命令）仕様

SYS命令実行時、VMはKernelに `handleSyscall(task, sysno)` を委譲する。
引数/戻り値はvalueStack経由（定義固定）。

#### sysno一覧（v1.0固定）

| sysno | 名称      | 引数（pop順） | push戻り | 動作                               |
| ----: | --------- | ------------- | -------- | ---------------------------------- |
|     1 | SYS_PUTC  | c             | null     | 0..255を1byte出力                  |
|     2 | SYS_GETC  | -             | number   | 入力1件。無ければ -1               |
|     3 | SYS_YIELD | -             | null     | 次のSAFEPOINTで切替要求            |
|     4 | SYS_SLEEP | ticks         | null     | taskをBLOCKED、wakeTick=tick+ticks |
|     5 | SYS_EXIT  | code          | null     | taskをEXITED                       |
|     7 | SYS_PRINT | v             | null     | 値を決定的に文字列化して出力       |

**SYS_PRINTの文字列化（決定的）**

- null → `"null"`
- boolean → `"true"`/`"false"`
- number → `Number.isNaN(x)`なら `"NaN"`、`Object.is(x,-0)`なら `"-0"`、それ以外は `String(x)`
- string → そのまま
- closure → `"<closure fn#<fnIndex>>"`
- cont → `"<cont used=<true|false>>"`

### 12.5 入力（キーボード）

- Kernelは `kbdQueue:number[]` を持つ
- 入力イベント `KBD(byte)` が注入されたら enqueue
- SYS_GETC:
  - queue先頭を返してdequeue
  - 空なら -1

入力源はNodeのstdinでよい（record中はイベントとしてログ化）。

---

## 13. Policy plane（スケジューラ方針差し替え）

### 13.1 目的

スケジューラの「方針」だけを差し替える。policyはEfxLangモジュールとしてロードする。

### 13.2 policyモジュールのexport

policyモジュール（.tbc）は exports に次の名前を出す（無ければデフォルト）：

- 必須（推奨）: `sched_pickIndex`
  - 署名: `sched_pickIndex(nowTick, currentTid, currentIndex, runnableCount, domainId) => number`

任意:

- `sched_onRunnable(tid, reason, nowTick, domainId) => null`
- `sched_onTimesliceEnd(tid, ranTicks, nowTick, domainId) => null`

exportsは `.tbc` の export table で提供され、Kernelは `globalSlot` からClosureを取り出して呼ぶ。

### 13.3 policyの安全制限（サンドボックス）

policy呼び出しは必ず以下を守る：

- `maxStepsPerHook`（例: 50_000命令）
- policy実行中に `SYS` を実行したら `SyscallDenied`
- policy実行中に `PERFORM` を実行したら拒否（Unhandled扱いではなく即エラーでフォールバック）
  - 実装: policyロード時に全codeを走査し、SYS/PERFORM opcodeがあればロード拒否（推奨）

- エラー時はフォールバック
  - pickIndex失敗 → 0
  - 返り値がnumberでない/範囲外 → `PolicyInvalidReturn` → 0

---

## 14. Record/Replay 仕様（trace + snapshot）

### 14.1 概要

- record時: 入力イベントを `atCycle` 付きで保存し、定期スナップショットを保存
- replay時: traceに従い同じcycleで同じイベントを注入し、同じ結果になることを検証

### 14.2 traceファイル形式（JSON、v1.0固定）

ファイル拡張子: `.deos.json`

```json
{
  "version": "1.0",
  "config": {
    "cyclesPerTick": 10000,
    "timesliceTicks": 1,
    "snapshotEveryTicks": 100
  },
  "modules": [
    { "name": "progA", "tbcBase64": "..." },
    { "name": "progB", "tbcBase64": "..." },
    { "name": "sched", "tbcBase64": "..." }
  ],
  "image": {
    "tasks": [
      { "tid": 1, "module": "progA", "domainId": 0 },
      { "tid": 2, "module": "progB", "domainId": 0 }
    ],
    "policy": { "schedulerModule": "sched" }
  },
  "initialSnapshot": { ...Snapshot... },
  "events": [
    { "atCycle": 12345, "type": "KBD", "byte": 97 }
  ],
  "snapshots": [
    { "tick": 0, "snapshot": { ...Snapshot... } },
    { "tick": 100, "snapshot": { ...Snapshot... } }
  ],
  "output": [
    { "atCycle": 200, "text": "hello\n" }
  ],
  "stateHashes": [
    { "tick": 0, "fnv1a64": "0x..." }
  ]
}
```

### 14.3 入力イベントの記録ルール（決定性の要）

- record中、ホストの入力（stdin）はそのままVMへ入れない
- Kernelはホスト入力を `pendingHostInput` に溜める
- SAFEPOINTで `pendingHostInput` を順番に取り出し、
  - `atCycle = current cycle` として `events` に追記し
  - 同時に `KBD` としてVMへ注入する

replay中はホスト入力は無視し、eventsのみで注入する。

### 14.4 Snapshot（完全復元に必要な状態）

Snapshotは「実行をその時点から完全に再開できる」状態を含む。
ここが曖昧だとreplayが壊れるので、**以下を必須**とする。

#### Snapshot JSON（v1.0）

```json
{
  "cycle": 123456,
  "tick": 12,
  "kernel": {
    "currentTid": 1,
    "kbdQueue": [97,98]
  },
  "tasks": [
    {
      "tid": 1,
      "state": "RUNNABLE",
      "wakeTick": null,
      "domainId": 0,
      "timesliceUsed": 0,
      "module": "progA",
      "fiberGraph": { ...FiberGraph... }
    }
  ],
  "objectGraph": { ...ObjectGraph... }
}
```

#### 重要：objectGraph方式（循環参照を扱う）

継続やEnvは循環参照を作り得るため、Snapshotは **グラフをIDで表現**する。

- `ObjectGraph` は Env と Continuation をID化して持つ
- Fiber/ValueはそれらのID参照を使う

##### ObjectGraph

```json
{
  "envs": [
    { "id": 1, "parent": null, "slots": [ ...EncodedValue... ], "written": [true,false,...] }
  ],
  "conts": [
    { "id": 1, "used": false, "snap": { ...FiberSnapshotEncoded... } }
  ]
}
```

##### EncodedValue

```json
{ "t": "null" }
{ "t": "bool", "v": true }
{ "t": "num",  "v": 3.14 }
{ "t": "str",  "v": "hi" }
{ "t": "closure", "fnIndex": 2, "envId": 1 }
{ "t": "cont", "contId": 1 }
```

##### FiberGraph（親fiberを含む）

```json
{
  "currentFiberId": 1,
  "fibers": [
    {
      "fiberId": 1,
      "parentFiberId": null,
      "yielding": false,
      "yieldFnIndex": null,
      "yieldPc": null,
      "valueStack": [ ...EncodedValue... ],
      "callStack": [
        { "fnIndex": 0, "ip": 10, "envId": 1 }
      ],
      "handlerStack": [
        {
          "baseCallDepth": 1,
          "baseValueHeight": 0,
          "doneFnIndex": 0,
          "donePc": 100,
          "onReturn": { "fnIndex": 5, "envId": 1 } ,
          "clauses": [
            { "effectNameConst": 12, "clauseFnIndex": 6, "clauseEnvId": 1 }
          ]
        }
      ]
    }
  ]
}
```

> `onReturn` は nullも可。closure表現は `{fnIndex, envId}`。

### 14.5 SnapshotのID割り当て（決定的であること）

recordとreplayで同じhashを得るため、Snapshot生成時のID割当は決定的でなければならない。

**ID割当の規則（必須）**

- Taskは tid昇順
- Fiberは「current → parent → parent…」の順に列挙し、fiberIdを 1,2,3… と振る
- Env/ContのIDは、以下の探索で **最初に出会った順**に 1,2,3… を振る
  探索順:
  1. Fiber.valueStack（底→上）
  2. Fiber.callStack（古→新）の各frame.env
  3. Fiber.handlerStack（下→上）の closure env
  4. Envは parent を先に、次に slots[0..] を順に探索
  5. Continuationは cont.snap 内の FiberSnapshotEncoded を同じ規則で探索

- Map/Setは禁止（順序が実装依存になりやすい）。配列のみ。

### 14.6 stateHash（ズレ検出）

- tickごと（またはsnapshot tick）に stateHash を計算できる
- hashは **FNV-1a 64-bit** とする
  - offset basis: `14695981039346656037`
  - prime: `1099511628211`
  - 1byteずつ `hash ^= b; hash = (hash * prime) mod 2^64`

- 入力バイト列は「Snapshotを上の決定的ID割当で正規化し、独自バイナリエンコードしたもの」

エンコード（例）:

- u8/u16/u32/u64をlittle-endian
- 配列は u32 length + elements
- 文字列は u32 byteLen + UTF-8 bytes
- EncodedValueは `tag:u8 + payload`

### 14.7 replay

- initialSnapshotを復元
- cycleを進め、SAFEPOINTで events を `atCycle<=cycle` の順に注入
- outputログがあれば照合（任意だが推奨）
- stateHashesがあれば照合（推奨）

### 14.8 reverse-to（巻き戻し）

- targetTick 以前で最大のsnapshotをロード
- そこから replay で targetTick まで進める
- 逆命令実行は不要（v1.0では採用しない）

---

## 15. 起動イメージ（image.json）仕様（trace無し実行用）

拡張子: `.image.json`

```json
{
  "config": {
    "cyclesPerTick": 10000,
    "timesliceTicks": 1,
    "snapshotEveryTicks": 100
  },
  "modules": [
    { "name": "progA", "path": "dist/progA.tbc" },
    { "name": "progB", "path": "dist/progB.tbc" },
    { "name": "sched", "path": "dist/sched.tbc" }
  ],
  "tasks": [
    { "tid": 1, "module": "progA", "domainId": 0 },
    { "tid": 2, "module": "progB", "domainId": 0 }
  ],
  "policy": { "schedulerModule": "sched" }
}
```

---

## 16. CLI 仕様

最低限これを実装する。

- `deos compile <src.efx> -o out.tbc`
- `deos run --image sys.image.json`
- `deos record --image sys.image.json -o run.deos.json`
- `deos replay run.deos.json`
- `deos replay run.deos.json --until-tick N`
- `deos replay run.deos.json --reverse-to-tick N`
- `deos inspect run.deos.json --events`
- `deos diff runA.deos.json runB.deos.json`（stateHash比較）

---

## 17. 受入テスト（必須）

### 17.1 効果ハンドラ

1. 再開しない

```txt
print(handle { perform Foo(1); } with { Foo(x,k) => 42; });
```

期待: `42`

2. 再開する

```txt
print(handle { 1 + perform Foo(0); } with { Foo(x,k) => k(10); });
```

期待: `11`

3. one-shot

```txt
print(handle { perform Foo(0); } with { Foo(x,k) => k(1) + k(2); });
```

期待: `ContinuationAlreadyUsed`

4. ネスト優先

```txt
print(handle {
  handle { perform Foo(0); } with { Foo(x,k) => 1; };
} with { Foo(x,k) => 2; });
```

期待: `1`

5. return節

```txt
print(handle { 10; } with { return(r) => r + 1; });
```

期待: `11`

### 17.2 決定性/RecordReplay

- 同一imageで2回run → 出力一致 & stateHash一致
- record→replay → 出力一致 & stateHash一致
- reverse-to-tickで戻して同tickまで再生 → stateHash一致

### 17.3 policy

- policy無し（デフォルト）と policy有りでタスク実行順が変わる
- 両方で record/replay が成立

---

## 18. 推奨ディレクトリ構成

```
src/
  lang/
    token.ts lexer.ts ast.ts parser.ts resolver.ts
  bytecode/
    opcode.ts module.ts emitter.ts tbc_encode.ts tbc_decode.ts disasm.ts
  vm/
    value.ts env.ts fiber.ts vm.ts errors.ts
  kernel/
    kernel.ts syscalls.ts scheduler.ts policy.ts input.ts console.ts
  trace/
    trace.ts snapshot.ts graph.ts hash.ts record.ts replay.ts
  cli/
    main.ts commands/*.ts image.ts
test/
  effects.test.ts
  determinism.test.ts
  record_replay.test.ts
  policy.test.ts
```

---

## 19. 実装順序（詰まらない順）

1. Lexer/Parser/Resolver（効果なし）
2. VM（CONST/演算/if/while/fun/call/let）
3. handle/perform（PUSH_HANDLER/PERFORM/HANDLE_DONE/cont CALL）
4. SAFEPOINT + cycle/tick（決定性の骨格）
5. SYS（print/getc/putc/yield/sleep/exit）
6. Kernel（2タスクで交互に動かす）
7. trace（record/replay + snapshot + hash）
8. policy plane（scheduler差し替え + サンドボックス）

---

## 20. 実装者への注意（ここを雑にすると壊れる）

- **Continuation snapshotで Frame.ip を共有した時点で破綻**（継続が“戻る場所”を失う）
- **PERFORMのunwindは callStack/valueStack/handlerStack の3つ全部**を揃えて巻き戻すこと
  1つでも残すと「節がハンドラ内側で動く」バグになる
- **循環参照を前提にsnapshotを設計**しないと、継続を外に返した瞬間に保存不能になる
- Map/Setは禁止（順序がズレると決定性とhashが壊れる）
