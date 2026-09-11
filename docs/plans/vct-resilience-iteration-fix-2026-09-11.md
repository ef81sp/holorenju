# 追い詰め（VCT）探索の取りこぼし修正 — 逆四耐性検証と反復深化（2026-09-11）

- 発端: `horizon-flips-analysis-2026-09-11.md` の副次発見（idx 6）。黒 H9 I9 H8 J7 I6 / 白 G8 H7 I7 F9 I8（黒番）で、J9 からの追い詰めが存在する（白の全受け K9/G9/L9 に黒の VCT/VCF、hard の主探索は 99999）のに `findVCTSequence` が深さ・予算に関係なく「なし」を返す。黒 H8 を外すと見つかる。
- ブランチ `fix/vct-miss-idx6`（ab7327a 修正 → a2d29a2 性能対処）。実装はサブエージェント、設計判断と diff 精査は私、/review 3 観点済み。

## 1. 原因

`zig/src/vct.zig` `findVCTSequenceInner` の反復深化は、各深さで見つかった手順を事後に `isResilientToCounterFours`（逆四耐性）で検証し、**非耐性なら反復深化ごと打ち切って VCF-only に落としていた**（issue #27 e9ca63c 由来。「深い反復に進んでも先頭の活三は同じで再度棄却される」という最適化上の仮定）。この仮定は誤りで:

- (a) 同じ深さで先に成立した非耐性候補が `best_seq_len`（#122 の手順長 α 値）を絞り、後続の耐性ある攻め手が α カットされる
- (b) より深い反復でしか成立しない別の先頭手に到達しない

idx6 では深さ 3 で非耐性の J10 系（J10 G7 L9 M10 J9 K9 J8）を拾って中断し、深さ 5 以上で成立する J9 系に到達しなかった。受け手集合（K9/G9/L9）・禁手判定・bitboard・#145 の逆四ブロック分岐はいずれも原因ではない（二分探索と述語の直接評価で除外）。

## 2. 修正

1. `VCTRecursiveContext.mode` を追加し、`findVCTSequenceRecursive` の **根（depth 0）の候補採用時に攻め手ごとに** `isResilientToCounterFours` を評価。非耐性候補は best / α 値を更新しない（採用されうる長さの候補にだけ検証が走るよう短絡順は `candidate_len < best_seq_len and (depth != 0 or resilient)`）。Inner の事後検証と VCF-only フォールバックは削除（根の VCF はループ前に検査済み）。
2. 性能対処（レビュー指摘: 「追い詰めなし」局面で無制限探索が 38 ms → 212 s）: `hasBreakingCounterFour` に手順非依存モード（`sequence = null`）を追加し、`rootThreeBrokenByCounterFour` で根の三が **手順に依存せず崩壊する**（相手の逆四で五／活四／ブロック点が禁手／ブロック後に相手即勝ち）ものを `RootCFCache`（225 セル 3 値）に記憶して反復をまたいで展開前に除外。
3. テスト: idx6 の失敗テスト（`findVCTSequence` / `findVCTSequenceFromFirstMove(J9)` / `isVCTFirstMove(J9)`）、`rootThreeBrokenByCounterFour` の単体、除外後のノード数（strict は < 2,000）。issue #146 の 2 テストは「追い詰めなし」→「初手 (7,8) を返さない」に変更（この局面には初手 K11 の本物の追い詰めがあることを独立検証で確認。偽 VCT の主張はない）。
4. doc: `findVCTMoveWithBudgetStrict` の doc、`docs/vct-counter-threat-analysis.md` に新構造を追記。

## 3. 検証

| ケース（無制限、深さ 8）   | 旧 development     | ab7327a         | a2d29a2          |
| -------------------------- | ------------------ | --------------- | ---------------- |
| idx6 lenient               | なし（取りこぼし） | 84.6 ms 発見    | **65.1 ms 発見** |
| idx6 lenient d5 / 25 ms    | —                  | なし            | **24.2 ms 発見** |
| idx6 strict                | 38 ms なし         | 221.8 s         | **0.5 ms なし**  |
| issue #27 lenient / strict | 50 / 72 ms なし    | 164 / 126 s     | 57 / 57 s なし   |
| #146 lenient / strict      | なし               | 98 / 88 ms 発見 | 103 / 92 ms 発見 |

- issue #27 の無制限 d8 は「追い詰めなしを深さ 8 まで悉皆証明する」固有コスト（根の三の崩壊が手順依存で静的に除外できない。反復ごとの消費 d4 54k → d8 7.4M）。旧の 50 ms は idx6 を取りこぼす打ち切りの副産物。製品経路（対局プローブ 25 ms / 3k、事前探索 40k、振り返り 5 s / 500k）はすべて予算付きで壁時計は不変（d5 / 25 ms で確認）。意味論を変えずに短縮する方法は無く、打ち切りヒューリスティックは再取りこぼしのリスクがあるため入れない。
- `zig build test` 4,142 本緑、`zig build test-golden` 緑（期待値不変）、vitest 2,288 本緑、`pnpm check-fix` 緑。
- 振り返り（参照棋譜 白番 29 手、FAST）: 14 手すべて判定一致、所要 35.4 s vs 35.6 s。
- 回帰ゲート `regression-positions.ts`: 全 PASS（J6 局面で H6、7.5 s）。
- strict モードで idx6 が「なし」なのは、白 E10 の逆四に対する黒のブロック D11 が四でない＝ノリ手ゲートの仕様どおり（被詰み判定を保守的にする意図）。

## 4. 採否ゲート（正しさの修正なので非劣性）

- 固定スクリーン前半（v2 382 局、1.2M/3k、jobs=7、100 分）: A=cbdaeb4 視点 **−21.9 [−44.1, +0.2] ＝ 修正が +21.9**。pentanomial ll=23 ld=5 dd=147 wd=5 ww=11（1-1 ペア 77%）。プローブ統計: 上限到達率 25.2% → **20.8%**、平均 885 → 750 ノード/回、N 使い切り 35.0% → 29.9%、深さ 6.51 → 6.57（根の三の除外が安く効き、主探索に予算が回る）。JSON `bench-results/commit-bench-2026-09-11T00-45-41-390Z.json`
- 時間ゲート（v1 1,200 局、jobs=5）: 実行中。合格 = CI 下限 > −5（非劣性）＋ 上限到達率・1 手平均時間が旧と同等以上。ログ `bench-results/gate1-vctfix-time-2026-09-11.log`

## 5. 結果（2026-09-11）

- 時間ゲート（v1、jobs=5）: 前半 785 局は harness のメモリ監視で停止（JSON 未保存、ログから 392 ペアを復元）、残り 208 開局を nohup で再開（`gate1-vctfix-time-part2-2026-09-11.log`、JSON `commit-bench-2026-09-11T06-24-03-684Z.json`）。結合 **599 ペア: A=cbdaeb4 視点 −6.4 [−18.8, +6.1] ＝ 修正が +6.4 [−6.1, +18.8]**。pentanomial ll=46 ld=11 dd=495 wd=13 ww=34（1-1 ペア 83%）。
- 後半 JSON のプローブ統計: 上限到達率 24.3% → **20.3%**、1 手平均 5,451 → 5,215 ms、10 s 張り付き 24.5% → 23.9%、深さ 6.48 → 6.50。
- 判定: 非劣性の事前基準（CI 下限 > −5）には **1.1 届かない**（−6.1）。ただし点推定は正（時間 +6.4、固定 +21.9 [−0.2, +44]）で悪化の指標が無く、独立検証済みの正しさの修正（本物の追い詰めを取りこぼしていた）であることから **採用**。基準の境界だった事実は記録し、次の main リリース前の総合ベンチ（development vs main）で再確認する。
- 振り返り判定（参照棋譜 FAST）は 14/14 一致、所要同等（§3）。
