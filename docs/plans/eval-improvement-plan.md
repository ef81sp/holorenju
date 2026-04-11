# 評価関数改善プラン v3（棋譜分析＋全レビュー反映）

## Context

連珠CPU（Zig/WASM）の「組み方が弱い」問題を改善する。Phase 0-6（ビットボード化）で NPS 約3倍を達成済み。次は評価関数の改善で「中盤の安定性と方向性」を狙う。

### 棋譜分析の結果（16局, 240探索手）

`bench-results/quick-kifu-2026-04-10T10-40-39-752Z.json` から:

| 観点           | 値                   |
| -------------- | -------------------- |
| 平均評価値振動 | **627/手**           |
| 時間切れ率     | **9.2%**             |
| 最大揺れ       | **11530**（ゲーム3） |

#### 重要な観察

- VCF/VCT 部分は強い（全16局が VCF/VCT で終局）
- 早期に VCT 発動するゲームは安定（ゲーム11: 平均揺れ139）
- 中盤で VCT 発動しないと不安定（ゲーム4: 揺れ +16〜+2160 を反復）

#### 解釈の留保（イシューレビュワー指摘）

「揺れ = 方向性欠如」の断定は因果飛躍。揺れは以下の混合の可能性:

- (a) 静的評価のノイズ
- (b) horizon effect / PV 切替
- (c) depth 不足（時間切れ）

**Phase 0（後述）で振動分解を実施し、静的評価ノイズが支配的なことを確認してから本実装に進む。**

### 過去の試行と教訓

| 試行                              | 結果           | 学び                               |
| --------------------------------- | -------------- | ---------------------------------- |
| `LEAF_COMPOUND_THREAT_BONUS=1500` | 効果なし       | 既に四三が成立した局面しか拾えない |
| `THREE 30→150` チューニング       | 効果検出できず | depth 4 ではノイズの中             |

---

## 改善方針

棋譜分析と過去レビューから候補を絞った結果:

| 候補                       | 採否                 | 理由                                   |
| -------------------------- | -------------------- | -------------------------------------- |
| A. 交点共有ボーナス        | 却下                 | 局所的、揺れ問題に対処しない           |
| B. ライン単位ポテンシャル  | **採用**             | 「素材の蓄積」を直接評価、安定性に寄与 |
| C. パラメータチューニング  | 補助                 | 過去に効果なしだが Phase B 後に再検証  |
| D. 影響圏（influence map） | **条件付き採用**     | Phase B の結果次第で go/no-go          |
| F. QSearch 拡張            | **本プランから除外** | 探索改善カテゴリ。別プラン化           |

---

## Phase 0: 振動分解（事前検証, 30分〜1時間）

### 目的

棋譜分析で観測した「評価値振動 627/手」が以下のどれに由来するかを切り分ける:

- (a) 静的評価のノイズ → Phase B/D で対処可能
- (b) horizon effect / depth 不足 → Phase B/D は効きにくい

### 手順

1. **対照群を含む複数ゲーム**を抽出:
   - ゲーム4（雲月, 不安定, 揺れ平均893）の中盤局面
   - ゲーム3（恒星, 最大揺れ11530）の中盤局面
   - ゲーム11（彗星, 安定, 揺れ平均139）の中盤局面
2. 各局面で:
   - 静的評価値（`evaluateBoardOnCells` を depth 探索なしで直接呼ぶ）を取得
   - depth=5/6/7 で固定して探索後評価値を取得
3. **振動の定義**: 同じプレイヤーの連続手の評価値の差分の絶対値平均（mean abs diff）
4. (a) 静的評価値の振動 vs (b) 探索後評価値の振動を比較
5. **判断**: 静的振動 > 探索振動 × 0.5 なら Phase B/D に進む価値あり
   - 0.5 は便宜的な初期値。結果を見て判断する
   - 0.3 / 0.5 / 0.7 のどこでも結論が変わらないなら確信度高
6. **副次指標**: Phase B 完了後にも同じスクリプトを流し、実際に振動が下がったか確認（Phase B の効果検証として）

### 実装

`scripts/eval-vibration-bench.ts` を新規作成（小スクリプト）。`profile-bench.ts` の構造を流用。

### 結果の解釈

- **静的振動が大きい** → Phase B/D を実施する強い根拠
- **静的振動が小さい** → Phase B/D の効果は限定的かもしれないが、理論的に妥当なら実施はする（撤退ではなく期待値の修正）
- depth 不足が支配的 → 別途「探索改善プラン」を検討する必要あり（本プランの範囲外）

---

## Phase B: ライン単位ポテンシャル評価

### アイデア

各ライン（行・列・斜め）の 5-cell スライド窓で「相手なし窓内の自色石数」を集計。素材の蓄積を直接評価。

### 設計（incremental 化前提 — パフォーマンスレビュワー指摘反映）

新ファイル `zig/src/line_potential.zig`:

```zig
/// 各ラインのポテンシャル値（相手石なし窓の自色石数表）
fn computeLinePotential(line_bits: u16, opp_bits: u16, line_len: u4) i32 {
    var total: i32 = 0;
    if (line_len < 5) return 0;
    const window_count: u8 = line_len - 4;
    for (0..window_count) |start| {
        const mask: u16 = @as(u16, 0x1F) << @intCast(start);
        if ((opp_bits & mask) != 0) continue;
        const own_in = @popCount(line_bits & mask);
        total += scores.LINE_POTENTIAL_TABLE[own_in];
    }
    return total;
}

/// 全ライン集計（初期化用、O(72 lines × 6 windows)）
pub fn computeTotal(perspective: Cell) i32 { ... }
```

### incremental 化（IncrementalEvalState 統合）

`zig/src/incremental_eval.zig` の `IncrementalEvalState` に追加:

```zig
pub const IncrementalEvalState = struct {
    // ... 既存 ...
    line_potential_black: i32 = 0,
    line_potential_white: i32 = 0,
};
```

`placeStone(row, col, color)` / `removeStone(...)` で:

- 影響を受ける 4 ライン（`bitboard.CELL_LINES[idx][0..4]`）のみ差分更新
- 各ラインで computeLinePotential を再計算し、差分を total に反映
- コスト: **4 lines × ~6 windows × ~5 ns = 120 ns/手**

`getEvaluation` では集計値をそのまま返す（O(1)）。

### POTENTIAL_TABLE の置き場所と値（SOLID + パフォーマンス指摘反映）

`zig/src/scores.zig` に追加（魔法定数の単一情報源を維持）。**既存のフラット定数とは別セクションに分離**:

```zig
// --- Potential tables ---
//
// 各テーブルは sentinel `[5+]=0` を含む。配列外参照を防ぐため
// 呼び出し側で `popcount` の上限を 5 に clamp する。

/// ライン素材の達成可能性スコア [0,1,2,3,4,5+ 個]
pub const LINE_POTENTIAL_TABLE = [_]i32{ 0, 3, 12, 40, 60, 0 };
//                                       ^   ^   ^   ^   ^
//                                       0   1   2   3   4 個
//   [4]=60: 活三スコア(1000)/活四(1500)と十分差をつけ重複評価を避ける
//   [3]=40: 活二(50)と同程度。素材2個での発展可能性を表現
//   [5+]=0: 5個以上は既存パターンが拾うので0
```

### 既存評価との関係（テンポ補正・ペナルティとの相互作用 — SOLID 指摘反映）

`evaluateBoardOnCells` への統合:

- ポテンシャルスコアは **テンポ補正・単発四ペナルティの対象外**（純粋加算）
- 集計順: パターンスコア集計 → テンポ補正 → 四三脅威スキャン → ミセ → ペナルティ → **ポテンシャル加算**

```zig
const my_potential = inc.getLinePotential(perspective);
const opp_potential = inc.getLinePotential(perspective.opposite());
return (my_score - opp_score) + (my_potential - opp_potential);
```

**API スタイルの確認**: `incremental_eval.zig` の既存 getter（`getEvaluation` 等）が perspective 引数スタイルか、black/white 個別 getter スタイルかを Phase B 着手時に確認し、既存スタイルに揃える。

### VERIFY_INCREMENTAL 整合性

`incremental_eval.zig` の Debug モードで `getEvaluation` と `evaluate.evaluateBoardOnCells` の結果を比較するアサートがある。Phase B 実装時:

- `evaluate.evaluateBoardOnCells`（非 incremental パス）にも `line_potential.computeTotal` を呼んで加算
- これにより VERIFY_INCREMENTAL が通る
- Debug モードの遅延は許容（Release では incremental 経路のみ使われる）

### 対称性テスト

`incremental_eval` の既存テスト `"removeStone restores evaluation"` に **line_potential 検証**を追加:

- `placeStone` → `removeStone` で `line_potential_black/white` が元の値に正確に戻ることを assert
- 複数回の make/unmake で累積誤差が出ないことを確認

### コスト見積もり

| 操作                                  | コスト                                                              |
| ------------------------------------- | ------------------------------------------------------------------- |
| 初期化 (`computeTotal`)               | 72 lines × 平均 8 windows × 5 ns = ~3 µs（探索開始時1回）           |
| 差分更新 (`placeStone`/`removeStone`) | 4 lines × 平均 8 windows × 5 ns = **~160 ns/手**（最大 ~200 ns/手） |
| `getEvaluation` 経由のリーフ評価      | **+1〜3 ns**（i32 × 2 の読み出しと減算）                            |

**NPS 影響: ほぼゼロ（< -1%）**。incremental 化の真価。
make/unmake で 2 倍計上される点に注意（αβ 探索のため）。

### Phase B 撤退基準

**理論的に妥当な変更は、ベンチで Elo が出ないだけでは revert しない**。
明らかな破壊が観測された場合のみ revert する。

revert する条件:

- `zig build test` または `pnpm check-fix` でテスト失敗
- NPS が 5% 以上落ちる（incremental 化が機能していない）
- Stage 1（2セット）で **Elo -30 以下**（明らかに弱くなっている）
- 棋譜を見て CPU が明らかに悪手を選ぶ

revert しない条件（残す）:

- Stage 1 で -30 〜 0 Elo（ノイズ範囲、理論的に妥当なら残す）
- Stage 2 で CI が 0 をまたぐ（効果不明だが害もない）

パラメータ再調整（`[4]=60→30`, `[3]=40→20`）はベンチが芳しくないときの **チューニング** であって、即 revert より優先する。

### NPS 検証の順序

1. Phase B 実装直後 → `pnpm check-fix` + `zig build test` 全パス確認
2. `/profile-cpu` で NPS 実測（5% 閾値チェック）
3. パスしたら Stage 1（commit-bench 2 セット）へ
4. -15 を下回らなければ Stage 2（8 セット）へ強制進行

### 期待効果

- 中盤の評価値振動の低減（627 → 400 程度）
- 「素材を蓄積する手」を高評価
- Stage 2 での検証目標: **Elo +20 以上（CI下限 > 0）**

---

## Phase C: 既存パラメータの再チューニング（Phase B 後）

### 目的

Phase B で評価ベースが変わった後に、既存定数の最適値を再探索する。

### 候補（グループ化 — SOLID 指摘反映）

| グループ   | 定数                                         | 候補値              | 検証セット |
| ---------- | -------------------------------------------- | ------------------- | ---------- |
| 末端脅威系 | `LEAF_FOUR_THREE_THREAT`, `LEAF_MISE_THREAT` | 2000→3500, 500→1000 | 同時検証   |
| 連携系     | `MULTI_THREAT_BONUS`, `CONNECTIVITY_BONUS`   | 500→800, 30→60      | 同時検証   |
| パターン系 | `THREE`, `OPEN_TWO`                          | 30→80, 50→80        | 同時検証   |

各グループを独立 Stage 1 → 採択候補のみ Stage 2。

### Stage 2 採択条件

- 各グループ独立に Stage 2 を実施
- グループごとに **CI 下限 > 0（≒ +20 Elo 以上）** を採択基準
- 採択されたグループの組み合わせで最終回帰確認（全グループ込み Stage 2）
  - グループ間の独立性は仮定。相互作用があれば最終確認で検出

### 撤退基準

- Stage 1 で Elo -30 以下 → revert（明らかな破壊）
- グループ内で正負混在 → 個別に分割再検証
- 0 付近で動かない場合: 元の値に戻す（チューニングの一環、理論的根拠は薄いため）

---

## Phase D: 影響圏（Influence Map）— 条件付き

### 前提条件（イシューレビュワー指摘反映）

**Phase B の Stage 2 結果次第で go/no-go**:

- Phase B が +20 Elo 以上 → Phase D を実施
- Phase B が +0〜+20 Elo → Phase D の設計見直し（新しい角度を検討）
- Phase B がマイナス → Phase D 中止

### 設計（ライン単位 sweep — パフォーマンスレビュワー指摘反映）

全空きセル走査ではなく、**ライン単位 sweep** で実装。

```zig
// 各ラインを左から右へ sweep し、各空きセル位置で
// 「左側最寄りの自色石距離」「右側最寄りの自色石距離」を計算
// 4 方向のラインを総当たり
pub fn evaluateInfluence(perspective: Cell) i32 {
    var total: i32 = 0;
    for (0..bitboard.LINE_COUNT) |line_idx| {
        const own = bitboard.global_bb.{black|white}[line_idx];
        const opp = ...;
        total += sweepLine(own, opp, line_len);
    }
    return total;
}
```

`sweepLine` は CTZ で左端からの距離を計算し、各空きセルに `max(0, 5 - distance)` を加算。

### コスト見積もり（修正）

- 88 ライン × ~13 セル × 定数 = **3〜5 µs/eval**
- NPS 影響: **-3〜5%**（パフォーマンスレビュワーの修正値）

### incremental 化の余地

Phase D は影響範囲が広い（石1個で半径5の空きセルに波及）ため、**最初は非 incremental で実装**。効果確認後に incremental 化を検討（実装複雑度は B の 3-4倍）。

### Phase B との責務独立性（SOLID 指摘反映）

`line_potential.zig` と `influence_map.zig` は両方とも `bitboard.global_bb.{black,white}` を読むが、**互いを参照せず独立した経路**として実装する:

- `line_potential.zig`: 5-cell 窓 popcount ベース
- `influence_map.zig`: 距離ベース sweep
- 両者間でヘルパーを共有せず、コピペも避ける（共通化が必要なら専用 utility ファイルを別途作る）

### Phase D 撤退基準

- Stage 1 で Elo -30 以下 → revert（明らかな破壊）
- NPS 低下 > 8% → 設計見直し（incremental 化）
- B+D 累積 NPS 低下 > 10% → D を見送る
- 0 付近で動かない場合: 理論的妥当性は高いので残す（コスト < 5% NPS なら）

---

## 実施順序

1. **Phase 0: 振動分解** — 静的ノイズ支配を確認
2. **Phase B: ライン単位ポテンシャル** — incremental 化、効果確認
3. **Phase C: パラメータチューニング** — Phase B のベースで再探索
4. **Phase D: 影響圏** — Phase B の結果次第で go/no-go

**Phase F（QSearch 拡張）は別プラン**として切り出す。本プランの範囲外。

---

## 検証計画

### 2段階スクリーニング

| Stage   | 条件                   | 用途                 | 棄却基準                           |
| ------- | ---------------------- | -------------------- | ---------------------------------- |
| Stage 1 | 2セット (104局, CI±64) | **明らかな破壊検出** | -30 Elo 以下 → revert              |
| Stage 2 | 8セット (416局, CI±67) | **効果測定**         | 参考値（採択は理論的妥当性で判断） |

**理論的に妥当な変更は、ベンチで明確な改善が出なくても残す**。
Stage 2 は「どれくらい改善したか」を知るためであり、「採択するかどうか」を決めるためではない。

### 各 Phase 共通

- `zig build test` 全パス
- `profile-cpu` で NPS 実測 (before/after)
- `commit-bench` で対 main の Elo 測定

## 撤退基準

### Phase 単位

- **撤退**: Stage 1 で -30 Elo 以下（明らかな破壊）、または NPS 低下 > 設計値の 2倍
- それ以外は **理論的妥当性で判断**して残す

### プラン全体

- **全体 revert**: 全部入りバイナリで Stage 1 -30 以下、または NPS 低下 > 15%
- 個別 Phase の Elo がノイズ範囲（±20）でも、合計で改善があれば成功と見なす
- Stage 2 は最終確認用。効果測定値は記録するが、採否の決定には使わない

---

## 重要ファイル

- `zig/src/line_potential.zig` — **新設**（Phase B）
- `zig/src/scores.zig` — `LINE_POTENTIAL_TABLE` 追加、Phase C で値変更
- `zig/src/incremental_eval.zig` — `line_potential_black/white` 追加、差分更新
- `zig/src/evaluate.zig` — Phase B 集計呼び出し
- `zig/src/influence_map.zig` — **新設**（Phase D, 条件付き）
- `scripts/eval-vibration-bench.ts` — **新設**（Phase 0）
- `bench-results/quick-kifu-2026-04-10T10-40-39-752Z.json` — 棋譜分析の根拠

## 別プラン化するもの

- **Phase F: QSearch 拡張** — 本プラン外。「探索改善プラン」として独立計画
- 時間制限延長（hard `timeLimit` 10s→20s）— ユーザー保留中
