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

### Zig 単体テスト

- `getThreatDefensePositions: 長連にしかならない跳び四は受けを1点に絞らない（issue #115）`
  - 修正前: `expected 3, found 1`（受けが I8 の 1 点だけ）
  - 修正後: 緑。`classifyThreat(J8)` が four=false / three=true である前提も同テストで assert し、
    分類と受け点が同基準であることを主張している。
  - 局面ヘルパーは `setupIssue115BranchPosition`（実戦 14 手＋偽手順の分岐 6 手を含むため
    「Branch」を名前に入れ、実戦棋譜だけを置く #116 側ヘルパーと区別する）。

### TS wasm 回帰テスト

不変条件は `src/logic/cpu/review/forcedWinTreeTestUtils.ts` に切り出し、2 本のテストで共有する。
手順や `forcedWinType` は**固定しない**（この局面の VCT 自体、白のカウンターフォーで崩れる
疑いが別途あり、それを正しく消す将来の修正で赤くなると回帰と誤読されるため）。
検査するのは「VCT が返るなら、その木は分類と受け点が整合している」という条件付きの性質。

| ファイル                          | プロジェクト             | 局面              | 実行時間 |
| --------------------------------- | ------------------------ | ----------------- | -------- |
| `vctOverlineDefense.wasm.test.ts` | unit（`pnpm test`）      | 20 石の分岐局面   | 6.9 秒   |
| `vctOverlineDefense.perf.test.ts` | perf（`pnpm test:perf`） | 14 石の根から全木 | 34 秒    |

14 石版を perf に移したのは、34 秒が pre-commit の `pnpm test` には重すぎるため。
issue #115 の不整合自体は 20 石版でも赤になる（修正前の赤は 71ms で出る）。

赤→緑の証跡（20 石版・unit）:

- 修正前: `21.J8: 四でないのに受けが I8 の1点に強制されている（そこは攻め手の長連点で五にできない）`
- 修正後: 緑

### 不変条件の設計メモ

当初は「受けが 1 点だけの攻め手ノードは四でなければならない」という強い条件にしたが、
**これは成り立たない**ことが分かった。`findVCTSequenceRecursive` は受け手自身が
カウンター脅威を作る場合（`checkDefenseCounterThreat` が win/four/three）を VCF 経路で
処理し、その受けを木の `defenses` に記録しない。つまり木に記録された受けは
`getThreatDefensePositions` の結果の**部分集合**であり、三の攻め手でも記録上 1 点に
なりうる。そこで条件を
**「四でない攻め手が受けを 1 点に強制していて、その 1 点が攻め手側の長連点なら違反」**
に限定した（＝ #115 の系統だけを狙う）。

### 全体

- `cd zig && zig build && zig build test`: 全緑
- `pnpm test`: 全緑（`renjuParity.test.ts`、issue #116 の `vctMiseDefense.wasm.test.ts` および
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
振り返り解析のテール遅延として無視できない大きさである。

探索予算の扱いは **#119**（VCT 経路で maxNodes がノーオペ・timeLimit が Infinity）、
高速化レバーは **#122**（collect 二段構えで −36% 実測、手順長 α カット等）を参照。

### 振り返り回帰棋譜での実測（`pnpm profile:review`）

棋譜 `H8 G8 H9 G7 G9 H7 I7 F10 F9 E9 I8 I9 G10 F11 H11 E8 J6 K5 J7 K6 J9 J5 J8 J10 K8 L8 I10 L7 G12`
（白番 29 手、`--wasm --verbose`）を、本ブランチと修正前（vct.zig の該当箇所を一時的に
戻して WASM 再ビルド）で比較した。

|        | 合計     |
| ------ | -------- |
| 修正前 | 22,272ms |
| 修正後 | 22,269ms |

全 14 手の判定（実手・最善手・勝ち筋・負け筋・quality）は**全手一致・変化 0 件**。
この棋譜には長連絡みの跳び四が出てこないため、修正の影響が出ないのは想定どおり。
遅さの内訳は Minimax 探索 87%（本修正とは無関係）。

## カウンターフォーによる偽 VCT の疑い（検証のみ・未修正）

イシューレビューで「修正後の手順 `15.L7 … 27.M12` も白のカウンターフォー
（E9→F9 / K6→J6）でテンポを取られて成立していないのでは」という指摘があり、
14 手 + `L7 M6 J7 I6 L8 L6 M8`（21.M8 直後）から限定検証した。

| 分岐                         | 黒の強制勝ち  |
| ---------------------------- | ------------- |
| (0) 21.M8 直後そのまま       | vcf / 初手 N8 |
| (1) 22.白E9 23.黒F9          | vcf / 初手 N8 |
| (2) 22.白K6 23.黒J6          | vcf / 初手 N8 |
| (3) 22.E9 23.F9 24.K6 25.J6  | vcf / 初手 N8 |
| (4) 上記局面での白の強制勝ち | なし          |

21.M8 の時点で黒 N8 が達四（J8 と O8 の両方が五点）になっており、白が四で
テンポを取っても達四は消えない、というのが現行エンジンの答えである。
つまり **この分岐では指摘は再現しなかった**。

ただしこれは**疑われている当のエンジン自身による検証**であり、Rapfi は
14 石局面で best=J7 / eval +469（詰みスコアではない）と答えている。
両者の食い違いは残っているので、`ResilienceMode` の lenient がテンポ喪失だけの
カウンターフォーを棄却しない件（`vct.zig` の `ResilienceMode` 定義部）は
**別 issue として残す**（番号は未採番）。

## 残課題

### #121（起票済み）: 跳び四の長連補正漏れ

同じ「跳び四の長連補正漏れ」が以下に残っている。

- `zig/src/quiescence.zig` `getFourDefensePosition` — **実害を確認済み**。
  VCF 経路の受け点はここが返すため、上記「追加で見つかった不具合」と同じ局面
  （`21.K7 22.M7 23.N8 24.O8 25.J8`）で、四である J8 に対する受けが長連点 I8 の
  1 点に強制されたままになる。`findJumpGapPosition` の返り値を検証していないのが原因。
  VCF 全体（`vcf.zig` から 4 箇所、`vct.zig` から 6 箇所が呼ぶ）に影響するため
  本 PR のスコープ外とし、修正時は必ずベンチと併せて行うこと。
- `zig/src/threats.zig` `detectThreatsCore`
- `zig/src/threats.zig` `countThreatDirections`
- `src/logic/cpu/search/vctHelpers.ts`（TS 側の同型ロジック）

#121 に追記すべき事項:

- `zig/src/threats.zig` の `getOpenThreeDefensePositions` が黒の長連点（今回の I8）を
  受け点に含めている。白 I8 は三を止めていないので、安全側ではあるものの
  探索木が無駄に広がるうえ、UI に誤った受け分岐が出る。
- TS の `src/logic/cpu/search/vctHelpers.ts` の `getThreatDefensePositions` は
  呼び出し元ゼロの dead export。#43 の流れで削除するのが筋。

### カウンターフォー起因の偽 VCT

上記「カウンターフォーによる偽 VCT の疑い」を参照。別 issue 化予定（番号未採番）。
