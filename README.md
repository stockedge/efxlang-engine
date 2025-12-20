# DEOS Browser v1.0（プロトタイプ）

`product_spec.md` の **UI ↔ Worker API** を実装し、ブラウザ上で EfxLang を **compile → load → run/step/pause** できる最小プロトタイプです。

※ まだ WASM 実装は無いので、Worker 内で TypeScript のエンジンを動かしつつ、`product_spec.md` の WASM exports を **同等のメソッド**として模倣しています（後でWASMに差し替えやすい構造）。

## 起動

```bash
npm i
npm run dev:browser
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

## テスト（参考）

```bash
npm test
npx ts-node --transpile-only test/run_integration_tests.ts
```
