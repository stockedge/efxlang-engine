# EfxLang Engine / DEOS Browser v1.0（プロトタイプ）

`product_spec.md` の **UI ↔ Worker API** を実装し、ブラウザ上で EfxLang を **compile → load → run/step/pause** できる最小プロトタイプです。
EfxLang のエンジン（TypeScript 実装と WASM shim）とブラウザ UI、CLI を含みます。

ブラウザでは AssemblyScript の WASM shim（`wasm/` → `web/public/deos_engine.wasm`）を優先して使い、ロードに失敗した場合は TypeScript 実装にフォールバックします。

## 起動

```bash
npm i
npm run dev:browser
```

## ビルド / プレビュー

```bash
npm run build:wasm
npm run build:browser
npm run preview:browser
```

## 使い方（E2Eの流れ）

### 1) 効果ハンドラ（3ケース）

Program に貼り付けて `Compile & Load` → `Create Task` → `Run` で console を確認。

**再開なし**

```txt
print(handle { perform Foo(1); } with { Foo(x,k) => 42; });
```

**再開あり**

```txt
print(handle { 1 + perform Foo(0); } with { Foo(x,k) => k(10); });
```

**one-shot**

```txt
print(handle { perform Foo(0); } with { Foo(x,k) => k(1) + k(2); });
```

### 2) マルチタスク（timeslice）

1. Program を `progA` として `Compile & Load`（デフォルト例は `loop(65)` で `'A'` を出力）
2. `loop(65)` を `loop(66)` にして、Module を `progB` に変えて `Compile & Load`
3. `Create Task` を2回（例: `tid=1 module=progA`、`tid=2 module=progB`）
4. `Run to tick` で `20` などを指定して実行

Timeline の `taskSwitch ... reason=timeslice` と console の `A/B` が交互に出ることを確認。

### 3) policy 差し替え

Scheduler Policy を `Compile & Load` → `Set Policy`。
Timeline に `policyPick` が出て、taskSwitch の順序が変わることを確認。

### 4) record/replay

1. `Record Start`
2. `Run to tick`
3. `Record Stop`
4. `Download Trace` で保存
5. 保存したファイルを `Load Trace`（右上のファイル選択）
6. `Replay Start` → `Run to tick`

console 出力が一致することを確認。

### 5) reverse-to-tick

Trace をロードした状態で `Reverse to tick` に `K` を入れて `Reverse`。
その後 `Run to tick` で同じ `K` まで進めて、console が一致することを確認。

## CLI（参考）

```bash
# compile
npm run deos -- compile hello.efx -o out.tbc

# run (image.json を実行)
npm run deos -- run image.json

# record / replay
npm run deos -- record image.json --trace trace.deos.json
npm run deos -- replay trace.deos.json
```

## テスト（参考）

```bash
npm test
npm run test:e2e
npm run test:e2e:headed
npx ts-node --transpile-only test/run_integration_tests.ts
```
