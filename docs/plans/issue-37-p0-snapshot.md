# Issue #37 P0 (#39): review 出力スナップショット harness

## 目的

review 解析（fullEval の戦術出力）の**現在の結果を golden 凍結**し、P3（review 戦術の Zig 移行）が **出力不変**を機械的に証明できる安全網を作る。本 PR はロジックを一切変えない（純粋に現状を固定）。

## 設計方針（レビュー反映：直接関数主役・決定性は設定で担保）

レビューで確認した事実：**bounded 探索は `timeLimit=Infinity/0` を渡すと完全に決定的**（Zig `search.zig`/`vcf.zig`/`vct.zig` が `time_limit==0` で時刻チェックを skip → 終了条件は maxNodes/maxDepth のみ＝マシン非依存）。一方 **`executeFullEval` 内の minimax は常に時間制限（15s/20s）**で非決定。

→ **MVP は「P3 直撃の戦術関数を盤面リテラル入力で直接スナップショット」**。`executeFullEval` 全体凍結は**MVPから外す**（minimax 非決定＋粒度過大で巻き添え更新の温床）。任意で後日。

### MVP スナップショット対象（P3 #42 スコープを直接カバー）

盤面リテラル＋固定 color で直接呼び、**node-bound（timeLimit 無効化 or 速攻確定局面）**で決定化：

- `detectForcedWin(...)`（forcedWinDetection.ts）— 既に `timeLimit:Infinity`+maxNodes で node-bound・決定的。内部で `findThreatMoves`(vctHelpers, P3直撃)も走る。
- `checkForcedLoss(...)`（forcedLossCheck.ts）— 既定 options は有限 timeLimit。**テストでは Infinity timeLimit を渡す**（options 引数が無ければ速攻確定局面のみ採用し根拠を明記）。
- `verifyCandidates(...)`（candidateVerification.ts）— opponentForcedWin 判定。同上。
- `buildDoubleMiseTree` / doubleMise 生成（doubleMiseBranches.ts, `findDoubleMiseMoves`）— 純パターン走査・時間非依存。

凍結フィールド＝**構造系**：`forcedWinType`/`forcedWinTree`/`forcedLossType`/`forcedLossSequence`/`opponentForcedWin(+Sequence)`/`isFukumi`/`doubleMiseTargets`。

### 除外（最初から対象外と断言）

- minimax 由来：`bestScore`/`playedScore`/`candidates[].searchScore`/`candidates` 順序/`completedDepth`/`timings`。これらは時間制限依存で非決定。
- **候補スコアの Zig 化（#42 の一部）は P0 では守れない**点を明記。P3 着手時に「候補スコアは元々 minimax(Zig) 由来で TS 糊が触らない」かを切り分ける前提とする。

### 正規化（探索順依存を潰す）

- `forcedWinTree` の `defenses[1..]`（主筋以外の防御分岐）など**順序が探索順依存のフィールドはソートして正規化**してから凍結（既存 `forcedWinTree.wasm.test.ts` が `toContain` で順序非依存に検証している＝順序不安定の示唆）。
- 正規化は**単一の純TS関数**に集約し、JSDoc で「凍結する契約／無視するフィールド」を明記。丸めは使わない（実差分を隠すため）。

## コーパス（速攻確定する forcing 局面）

`reference_review_test_kifu.md` ＋既存棋譜から、**Infinity timeLimit でも maxNodes 内で速く確定**する局面を厳選（VCT は maxNodes だけで打ち切れない設計なので特に速い局面のみ）：

- Mise-VCF（#18 局面、詰み木分岐あり）／ VCF 確定 ／ VCT 確定 ／ 被必勝(forcedLoss) ／ 両ミセ。
- コーパスは `const CORPUS = [{name, board(リテラル) or record, color}]` として**1箇所に集約**（実行ハーネスと分離）。

## 実装

- `src/logic/cpu/review/reviewSnapshot.test.ts`（新規）：
  - `beforeAll` で `loadWasmModule()` → `WasmSearchEngine`（1回ロード）。
  - `CORPUS` を `it.each` で回し、各直接関数 → 正規化 → `toMatchSnapshot()`。入力は盤面リテラル（`createBoardFromRecord` で作っても可だが固定）。
  - `checkForcedLoss`/`verifyCandidates` には Infinity timeLimit を渡す（関数が options を受けるか実装時に確認。受けないなら速攻確定局面で代替＋根拠コメント。本番シグネチャは汚さない）。
- `.snap` 生成後**目視レビュー**してコミット。

## 検証ゲート

- `pnpm test`(unit+scripts) 緑。決定性は**「node-bound 設定で呼んでいること」をコードで担保**（2回実行一致は補助的 smoke のみ＝同一マシンでは弱い指標）。
- 既存テストに影響なし（追加のみ）。

## 対象外

- ロジック・Zig 変更（凍結のみ）。`executeFullEval` 全体スナップショット（任意・後日）。verdict しきい値（classifyMoveQuality、純TS・P3非対象）。

## メモ

- これは P3 各小 PR で「戦術出力不変」を確認する基準。P1/P2（メイン）とは無関係。
- `checkForcedLoss` 等に Infinity timeLimit を渡す経路が無い場合、その整備自体が P3 の前提として価値がある（本番 API は汚さず、テスト用 options 渡し or 速攻確定局面で対応）。

## ワークツリー運用

- コミット前: `cd zig && zig build`（テストが wasm を要求）＋ `pnpm check-fix`。`pnpm install` は worktree で実行しない。
- ステージは個別ファイル指定（`git add -A` は deny）。
