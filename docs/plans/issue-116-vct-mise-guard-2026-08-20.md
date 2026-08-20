# issue #116: 追い詰め手順で相手のミセ手を見逃す（VCT のミセ手ガード）

対応日: 2026-08-20 / ブランチ: `fix/issue-116-vct-mise-defense`

## 症状

棋譜（左下原点・黒先手）

```
H8 H9 J10 I9 G9 I7 I8 J8 H10 K9 L10 K7 K10 I10 J9 H7 J7 I6 G8 F8 L11 M12 L9 L12 J11 I12 J12 J13 I11 K13 K11
```

の 17 石局面（白18手目 I6 の直前）で `detectForcedWin(board, "white", …)` が
`forcedWinType = "vct"`、メインライン `M5 L6 G8 J5 …` を返す。
しかし分岐 18.白M5 19.黒L6 20.白G8 21.黒J11 の後、黒は四三点 J12 を持つ（ミセ手）のに
白22手目が四ではない三 J5 になっており、黒が `J12 J13 I11` で先に勝つ **偽 VCT**。
同じ 21.黒J11 後の局面から白を新規探索すると VCT は出ない（＝木の途中でのみ壊れていた）。

Rapfi オラクル（30s/手）でもこの 17 石局面は best = J11・eval +5 で、白の強制勝ちは無い。

## 原因

`zig/src/vct.zig` の非対称なガード。

- エントリ `findVCTSequence`: 相手の**活三・ミセ手（`hasFourThreeAvailable`）・VCF** を見て、
  どれかがあれば VCF-only にフォールバックする。
- 再帰本体 `findVCTSequenceRecursive` と `hasVCT`: **活三しか見ていなかった**。

受け手の分類 `checkDefenseCounterThreat` は「受け手自身が五/四/三を作るか」しか見ないため、
三を作らないミセ手（受けた結果として四三点が生じる手）は `.none` 扱いで通常再帰に入り、
攻撃側が四でない三を打つ手順が詰み木に載る。

## 修正

### 述語のヘルパー化

```zig
/// 相手が「三の追いを許さない脅威」（活三 or 1手四三＝ミセ手）を持つか
pub fn opponentBlocksThreePursuit(cells: []Cell, opponent: Cell) bool {
    return hasOpenThree(cells, opponent) or hasFourThreeAvailable(cells, opponent);
}
```

呼び出し元は `checkSequenceBreaksByCF`(:577)、`hasVCT`(:943)、
`findVCTSequence` エントリ(:1131)、`findVCTSequenceRecursive`(:1269)、
`findVCTSequenceFromFirstMove`(:1904)、`isVCTFirstMove`(:2101) の 6 箇所。

### ガードの意味論: 「ノード棄却」ではなく「三の攻め手のみ不可」

`hasVCT` / `findVCTSequenceRecursive` は**ノードごとの early return をしない**。
相手が活三/ミセ手を持っていても、「四で受けを強制し、その四の石が相手の脅威を潰す →
以降は三で追って勝つ」という真正 VCT が存在するため、ノード棄却はこれを落とす
（直前の VCF 試行は五まで四追いで終わる線しか拾えない）。
既存の `checkSequenceBreaksByCF` が同じ状況を「次の攻め手が四/五なら継続 OK」と
実装しているので、そちらに揃えた。

実装は `findThreatMoves` が「四 → 活三」の順に詰めて返すことを利用する。
四の本数を返す `findThreatMovesCounted`（`ThreatMoveCounts{ total, four_count }`）を新設し、
脅威手ループで **三の手に入る直前（`i == four_count`）に一度だけ**
`opponentBlocksThreePursuit` を遅延評価する。真なら残り（すべて三）を `break`。
四で勝てる場合はこの判定に到達しないので、判定コストも払わない。

### `hasFourThreeAvailable` の並べ替え（等価）

黒相手では全空点に対して `checkForbiddenMove` が `createsFourThree` より先に走っていた
（黒 16〜22µs / 白 2µs）。`createsFourThree` を先に評価し、成立した点だけ禁手確認する順に
入れ替えた。意味論は同値。

### その他

`src/logic/cpu/search/vctValidation.ts` の「探索開始時点で相手に活三/ミセ手がないことは
findVCTSequenceRecursive が保証する」というコメントが実態とずれていたので実態に合わせた。

## テスト（TDD）

- `src/logic/cpu/review/vctMiseDefense.wasm.test.ts`（新規、WASM 経路の回帰）
  - 17 石局面に白の強制勝ちが無いこと（`forcedWinType` undefined / `forcedWin` null。
    期待値の根拠は上記 Rapfi オラクル）
  - 偽 VCT 手順の分岐（17手 + `M5 L6 G8 J11`）でも同じであること
    ＝「開始局面と木の途中の整合ガード」（この分岐単体は修正前から緑・3ms）
- `zig/src/vct.zig`（`setupIssue116Position` を共有）
  - `hasVCT`: 21.黒J11 後の局面で偽 VCT が成立しないこと
    （前提として「黒に活三はないがミセ手はある」も assert）
  - `findVCTSequence`: 17 石局面から VCT 手順を返さないこと
  - `hasVCT`: **四で相手の活三を潰してから三で追う手順は成立すること**
    （意味論変更の正当化。旧「ノード棄却」実装ではこのテストは赤になることを確認済み）

赤→緑:

- 修正前: `zig build test` → 8 failed（回帰 2 テスト × 4 バリアント）、TS も 17 石が赤。
- 意味論変更の検証: `hasVCT` に旧ガード（`if (opponentBlocksThreePursuit(...)) return false;`）を
  一時的に戻すと、新設の肯定テストのみが赤になることを確認。
- 修正後: `zig build test` 全緑、`pnpm test` **114 files / 1840 tests 全緑**、
  `pnpm check-fix` 0 warnings / 0 errors。

## 性能

当該棋譜の 5〜31 石の全局面に `detectForcedWin` を回した実測（同一マシン・同一条件）。

|                              | 合計   | 17石（当該局面）         | 14石（最重局面） | その他25局面の合計 |
| ---------------------------- | ------ | ------------------------ | ---------------- | ------------------ |
| 修正前 (95dbba9)             | 42.3 s | 5.5 s（偽 VCT を即返却） | 34.2 s           | 2.6 s              |
| 初版 (fdff248, ノード棄却)   | 59.2 s | 19.2 s                   | 37.7 s           | 2.3 s              |
| 今回 (意味論変更 + 並べ替え) | 59.9 s | 19.8 s                   | 37.7 s           | 2.4 s              |

- 増分のほぼ全ては 17 石局面（+14.3 s）。VCT が見つからなくなった結果、
  `forcedWinDetection.ts` のフォールバック `findVCTByFirstMoveIteration`
  （最大 40 初手を 1 手ずつ検証、`timeLimit: Infinity`）まで落ちるため。
  **`maxNodes: 100_000` は VCT 経路では実質効かない**: `zig/src/vct.zig` は
  `incrementNodes` を一切呼ばず、`findVCTSequenceRecursive` が呼ぶ VCF は
  独自 limiter（`findVCFSequence(cells, color, VCF_MAX_DEPTH, 0, 0)`）なので
  共有 limiter の `nodes` が進まない。実質無制限の探索に落ちている（修正は別 issue）。
- 14 石局面の +3.5 s（+10%）が、各ノードでの `opponentBlocksThreePursuit` の
  オーバーヘッドに相当する（`hasFourThreeAvailable` の並べ替えを入れてなおこの差）。
- 初版 → 今回は +0.7 s（+1.2%）。意味論を広げた分（四の後も探索が続く）と
  並べ替えの高速化がほぼ相殺している。
- 判定結果は 17 石が `vct` → 検出なしに変わっただけで、他 26 局面の `forcedWinType`
  （12/24 石の vct、26/28/30 石の vcf）は 3 版すべてで完全一致。

## 残課題（いずれも別 issue 推奨）

1. **ct=four のブロック後経路にガードが無い**（同クラスの穴）。
   `processBlockDefenses` / `processBlockDefensesSeq` / `buildBlockDefSubSequence` で
   `block_ct == .three` のとき、受けは強制ではないのに活三/ミセ手のチェックが入っていない。
2. **相手 VCF の再帰内チェックが未実装**（エントリのみ）。深刻度はミセ手より上。
   `findVCTSequence` のエントリは `vcf_mod.hasVCF(opponent)` を見るが、
   `hasVCT` / `findVCTSequenceRecursive` の各ノードでは見ていない（コストのため）。
3. **`findVCTByFirstMoveIteration` の予算が実質無制限**（上記 `max_nodes` 不達）。
   17 石局面の 19.8 s はここ。振り返り解析の体感に効く。
4. **対局 CPU への Elo 影響は未計測**。`findVCTSequenceRecursive` は
   `minimax.zig:314-327`（threatProbe 50ms）と `search.zig:186`（300ms）からも使われ、
   ノードあたり `opponentBlocksThreePursuit` のコストが乗る。commit-bench 推奨。
