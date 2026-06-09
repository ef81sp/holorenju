# #37 P4 (#43): patterns.ts / forbiddenMoves.ts 物理削除プラン

> ステータス: **設計のみ**（2026-06-09）。実装は次セッション以降。本ドキュメントは /review 合意形成用。

## Context

#37 の最終目標は、連珠ルール（禁手・図形・パターン判定）の **TS 二重実装 `src/logic/renjuRules/patterns.ts` と `forbiddenMoves.ts` を物理削除**し、ダブルメンテを解消すること（= #43）。Zig 側（`forbidden.zig`/`jump_patterns.zig`/`patterns.zig`）に全関数の実装があり、対局CPU・VCF/VCT worker・禁手判定（forbiddenAdapter）は既に Zig 委譲済み。

### 唯一のブロッカー（調査で判明）

**review 内訳表示の評価スコア計算**が、評価ヘルパー（`forbiddenTactics`/`jumpPatterns`/`miseTactics`/`threatDetection`/`winningPatterns`）と探索ヘルパー（`threatMoves`/`vctHelpers`/`threatPatterns`）を通じて、patterns.ts/forbiddenMoves.ts のプリミティブ（`checkForbiddenMove`/`checkJumpFour`/`checkJumpThree`/`checkStraightFour`/`checkOpenPattern`/`getConsecutiveThreeStraightFourPoints`/`getJumpThreeStraightFourPoints`）を**同期 TS 直呼び**している。さらに `forbiddenMoves.ts` 自身が patterns.ts を使う。

評価関数（`evaluatePositionWithBreakdown` 等）は「#37 対象外＝別issue（ボス合意）」だが、それが patterns.ts を使う限り #43 を塞ぐ、というロードマップ上の矛盾。

## 方針（Option B: ルールプリミティブを Zig 委譲、評価スコア組み立ては TS 温存）

**#37 の真の目的は「連珠ルールの二重実装」解消**であり、評価のしきい値/ボーナス（ヒューリスティック）は「ルール」ではない。よって:

- **ルールプリミティブ**（禁手・図形判定）→ Zig 単一ソース（thin wasm + adapter）に一本化。
- **評価スコアの組み立て**（evaluatePositionWithBreakdown の内訳合成・スコア定数）→ TS に温存（= 別issue。プレゼン/ヒューリスティック層）。ただし内部のルール判定は adapter 経由 Zig に切替。

これで patterns.ts/forbiddenMoves.ts の TS 消費者がゼロになり物理削除できる。評価関数の全 Zig 化（ScoreBreakdown を Zig が返す Option A）は不要（大規模・UI内訳パリティ риск回避）。

### 既存資産（再利用）

- `forbiddenAdapter.ts`（checkForbiddenMove の Zig 委譲、`forbidden_wasm.zig` の `checkForbiddenPointWasm`）— 既存。
- `threat_wasm.zig` + `threatAdapter.ts`（classifyThreat/createsFourThree/detect/mise/hasOpenThree 等）— 既存パターン踏襲。
- `renjuParity.test.ts` — TS==Zig 照合。patterns.ts プリミティブの Zig 同値を既にカバー（`checkJumpFour`/`checkStraightFour`/`getJumpThreeStraightFourPoints` 等）。移行中の安全網。**最終 PR で TS オラクル消失とともに用途終了**。
- cpu-engine wasm は既に `getJumpThreeStraightFourPointsWasm` 等を export（`wasm/types.ts:28`）。Zig 実装存在の裏付け。

## 消費者マップ（patterns.ts プリミティブ → 移行対象）

| プリミティブ                            | TS 消費者（test除く、forbiddenMoves.ts は共倒れ削除）                                   |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `checkJumpFour`                         | threatMoves, vctHelpers, threatPatterns, threatDetection, winningPatterns, jumpPatterns |
| `checkJumpThree`                        | 同上 + forbiddenTactics                                                                 |
| `checkStraightFour`                     | jumpPatterns                                                                            |
| `getConsecutiveThreeStraightFourPoints` | forbiddenTactics, jumpPatterns                                                          |
| `getJumpThreeStraightFourPoints`        | forbiddenTactics, jumpPatterns（+ wasm/types.ts は型のみ）                              |
| `checkOpenPattern`                      | patternRecognition                                                                      |
| `checkForbiddenMove`(forbiddenMoves.ts) | 残 TS 直呼び3箇所（miseTactics 等）→ forbiddenAdapter へ                                |

- `patternRecognition.ts`（`recognizePattern`）は **index.ts バレルからのみ参照（実消費者ゼロ＝死蔵）**。PR-C で patternRecognition.ts ごと削除。
- `forbiddenMoves.ts` の `checkForbiddenMoveWithContext`（グローバルハッシュキャッシュ版）も **index.ts 再エクスポートのみ＝実消費者ゼロ**。forbiddenMoves.ts と共倒れ削除（Zig は単点版なので移行不要）。
- `core.ts` の `checkFive`/`createEmptyBoard` 等は削除対象外（残存）。

## PR 分解

### PR-A: patternsAdapter 敷設（新規 wasm export + adapter + parity）✅ 実装済み（本PR）

- `threat_wasm.zig` に **5 プリミティブ**を export 追加（実体は jump_patterns.zig の既存関数。cells 直読み=bitboard非依存）:
  - bool 返し（u8）: `checkJumpFourWasm` / `checkJumpThreeWasm` / `checkStraightFourWasm`（引数: row,col,dir,color。「配置済み」cells 規約）
  - Position列返し: `getConsecutiveThreeStraightFourPointsWasm`（最大2点）/ `getJumpThreeStraightFourPointsWasm`（最大1点）→ `pattern_points_buffer`（`[u8 count][count*(row,col)]`）+ `getPatternPointsBuffer`
  - **`checkOpenPattern` は省略**: 生存消費者が patternRecognition と forbiddenMoves のみで両方 PR-C/D で削除されるため adapter 不要。
- `src/logic/cpu/wasm/patternsAdapter.ts` 新規（5関数。`getThreatWasm` で threatAdapter のインスタンス共用＝二重ロード回避。boardInit/boardSet のみ同期。未ロード時 TS フォールバック）。
- faithful パリティ `patternsParity.test.ts` 新設（決定的合法自己対局40局、近傍空き点に候補配置、全8方向・両色で raw wasm==TS。点列は座標ソート正規化。+ adapter 配線 smoke）。
- ゲート: check-fix / 新パリティ緑 / renjuParity 緑 / reviewSnapshot 不変。

### PR-B: CPU/eval 利用点を adapter へ張替

- 上表の CPU 探索/評価ヘルパー（threatMoves/vctHelpers/threatPatterns/threatDetection/winningPatterns/jumpPatterns/forbiddenTactics/miseTactics）の patterns.ts プリミティブ import を `patternsAdapter` へ、残 `checkForbiddenMove` 直呼びを `forbiddenAdapter` へ切替。
- **同期性**: adapter は wasm ロード後同期。1呼び出しごと syncBoard(O(225))。review/worker パス（非ホットパス、1着手/クリック駆動）なので許容。ループ内多回呼びでボトルネックなら該当箇所のみバッチ export を検討（PR-B 内で判断）。
- ゲート: reviewSnapshot バイト不変 / renjuParity 緑 / 全テスト緑 / review breakdown 実動作確認。
- 完了時点で patterns.ts の消費者は forbiddenMoves.ts と patternRecognition.ts と index.ts のみ。

### PR-C: renjuRules 内部の patterns 依存解消

- `patternRecognition.ts`: 実利用なら checkOpenPattern を adapter へ、未使用なら recognizePattern ごと削除。
- `wasm/types.ts` の型参照整理。
- forbiddenMoves.ts の patterns 依存は PR-D で共倒れ削除のため触らない。

### PR-D: フォールバック撤去 + 物理削除（capstone, #37 完了）

- **起動ブートゲート追加（フォールバック撤去の前提・3観点レビュー指摘）**: 現状 main.ts の preload は非ブロッキング発火（`.catch`）でレースあり。フォールバック撤去後は未ロード同期呼びが例外になるため、**`app.mount` 前に `await Promise.all([preloadForbiddenWasm(), preloadThreatWasm()])` で完了保証**する init barrier を先に入れる。review.worker.ts は既に `await preloadThreatWasm()` 済み。テストは setup で preload。
- 前提充足確認: 全同期呼び出し経路が wasm ロード後であることを保証（UI 直呼びは無いことを確認済みだが、forbiddenAdapter 経由の経路も含めて再確認）。
- `forbiddenAdapter`/`patternsAdapter` の **TS フォールバック分岐を撤去**（wasm 必須化）。順序: ブートゲート merge → フォールバック撤去。
- **`patterns.ts` / `forbiddenMoves.ts` を `git rm`**。`renjuRules/index.ts` の re-export 除去。
- `renjuParity.test.ts`: TS オラクル消失 → 削除（Zig unit test が単一ソースの正しさを担保）。または Zig 出力の golden 化に再設計（要判断）。
- ゲート: check-fix / 全テスト緑 / zig build test 緑 / reviewSnapshot 不変 / review breakdown 実動作 / 対局・パズルで禁手判定が従来通り（E2E）。

## 技術判断・リスク

- **同期 wasm の保証**: フォールバック撤去後、wasm 未ロードで同期呼びが走ると例外。main/worker の preload が**起動時必ず完了**しているか PR-D で厳密検証（非ブロッキング発火のレース確認）。必要なら preload を await するブートゲートを追加。
- **パリティの維持**: PR-A〜C の間 renjuParity を緑に保ち、Zig プリミティブが TS と同値であることを移行前に保証。最終 PR-D でのみ TS を消す。
- **非合法盤の扱い**: Zig⇄TS は非合法盤（多重四/長連/盤端不能）で食い違うが合法局面では一致（#37 既知）。パリティは**合法自己対局ベース**。点列 export は座標ソート/順序付きで正規化。
- **patternRecognition の生死**: PR-A で要確定（index バレル経由の実利用調査）。
- **評価関数は依然 TS**: 本プランは「評価スコア組み立て」を TS に残す（別issue）。#37 完了後も evaluatePositionWithBreakdown は TS だが、ルール判定は Zig 単一ソース。これがロードマップ「TS=プレゼン、戦術=Zig」の最終形。
- **性能**: 触る箇所は review/worker（非対局ホットパス）。対局CPU(Zig)は無干渉。実害なし。

## 工数見積り（粗）

- PR-A: 中（wasm export 6 + adapter + パリティ）。点列バッファ2本の設計。
- PR-B: 中〜大（8ファイルの import 切替 + 同期性検証 + reviewSnapshot ガード）。最大の地味作業。
- PR-C: 小。
- PR-D: 中（フォールバック撤去 + preload 保証検証 + 物理削除 + renjuParity 処理 + E2E）。
- 合計: 複数セッション。各 PR は stacked（本体→main はボス動作確認後）。

## 未解決の確認事項（実装前にボスへ）

1. renjuParity.test.ts は **削除**でよいか（Zig 単一ソース化の帰結）、Zig golden 再設計が要るか。
2. preload 未完レース対策として**起動ブートゲート（preload await）**を入れてよいか（わずかな初期化遅延）。
3. patternRecognition.recognizePattern が未使用なら削除してよいか。
