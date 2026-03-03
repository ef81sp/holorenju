# VCTカウンターフォー・ブロック防御サイクル 作業レポート

## 背景

棋譜 `H8 G7 J10 H10 H9 I9 G8 I10 I8 J8 G11 G10 H7 H6` の14手目(H6)で検出される
被追詰(VCT)手順にカウンターフォーのブロック手と、その後の防御サイクルが含まれない問題。

## 問題

### 問題1: ブロック手がシーケンスに含まれない（初版）

VCT手順は攻防の抽象表現で、ブロック手は暗黙配置（シーケンス外）だった。
F8→E8→F9→I6→D11→E10→**F11** が返されていた。

### 問題2: VCF短絡によるブロック以降の手順省略（第2版）

VCF短絡でブロック F10 を最終手にしたが、F10 だけでは勝ちが決まらない。
白が F7 で防御すると F10 の脅威（三）が防がれるため、その後の VCT 手順も必要。

**修正**: ブロックの脅威に対する防御サイクルを明示的に処理する
`processBlockDefenses` ヘルパーを導入。

| 初版                              | 第2版（VCF短絡）                  | 最終版                                                      |
| --------------------------------- | --------------------------------- | ----------------------------------------------------------- |
| F8, E8, F9, I6, D11, E10, **F11** | F8, E8, F9, I6, D11, E10, **F10** | F8, E8, F9, I6, D11, E10, **F10, F11, G9, I7, E9, D9, H12** |

## 修正箇所

### `processBlockDefenses` / `buildBlockDefSubSequence` ヘルパー

ブロック配置後の防御サイクルを処理する2関数を追加:

- **`processBlockDefenses`**: ブロックの脅威に対する防御位置を列挙し、
  各防御で VCT 継続を検証。最初の防御ではシーケンス構築、
  2番目以降では `evaluateCounterThreat` で boolean チェックのみ。
- **`buildBlockDefSubSequence`**: ct に応じた継続シーケンスを構築。
  ct=three は `handleCtThreeDefense`、ct=four はネストされたブロック処理（再帰）、
  ct=none は `findVCTSequenceRecursive` に委譲。

### `blockHasThreat` ヘルパー（DRYリファクタリング）

4箇所の `blockThreat === "none"` / `blockThreat !== "none"` を統一。

### `validateVCTSequence` の明示的ブロック対応

暗黙ブロック配置を廃止。ct=four 検出時に次のシーケンス要素がブロック位置と
一致するか検証し、ブロックを先行配置してインデックスをスキップ。

### `findVCTSequenceFromFirstMove` の更新

VCF 短絡を撤去し、`processBlockDefenses` に置き換え。
ローカルに TimeLimiter と VCFCache を作成して渡す。

## 過去のアプローチ（教訓）

### VCF短絡（撤去済み）

ブロック配置後に VCF を検出し、VCF 存在時にブロックを最終手にする方針。
F10 単体では勝ちが決まらない（白が防御可能）ため撤去。

### ブロック石の展開表示（撤去済み）

VCT手順にブロック石を挿入して展開表示する方針で8ファイルを変更したが、
PV表示バグが根本的に解決できず全撤去。

### `analyzeJumpPatterns` でのミセ検出（ノーオペレーション）

`checkDefenseCounterThreat` と `analyzeJumpPatterns` は同一基本関数群を使用。
前者が "none" なら後者も `hasFour: false` → 追加検出は常に false。

**教訓**: 同じ基本関数群を使う2つの検出器は同じ結果を返す。

## レビュー指摘事項（docs/to-fix.md）

| #   | レビュワー     | 指摘                                                         | 重要度 |
| --- | -------------- | ------------------------------------------------------------ | ------ |
| 1   | イシュー       | evaluate() の返り値 results に Phase 2 VCT結果が反映されない | 高     |
| 2   | SOLID          | ForcedLossType の SSoT化（7か所で重複定義）                  | 高     |
| 3   | SOLID          | review.worker.ts のロジック切り出し（SRP）                   | 高     |
| 4   | SOLID          | forcedLossLabel の switch-case 3か所重複                     | 中     |
| 5   | SOLID          | vctCheckOnly レスポンス型の区別                              | 中     |
| 6   | パフォーマンス | classifyWhiteWinningPattern の重複走査                       | 中     |
