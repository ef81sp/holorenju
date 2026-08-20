# issue #115 「長連を含む追い詰めを提案される」修正記録（2026-08-21）

## 症状

振り返りの追い詰め（VCT）解析が、黒の長連（6 連）を前提にした偽の手順を提案する。

再現棋譜（左下原点・黒先手）:

```
H8 H7 G8 G9 I10 H9 J9 J10 K8 H11 L9 K9 I11 I9 I12 K10 L10 L8 K11 I13 L11 M10 M9 N8
J12 L12 H12 G12 F9 F8 G7 F11 H13 I8 G10 E7 D6 D8 F6 G6 F5 E5 E8 C7 G4 D7 B7 C8 C9
D9 E10 D11 D10 C10 B9 G11 E11 E9 F10 B6 A5 F12 E13 J8
```

14 手目までの局面で `detectForcedWin(board, "black", …)` が `vct` を返し、手順は

```
15.L7 16.M6 17.L8 18.L6 19.J7 20.M10 21.J8 22.I8 23.M8 24.N8 25.J5 26.J6 27.K6
```

21.J8 の時点で 8 行目は `G8 H8 _ J8 K8 L8`（すべて黒）。跳び四のギャップ I8 は
黒が打つと 6 連＝長連になるので五にならず、J8 は四ではなく三でしかない。
にもかかわらず受けが I8 の 1 点に強制され、白の正当な受け（M8 / N8）が
探索木から消えていた。

## 原因

`zig/src/vct.zig` の `getThreatDefensePositions` の跳び四ブランチにだけ
`isJumpFourOverline` ガードが無かった。同じ判定を行う他 3 箇所

- `vct.zig` `classifyThreat`
- `vct.zig` `checkDefenseCounterThreat`
- `quiescence.zig` `createsFour`

はいずれも補正済みで、**分類は「四ではない」・受け点は「跳び四」** という
基準の食い違いが偽 VCT の実体だった。

## 修正

`getThreatDefensePositions` の跳び四条件に `!isJumpFourOverline(...)` を追加し、
分類側と同基準に揃えた（1 行 + コメント）。

受け点は `{I8}` から `{M8, I8, N8}` に是正され、偽手順は消えて

```
15.L7 16.M6 17.J7 18.I6 19.L8 20.L6 21.M8 22.N8 23.K10 24.N7 25.L11 26.L10 27.M12
```

に置き換わった（この局面自体には黒の追い詰めが実在する）。

## 検証

TDD で先に赤を確認した。

- Zig 単体テスト `getThreatDefensePositions: 長連にしかならない跳び四は受けを1点に絞らない（issue #115）`
  - 修正前: `expected 3, found 1`（受けが I8 の 1 点だけ）
  - 修正後: 緑。`classifyThreat(J8)` が four=false / three=true である前提も同テストで assert し、
    分類と受け点が同基準であることを主張している。
- TS wasm 回帰テスト `src/logic/cpu/review/vctOverlineDefense.wasm.test.ts`
  - 詰み木を全経路たどり、「受けが 1 点だけの攻め手ノードは四でなければならない」
    という不変条件を検査する（受けを 1 点に強制できるのは四だけ）。
  - 修正前: 3 件の違反を検出して赤。
    - `15.L7 16.M6 17.L8 18.L6 19.J7 20.M10 21.J8` → 受け I8
    - `15.L7 16.M6 17.L8 18.L6 19.J7 20.I6 21.M8 22.N8 23.I8` → 受け J8
    - `15.L7 16.M6 17.L8 18.L10 19.J8` → 受け I8
  - 修正後: 緑。
- `cd zig && zig build && zig build test`: 全緑（3125 テスト）
- `pnpm test`: 115 ファイル / 1841 テスト 全緑
  （`renjuParity.test.ts`、issue #116 の `vctMiseDefense.wasm.test.ts` および
  `setupIssue116Position` 系を含む）
- `pnpm check-fix`: パス

## 性能

当該局面（14 石）の `detectForcedWin` 実行時間:

|        | 時間    |
| ------ | ------- |
| 修正前 | 6.4 秒  |
| 修正後 | 34.1 秒 |

受けの選択肢が増えて探索木が広がるため約 5 倍に増えた。**正しさのための必要コスト**
（修正前は白の受けを不当に 1 点へ絞ることで探索を刈っていた）だが、
振り返り解析のテール遅延として無視できない大きさなので、追い詰め探索の
枝刈り・時間配分は別途見直す価値がある。

## 残課題

同じ「跳び四の長連補正漏れ」が以下にも残っている。**別 issue 起票済み。**

- `zig/src/quiescence.zig` `getFourDefensePosition`
- `zig/src/threats.zig` `detectThreatsCore`
- `zig/src/threats.zig` `countThreatDirections`
- `src/logic/cpu/search/vctHelpers.ts`（TS 側の同型ロジック）

いずれも本 issue と同じ基準（`isJumpFourOverline`）で揃えるのが筋だが、
探索の広がり＝実行時間に効くため、1 箇所ずつ回帰テストと性能計測をセットで進めること。
