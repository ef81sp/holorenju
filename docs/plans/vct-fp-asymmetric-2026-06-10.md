# VCT偽陽性（幻の被詰み）非対称ゲート修正 — approach B

## 背景

hard CPU が白を `-99999`（被詰み確信）と誤判断し受け身手を選ぶ「幻の被詰み」バグ。
実コーパス局面で再現、Rapfi-15s では白 -269〜-413（詰まない）→ 我々の判定は偽陽性確定。

機序（minimax.zig:410-426）:

- 防御ノード（相手手番 `!is_maximizing`）で `threatProbe` が相手の偽VCTを拾う
- `-(scores.FIVE-1)` を返す → 親の自分の攻めノードがその手を「負け筋」と誤認して回避 → 受け身手

根因: `findVCTSequence` が相手のカウンター四（ノリ手＝先手を奪う四）による手順崩壊を検証しきれず、不成立VCTを成立と誤断定。

## approach A の失敗（commit-bench 確定: Elo -88.7, CI全体が0未満）

A は `hasBreakingCounterFour` にノリ手Tierゲートを**無条件**追加。
だが `findVCTSequence` は内部（vct.zig:1099）でこのフィルタを使うため、
**攻めの `findVCTMove` まで強化されて真正な追い詰めを取りこぼし**、勝ちを失った。
→ 攻守両用パスを締めると攻めが鈍る。

## approach B: 非対称ゲート

ゲートを**`strict` フラグ条件**に変える。リスクを構造的に防御側だけに閉じる:

| ノード                   | 意味                 | 扱い                       | リスク                |
| ------------------------ | -------------------- | -------------------------- | --------------------- |
| `is_maximizing`（攻め）  | 自分のVCT=勝ち宣言   | `strict=false`（main挙動） | 改変なし→回帰ゼロ     |
| `!is_maximizing`（防御） | 相手のVCT=被詰み宣言 | `strict=true`（幻を潰す）  | 過剰棄却でも低リスク※ |

※防御側の過剰棄却が低リスクな理由: 本当に被詰みなら受けは無く通常探索に落としても結果同一。
幻なら正しく救われる。攻め側の過剰棄却（A）は勝ちを直接失う高リスクとは非対称。

## 実装（Zig: zig/src/vct.zig, zig/src/minimax.zig）

最小プランビング。`findVCTSequence` の呼び出し元は一切変更しない:

1. `hasBreakingCounterFour(..., strict: bool)` — ノリ手ゲート（block が四/五でない時 return true）を `if (strict)` で囲む。
2. `isResilientToCounterFours(..., strict: bool)` — line 714 の `hasBreakingCounterFour` に strict を渡す。
3. vct.zig:1099 の内部呼び出しは `isResilientToCounterFours(..., false)` 固定（攻め=main挙動）。
4. 新規 `findVCTMoveWithBudgetStrict(...)`: `findVCTSequence` で手順取得 → `isResilientToCounterFours(seq, strict=true)` で再検証 → 耐性あれば seq[0]、なければ null。
5. minimax.zig `threatProbe(..., strict: bool)`: VCT部のみ strict時は `findVCTMoveWithBudgetStrict` を使用（VCF部は常に lenient = 健全）。
6. 呼び出し（minimax.zig:410）: `strict = !is_maximizing` を渡す。

## テスト

- phantom 回帰テスト: 防御側相当 `findVCTMoveWithBudgetStrict(black,...) == null`（幻を棄却）かつ
  lenient `findVCTMoveWithBudget(black,...) != null`（攻めは従来通り検出）で**非対称を明示**。
- 既存 `isResilientToCounterFours` テスト（issue#27/empty/VCF-only）は `strict=false` 渡しで挙動不変を確認。
- 全Zigユニットテスト緑・renjuParity緑・check-fix緑。

## TS二重実装

`vctValidation.ts` は review専用ヘルパー。minimax消費は WASM 専用。
parity テスト範囲を確認し、必要なら TS 側 `isResilientToCounterFours` にも `strict` を追加してミラー。

## 検証

commit-bench を**統計効率優先**（SPRT もしくは小N）で実行。
予測: B ≥ main（最悪中立、幻の受け身手解消で微正）。CI下限>0 なら採用。
