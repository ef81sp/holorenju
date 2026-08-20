# issue #116: 追い詰め手順で相手のミセ手を見逃す（VCT再帰のミセ手ガード）

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

## 原因

`zig/src/vct.zig` の非対称なガード。

- エントリ `findVCTSequence`（:1093-1096）: 相手の**活三・ミセ手（`hasFourThreeAvailable`）・VCF** を見て、
  どれかがあれば VCF-only にフォールバックする。
- 再帰本体 `findVCTSequenceRecursive`（:1213 付近）と `hasVCT`（:903 付近）: **活三しか見ていなかった**。

受け手の分類 `checkDefenseCounterThreat` は「受け手自身が五/四/三を作るか」しか見ないため、
三を作らないミセ手（受けた結果として四三点が生じる手）は `.none` 扱いで通常再帰に入り、
攻撃側が四でない三を打つ手順が詰み木に載る。

## 修正

`hasVCT` と `findVCTSequenceRecursive` の各ノードで、活三チェックの直後に

```zig
if (hasFourThreeAvailable(cells, opponent)) return false;
```

を追加（意味論: 相手がミセ手を持つなら、攻め手は四/五でなければならない）。
どちらの関数も直前で VCF を試しているため「四追いで勝てる」ケースは保存される。

`checkDefenseCounterThreat` は変更していない（攻撃側ブロックの `blockHasThreat` 判定にも
使われており意味が変わるため）。

`src/logic/cpu/search/vctValidation.ts` の「探索開始時点で相手に活三/ミセ手がないことは
findVCTSequenceRecursive が保証する」というコメントが実態とずれていたので、修正後の実態に合わせた。

## テスト（TDD）

追加:

- `src/logic/cpu/review/vctMiseDefense.wasm.test.ts`（新規）
  - 17 石局面で白の `forcedWinType` が `vct` でないこと
  - 21.黒J11 後の局面でも白に VCT がないこと（分岐と開始局面の整合ガード）
- `zig/src/vct.zig` 末尾に 2 テスト
  - `hasVCT: 相手にミセ手がある局面で偽VCTが成立しない（issue #116）`
    （前提として「黒に活三はないがミセ手はある」ことも assert）
  - `findVCTSequence: 途中でミセ手を持たれる手順をVCTとして返さない（issue #116）`

赤→緑の確認:

- 修正前: `zig build test` → 3109/3117 passed, 8 failed（新規 2 テスト × 4 バリアント）。
  TS 側も 17 石のケースが `expected 'vct' not to be 'vct'` で失敗。
- 修正後: `zig build test` 全緑、`pnpm test` **114 files / 1840 tests 全緑**（既存の
  `vct_tree_test.zig` / `renjuParity.test.ts` / `forcedLoss*.wasm.test.ts` /
  `j6ForcedLossChain.wasm.test.ts` 含め壊れなし）。`pnpm check-fix` 0 warnings / 0 errors。

## 性能

上記棋譜の 5〜31 石の全局面に対して `detectForcedWin` を回した実測（同一マシン・同一条件）:

|        | 合計   | 17石局面（当該局面）単体           |
| ------ | ------ | ---------------------------------- |
| 修正前 | 42.3 s | 5.4 s（偽 VCT を即座に返していた） |
| 修正後 | 58.6 s | 19.6 s                             |

増分 +16.3 s のうち約 14 s は当該 17 石局面。VCT が見つからなくなった結果、
`forcedWinDetection.ts` のフォールバック `findVCTByFirstMoveIteration`
（最大 40 初手 × 100k ノード, `timeLimit: Infinity`）まで落ちるため。
残り 27 局面の合計は 36.9 s → 39.0 s（+約 6%）で、これが各ノードでの
`hasFourThreeAvailable` 呼び出しのオーバーヘッドに相当する。

判定結果は当該局面が `vct` → 検出なしに変わっただけで、他 26 局面の
`forcedWinType`（12/24 石の vct、26/28/30 石の vcf）は完全に一致。

## 残課題

- **相手 VCF（1手ミセでない四追い四三）の再帰内チェックは未実装（エントリのみ）。**
  `findVCTSequence` のエントリは `vcf_mod.hasVCF(opponent)` も見ているが、
  `hasVCT` / `findVCTSequenceRecursive` の各ノードには入れていない（コストが大きいため）。
  同種の見落としが VCF 経由で残っている可能性がある。
- `findVCTSequenceRecursive` は対局 CPU の経路（`findVCTMove(WithBudget)` → `findVCTSequence`）でも
  使われるため、各ノード +`hasFourThreeAvailable` のコストは探索ノード数に効く。
  強さへの影響は未計測（Elo ベンチ未実施）。
- 当該局面のフォールバック 19.6 s は振り返り解析の体感に効く可能性がある。
  `findVCTByFirstMoveIteration` の予算（40 初手 × 100k ノード, timeLimit 無制限）は別途要検討。
