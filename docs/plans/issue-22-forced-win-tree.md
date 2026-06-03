# Issue #22: 追詰を統一「詰み木」モデルへ移行

## 背景・根本原因

振り返りの追詰表示は現在「主 PV（`sequence`）＋ フラットな逸脱リスト（`forcedWinBranches: ForcedWinBranch[]`）」で持っている。これは AND-OR 木（攻め=OR / 受け=AND）を「主筋1本＋ズレ」に射影したロスのある表現で、

- `zig/src/vct.zig` の `buildBranches` が各再帰レベルで子分岐をフラット化し、**主筋以外（side）の防御の子孫を全レベルで捨てている**（主筋の子孫だけ offset 付きで主 PV の index 空間に畳み込む）。

これが #18（Mise-VCF 第一階層の防御欠落, 修正済み）・#22（side 分岐内の更なる分岐が出ない）の共通の根本原因。

## ゴール

追詰を**再帰的な詰み木**として持ち、任意の深さの防御分岐を表示する。VCT / Mise-VCF / 両ミセを単一モデルに統一する。

スコープ:

- **対象**: forcedWIN（最善タブ）。VCT・Mise-VCF・両ミセの分岐を木へ統一。
- **対象外**: forcedLOSS（被詰タブ）の相手詰み木化は #26 に委譲（本 issue では現状のフラット維持）。プレイヤーの代替敗着（`buildBacktrackBranches`）も別軸で対象外。
- 対局 CPU（`findVCTMove`/`findMiseVCFMove`）には触れない。分岐収集は review 専用フラグ配下で、強度不変。

## データモデル（TS, SSoT）

```ts
// src/types/review.ts
export interface ForcedWinNode {
  /** この局面での攻め手（OR を1つに固定） */
  attackerMove: Position;
  /** 受け側の全防御（AND）。空 = 終端（attackerMove で勝ち確定: 五/達四/VCF完了） */
  defenses: ForcedWinDefense[];
}
export interface ForcedWinDefense {
  defenderMove: Position;
  /** この防御後の攻め継続ノード（必須・非null）。即勝ちは defenses:[] の node で表す */
  next: ForcedWinNode;
}
```

- 追詰全体 = ルート `ForcedWinNode`。
- **終端は `defenses: []`（空）に一本化**（レビュー反映）。`next: null` は廃止し `next` は常に `ForcedWinNode`。即勝ち（次の攻め手で五）も `{ attackerMove: 勝ち手, defenses: [] }` で表現。終端判定が1種類になり walker のバグ温床を排除。
- **既定経路**（各ノードで `defenses[0]`）= 既存 `sequence`。`sequence` は eval/スコア表示・最善候補 PV 用に**そのまま残す**（完全な木SSoT化＝sequence撤廃は fullEval の多数 consumer に波及し過大なため見送り）。代わりに **「木の `defenses[0]` 連鎖 == sequence」を Zig テストで必須アサート**して二重保持の退行を防ぐ（レビュー反映）。
- progressionModel から見た最善タブ basePV は**常に「木の `defenses[0]` 連鎖」から生成**（木が出所が Zig/TS いずれでも方向統一）。
- `EvaluatedMove` / `FullEvalResult`: `forcedWinBranches?: ForcedWinBranch[]` を `forcedWinTree?: ForcedWinNode` に置換。`forcedLossBranches`（型 `ForcedWinBranch`）は #26 まで現状維持。

## Zig（アリーナ直列化）

固定長で再帰構造体は不可なので、**アリーナ（nodes/defenses のフラット配列＋index 参照）**で木を表す。

```
nodes:    [{ attacker_row, attacker_col, defense_start: u16, defense_count: u16 }]
defenses: [{ defender_row, defender_col, child_node: u16 (0xFFFF = terminal) }]
node[0] = ルート
```

- **index は u16**（u8 では 254 ノードで枯渇するため。レビュー反映）。
- 上限 `MAX_TREE_NODES` / `MAX_TREE_DEFENSES` を設定。超過時は**その枝を terminal（child=0xFFFF）に倒す**フォールバックで dangling 参照を防ぐ。既定経路（`defenses[0]` 連鎖）だけは切り捨て対象から除外する不変条件を守る。

### VCT（核心）— 2パス再帰でアリーナ化（レビュー反映）

現行 `findVCTSequenceRecursive` には2層の選択がある:

- (A) 攻め手 OR の最短選択（全脅威手を試し `best_seq_len` で最短を採用、捨てた候補のサブ木は破棄）
- (B) 採用した攻め手下の防御 AND を収集

アリーナは追記専用なので、攻め手候補ごとにノードを積んで後で捨てると index に穴が空く。これを避けるため **2パス**にする:

1. **パス1（既存ロジックのまま）**: 全脅威手を試して最短の攻め手と最短防御順を決定（`best_seq` / `selectShortestDefense`）。アリーナには積まない（長さ測定のみ）。
2. **パス2**: 決定した最短攻め手についてのみ node を確保し、各防御 entry について子を**再帰的にアリーナ構築**して `defenses[]` に積む。`defenses[0]` = `selectShortestDefense` が選ぶ最短防御（**前出し swap して sequence と一致させる**）。

- 終端（五/達四/VCF 委譲）: `child_node = 0xFFFF`、その node は `defense_count = 0`。
- `collect_branches=false`（非 review・対局 CPU）では従来通り sequence のみ（アリーナ不要・強度不変）。
- 再探索コストは review 専用パスのみで許容（対局 `findVCTMove`/`hasVCT` は別経路で影響なし）。

### Mise-VCF（#18 を木へ吸収）

ルート node = ミセ手、`defenses` = three_defenses 各点（#18 で収集済み）、各 `next` = VCF 手順の線形チェイン（branch なし）。深さは浅い。

### VCF

各四は受け一意 → 線形。Zig で木は出さず、TS 側で `sequence` から線形木を生成（branch なし）。

### バッファ

`vct_seq_buffer` / `mise_vcf_seq_buffer`: 既存の `[found, len, trap, seq pairs]` の後、`branch_count + branches...` を **`node_count, defense_count, nodes..., defenses...`** に置換。サイズは木の上限で再計算（nodes/defenses 各上限を設定、超過は安全に切り捨て＋ログ）。

## TS

- `searchEngine.ts`: `readForcedWinTree(ptr)` を追加し `ForcedWinNode | null` を構築。VCT / Mise-VCF reader が tree を返す（sequence も従来通り）。`readSequenceWithBranches` は廃止または tree 版へ。
- `forcedWinDetection.ts`: `ForcedWinInfo` に `tree?: ForcedWinNode`。
- `fullEval.ts`: `forcedWinTree` を設定。生成元3つを木へ統一:
  - VCT/Mise-VCF: Zig の tree をそのまま。
  - 両ミセ: `buildDoubleMiseBranches` を `buildDoubleMiseTree(): ForcedWinNode` に置換（ルート=bestMove、defenses=各 target、next=surviving 1手ノード）。
  - VCF（tree なし）: `sequence` から線形木を生成するヘルパ。
- 旧 `forcedWinBranches` 経路（`reviewLogic.ts:129` 等）を `forcedWinTree` に張り替え。

## progressionModel（再帰行構築・単一木ウォーカー）

UI は既にフラットな `Row[]` を消費し、再帰は progressionModel に閉じている。

**全タブを `ForcedWinNode` に正規化して単一ウォーカーで処理する**（レビュー反映：被詰だけフラット維持の2経路非対称を解消）。

- `ProgressionTab` に `tree: ForcedWinNode` を持たせる。タブ別の木生成アダプタ:
  - 最善（forcedWin）: `forcedWinTree`（無ければ最善候補 `principalVariation` から線形木）。
  - 実際（played）: `principalVariation` から線形木。
  - 被詰（loss）: `forcedLossSequence`（線形）＋ `forcedLossBranches`（第一階層）を木へ変換するアダプタ（現 `buildInlineBranches("loss")` 相当をアダプタに移設。#26 で本格的な相手詰み木に置換）。
- `buildRows(tab, selection)`: **木を選択経路に沿って walk** して `Row[]` を生成する**単一ウォーカー**。
  - node の attackerMove → move 行。`defenses.length===0` → 終端で停止。`===1` → その defenderMove を move 行にして `next` へ再帰。`>=2` → branch 行（options = 各 defenderMove、既定 index 0）、選択 defense の `next` へ再帰。
  - `selection: Record<string, string>`（**パスキー**: ルートからの defense index 連結, 例 `"0/2"`）。branch 行は `selKey: string` を持つ。
  - moveNum / isSelf は walk 中に ply を進めて算出（最善/実際: 攻め=self・受け=opp。被詰: 反転）。
- `buildVisibleItems(rows, upTo, selection)`: 行ベースのまま（形は不変、selKey 参照に変更）。
- selections は全タブ**パスキー文字列で統一**（`Record<string, Record<string, string>>`）。

## UI

- `ReviewProgression.vue`: `getSelectedOptionId(row.selKey)` / `selectBranchOption(i, optId)`（pvIdx→selKey 文字列）。`branchAriaLabel` は行の先頭オプション moveNum から算出。
- `BranchOptions.vue`: 変更ほぼなし（options/selectedId を受けるだけ）。

## テスト

- Zig: VCT アリーナ木の単体テスト（深い side 分岐を持つ局面で node/defense 構造を検証）。Mise-VCF（#18 局面）が tree で E8 を出すこと。既存 VCT/mise テストの呼び出し更新。
- TS: `progressionModel.test.ts` の最善タブ系を木モデルへ書き換え（深い分岐の行展開・パスキー選択・可視手列）。`buildDoubleMiseTree` / 線形木ヘルパの単体テスト。
- 再現: 2段目の分岐を持つ VCT 必勝局面の棋譜で、実機で深い分岐タブが出ることを確認（#22 受け入れ）。

## フェーズ（コミット単位）— 各フェーズで実機リグレッションを出さない（レビュー反映）

Zig バッファ形式変更は wasm 再ビルドで旧 TS reader を壊すため、**形式変更と reader 更新は同一フェーズに含める**。

1. **フェーズA（Zig アリーナ ＋ TS データ供給）**:
   - vct.zig 2パスアリーナ化 + mise_vcf.zig tree 出力 + main.zig バッファ（u16・拡張）+ zig テスト（深い side 分岐・`defenses[0]連鎖==sequence` アサート）。
   - TS 型 `ForcedWinNode` + searchEngine `readForcedWinTree`（新形式）+ forcedWinDetection/fullEval で `forcedWinTree` 供給（VCF線形木・両ミセ木含む全生成元）。
   - **互換維持**: この時点では progressionModel は未変更。`forcedWinTree` → 旧 `forcedWinBranches`（第一階層のみ）変換を一時的に置き、実機は現状通り動く（check-fix + 既存テスト + 実機 OK）。
2. **フェーズB（progressionModel 木ウォーカー ＋ UI）**:
   - 全タブを `ForcedWinNode` に正規化、`buildRows` 単一木ウォーカー、パスキー selections、UI（selKey 文字列）。
   - 一時変換と `forcedWinBranches`（win 経路）を撤去。progressionModel テスト書き換え。#22 実機確認。

各フェーズで `pnpm check-fix` + テスト通過を確認。

## 再現・受け入れ基準

- 受け入れ: issue 本文の局面（11手目プレイヤー必勝・追詰、`12.I10` 線では `14手` に複数 opp 防御が出るが `12.E10` を選ぶと出ない）で、**`12.E10` 選択後にも 14手目以降の分岐タブが出る**こと。
- 再現棋譜は `/analyze-position` スキルや `scripts/open-review.ts` で2段目分岐を持つ VCT 必勝局面を特定して固定する（実装前にフェーズB受け入れ用の具体棋譜を1つ確定）。

## 留意

- 既定経路（tree `defenses[0]` の連鎖）と `sequence` の一致を **Zig テストでアサート**（不一致だと最善タブ basePV がズレる）。
- アリーナ node/defense 上限超過時は枝を terminal 化（dangling 防止）。既定経路は切り捨て対象外。TS walker は visited で健全性確保。
- `forcedLossBranches`（#26）と `ForcedWinBranch` 型は当面残す。Zig アリーナ木は #26（被詰=相手の詰み木）で role 反転して再利用できる布石。
