# texel-r3 定期再学習 — 実行レポート（**棄却**）

- 日付: 2026-07-17〜2026-07-18
- 前提: `prospect-texel-p3-2026-07-15.md` の P6（r2 再実行）章と同一パイプライン
- 現行既定重み: **r2 継続**（`zig/src/prospect.zig` の `PROSPECT_SCORE_DEFAULT` は変更なし）
- 判定: **r3 を棄却**（回帰ゲート p6-white-j6-collapse で FAIL、fit の学習利得は実質同点）

## 背景

r2 採用後の「定期再学習ループ」初回として、現行エンジン（prospect r2 + main 6b0e3c3）
自身の 416 局の自己対局を新棋譜（`commit-bench-2026-07-17T14-36-36-261Z.json`、
seed=20260717・r=0.02・両側 prospect/book なし）としてコーパスに追加し、r3 として
再学習した。パイプラインは runbook（`prospect-texel-p3-2026-07-15.md` の P6-b 節）と
同一・スクリプト無変更で実施した。

## 実行結果

### 1. コーパス増強

- 抽出（`scripts/prospect-corpus.ts`, 新棋譜のみ入力）: candidates 5,809 →
  **1,448 局面**（dup 3,152 / 即五opp 777 / vcf 428 / 即五stm 4）
- 既存 corpus (`prospect-corpus-labeled.jsonl` r2 時点 13,165 行) との key 重複除外:
  5 → **1,443 局面を Rapfi ラベリング対象**（ほぼ全て新規）
- Rapfi ラベリング（`scripts/rapfi/labelCorpus.ts`, timeout=100ms, procs=4,
  57.4 局面/秒）: 採用 **1,348** / evalUnseen 破棄 95 / evalCap 破棄 0 / エラー 0
- key ベース dedup マージ: **14,608 行 = 採用 13,785（r2 12,437 → +1,348）+ dropped 823**
- 追加分の ply 分布: `8-15: 609 / 16-25: 545 / 26-35: 209 / >35: 80`。
  **ply<8 の序盤帯追加はゼロ**（r2 で強度に寄与した ply4-7 帯の補強は今回なし）。
- 追加分 rapfiEval 統計: mean 106.7 / sd 618.2 / p5,p50,p95 = −906, 91, 1163
  （r2 corpus とほぼ同分布）

### 2. Texel 回帰（`scripts/prospect-texel.ts`, rapfi 教師, K=200, group 5-fold）

| 教師    | baseline（r2 焼き込み値）loss | fit train | fold 平均 val | 反復  |
| ------- | ----------------------------- | --------- | ------------- | ----- |
| rapfi   | 0.121149                      | 0.084074  | **0.084995**  | 4,570 |
| outcome | 0.267789                      | 0.194817  | 0.197903      | 3,046 |

- 比較: r2 の rapfi fold 平均 val = 0.085022 → r3 = 0.084995 = **実質同点**。
  baseline loss も 0.122227 → 0.121149 と微改善のみ。過学習なし、収束は上限未満。
- 結果 JSON: `bench-results/texel-fit-2026-07-17T16-42-05-204Z.json`

### 3. アンカリング（`scripts/prospect-anchor.ts`, min-support=100）

- **s = 3.525053**（legacy std=801.84 / raw_fit std=227.47。r2 s=3.619 からやや縮小）
- アンカー維持 6 セル顔ぶれ **r2 と不変**（FOUR_THREE_TURN, SOLO_F4_TURN,
  DOUBLE_FOUR_WHITE_WAIT/TURN, WIN_WAIT/TURN）+ 回帰 28。
- 分布: legacy std 801.84 / prospect final std 825.56（比 1.03、**アンカリング成功**）
- 勝ち級 TURN 単調性 PASS（WIN 9000 > D4W 4800 > SoloF4 4500 > FT 3000）
- 損失検証: baseline 0.121149 / raw fit 0.084074 / final(混成) 0.121183
  （+0.000034、**実質同点**）
- 結果 JSON: `bench-results/prospect-anchor-2026-07-17T16-42-30-217Z.json`

### 4. 焼き込み → Zig / TS / lint（試行時、r3 棄却により後刻 revert）

- `zig build && zig build test`: 緑（four_three vs solo_b4 の平均重み差テストコメントを
  (600+3000)/2 − (129+156)/2 = 1657.5 に更新、アサーション 1000 は維持でパス）
- `pnpm check-fix`: 緑（0 warnings / 0 errors）
- `pnpm test`: **全 1806 テスト緑**、ブック関連テストの赤化なし

### 5. 重み差分表（r2 → r3、全 17×2 = 34 セル）

**34 セル中 22 更新 / 12 据置**（アンカー 6 + 偶然一致 6: weak WAIT/TURN, solo_f2 WAIT,
solo_b4 WAIT/TURN, solo_f4 WAIT）。

| #   | Cat                            | r2 (WAIT, TURN) | r3 (WAIT, TURN) | Δ (W, T)       | 一言                               |
| --- | ------------------------------ | --------------- | --------------- | -------------- | ---------------------------------- |
| 0   | none                           | (−23, −55)      | (−27, −56)      | (−4, −1)       | 空点ペナルティ微強化               |
| 1   | weak                           | (−11, −8)       | (−11, −8)       | (0, 0)         | 偶然一致                           |
| 2   | solo_b2                        | (22, 26)        | (17, 21)        | (−5, −5)       | 眠り二の価値やや低下               |
| 3   | solo_f2                        | (20, 26)        | (20, 24)        | (0, −2)        | ほぼ据置                           |
| 4   | double_f2                      | (76, 106)       | (83, 111)       | (+7, +5)       | 微増                               |
| 5   | solo_b3                        | (78, 75)        | (73, 70)        | (−5, −5)       | 眠り三やや低下                     |
| 6   | b4_f2                          | (296, 392)      | (298, 403)      | (+2, +11)      | 微増                               |
| 7   | solo_f3                        | (106, 141)      | (101, 140)      | (−5, −1)       | 微減                               |
| 8   | f3_f2                          | (184, 254)      | (180, 256)      | (−4, +2)       | ほぼ据置                           |
| 9   | f3_b3                          | (164, 207)      | (166, 204)      | (+2, −3)       | 微差                               |
| 10  | solo_b4                        | (129, 156)      | (129, 156)      | (0, 0)         | 偶然一致                           |
| 11  | **double_three_black_risk**    | (13, −246)      | **(60, −202)**  | (**+47, +44**) | **黒三三禁手ペナルティが大幅緩和** |
| 12  | double_three_white             | (422, 545)      | (419, 581)      | (−3, +36)      | 白三三 TURN が強化                 |
| 13  | four_three (WAIT=fit / TURN=A) | (585, 3000)     | (600, 3000)     | (+15, 0)       | 微増                               |
| 14  | solo_f4 (WAIT=fit / TURN=A)    | (646, 4500)     | (646, 4500)     | (0, 0)         | 偶然一致                           |
| 15  | double_four_white (A)          | (2600, 4800)    | (2600, 4800)    | (0, 0)         | アンカー据置                       |
| 16  | win (A)                        | (5000, 9000)    | (5000, 9000)    | (0, 0)         | アンカー据置                       |

大きく動いたのは **#11 d3_black_risk（+47/+44）** と **#12 d3_white TURN（+36）** の
黒禁手×白の三三系。それ以外は ±10 以内の微差。

### 6. 回帰ゲート — **FAIL**

`scripts/regression-positions.ts` を r3 焼き込み後に実行:

```
--- p6-white-j6-collapse ---
  局面: H8 I9 I8 G8 H7 G6 I7（白番）
  選択手（hard生探索）: J6（10.4秒）
  → FAIL（相手にVCTあり: G7 J7 H6 H5 F8 I5 H10 H9 E7 F7 G9）

--- p7-black-i7-collapse ---
  選択手（ブック）: F5（0.0秒） → PASS
```

- **r3 では hard が J6（敗着）を再選択、黒の11手 VCT を許す**。r2 では H6 を選び PASS。
- 同一 WASM ビルド系で stash → r2 に戻して再走し、H6 で PASS することを確認済み
  （差は eval 由来と確定）。
- ボスの採用条件「J6 回帰 PASS」を満たさない。

## 判定と根拠

**棄却**（team-lead 確定: 選択肢1 = r3 棄却・r2 継続）。

- fit の学習利得は fold 平均 val loss 0.085022 → 0.084995 で **実質同点**。
  「r3 に切り替える強度上の理由がない」
- 一方で **既知の実害敗着（J6 はボス実戦で顕在化した局面、ブック未収録なので
  製品の hard が生探索でそのまま踏む）が復活**する。採用理由は存在せず、
  Elo ゲート（commit-bench）に進む価値もない。
- 副次的観察として、d3_black_risk のペナルティ緩和（−246→−202）と
  d3_white TURN の強化（545→581）が大きく、盤上局所の選好が反転しやすい
  盆地に移動している。J6 の H6 選好は r2 の ply4-7 帯 624 局面に依存する
  繊細な均衡で、その帯を触らずに全体重みを再フィットすると簡単に反転しうる。

## 教訓（次回再学習の設計に反映すべき）

1. **同一エンジン・同一設定の自己対局を追い足すだけでは学習信号が弱い**。
   r3 の追加 1,348 局面（rapfi ラベル）は fold val loss を 0.085022 → 0.084995 に
   しか動かせなかった（実質同点）。多様性のあるコーパス（下記 3-a）でないと
   再学習の意味が薄い。
2. **J6 の H6 固定は繊細な盆地に依存**。ply4-7 の 624 局面（r2 で追加）が支えて
   おり、その帯を触らない ply≥8 のみの追加でも局所選好が反転する。
   全体 loss の変動が小さくても盤上の CPU 選択は動く（r2 側でも観測済みの
   「同じ盆地内の別解」現象の逆方向発現）。
3. **次回再学習の条件案**（採用前チェック含む）:
   - (a) **ply4-7 の序盤帯を必ず含める**。r2 生成時と同様に序盤制限列挙 or
     多様な相手（Rapfi / 過去バージョン / 手動棋譜）との対局から抽出する。
     同一エンジン同士の自己対局だけでは序盤の探索範囲が狭まりやすい。
   - (b) **J6 級の回帰ゲート（`regression-positions.ts`）は採用前必須**。
     今回この 1 手で棄却判定に十分な情報が得られた（Elo ゲートより安価かつ
     確定的）。将来敗着が発掘されたら都度追加する。
   - (c) **検討: J6 局面自体をブックまたは regression 常設アンカーとして固定**。
     「eval 空間の繊細な盆地に依存」を続けるより、ブックで H6 を固定するか、
     少なくとも学習時に J6 局面の hard 選択手を強制テストする常設アンカー
     （scripts/regression-positions.ts が既にその役割）に据えるほうが構造的に安全。

## 現状の資産（保持）

- **コーパス（次回再学習の土台として残置）**:
  - `bench-results/prospect-corpus-labeled.jsonl`（**マージ後 14,608 行**、次回はこの
    r3 corpus を起点にさらに増強）
  - `bench-results/prospect-corpus-labeled.r2.jsonl`（r2 時点 13,165 行のバックアップ）
- **中間生成物・fit / anchor JSON**:
  - `bench-results/prospect-corpus-r3-delta.jsonl`（新棋譜からの生抽出 1,448）
  - `bench-results/prospect-corpus-r3-new.jsonl`（既存 dedup 済み 1,443）
  - `bench-results/prospect-corpus-r3-new-labeled.jsonl`（ラベル済 1,443）
  - `bench-results/texel-fit-2026-07-17T16-42-05-204Z.json`
  - `bench-results/prospect-anchor-2026-07-17T16-42-30-217Z.json`
  - `bench-results/r3-input/commit-bench-2026-07-17T14-36-36-261Z.json`（新棋譜隔離コピー）
- いずれも `bench-results/` は gitignore 対象。

## revert 検証結果（2026-07-18）

- `zig/src/prospect.zig` の r3 焼き込み差分を破棄（r2 焼き込み値に復帰）
- `zig build && zig build test`: 緑
- `pnpm test`: **全 1806 テスト緑**
- `regression-positions.ts`: **全 PASS**（p6-white-j6-collapse は hard=H6 で PASS 復帰、
  p7-black-i7-collapse はブック手 F5 で PASS）

以上、r3 は棄却・r2 継続で確定。次回再学習は上記「教訓 3」の (a) を満たすコーパス
更新から着手する。
