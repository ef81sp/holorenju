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

### 第二の欠陥（実装後に判明）

上記を直しても同じ症状が残った。受け点の取得に使う
`threats.zig` の `findJumpGapPosition` は、ライン上の 5 マス窓を**先頭から走査して
最初に見つかったギャップを返す**。同一ライン上に「埋めると長連になるギャップ」と
「埋めると五になる正当なギャップ」が併存すると、前者を返してしまう。

例（20 石局面 + 21.K7 22.M7 23.N8 24.O8 25.J8）: 8 行目は `G8 H8 _ J8 K8 L8 _ N8`（黒）。

- I8 側の窓 `G8 H8 _ J8 K8`: 埋めると G8..L8 の 6 連＝長連で五にならない
- M8 側の窓 `J8 K8 L8 _ N8`: 埋めると J8..N8 の五 ＝ **こちらが本物**

J8 は本物の四なので `classifyThreat` も `isJumpFourOverline` も正しく動く。
壊れているのは**ギャップの選び方**だけである。

この誤選択は受け点を返す 2 経路それぞれにあった。

| 経路               | 関数                                                                            |
| ------------------ | ------------------------------------------------------------------------------- |
| VCT の脅威受け     | `vct.zig` `getThreatDefensePositions`                                           |
| VCF / 四追いの受け | `quiescence.zig` `getFourDefensePosition`（TS: `threatPatterns.ts` の同名関数） |

さらに TS 側の `getFourDefensePosition` には別の誤りもあった。連続四で
`getLineEnds` の両端空きを無条件に活四（防御不可）としているため、黒の片端が
長連になる `_XXXX_`（実際は反対の端で受けられる止め四）を「防御不可」と
誤判定していた（Zig 側は `getLineEnds` に長連補正が入っていたので無事だった）。

## 修正

### 1. 分類と受け点の基準を揃える

`getThreatDefensePositions` の跳び四条件に `!isJumpFourOverline(...)` を追加し、
分類側と同基準にした（1 行 + コメント）。

### 2. 受け点を「本当に五になる点」で選ぶ（受け点の SSoT 化）

ギャップを*探す*のをやめ、ライン上（±5 マス）の空点を仮の着手点として
「**その方向で**埋めると五になるか」を直接判定し、五になる点を列挙する。

共通ヘルパーを 1 つ作り、受け点を返す全経路がこれを使う。

- Zig: `threats.zig` の `collectLineFivePoints`
- TS: `core/lineAnalysis.ts` の `collectLineFivePoints`

判定は「黒はちょうど 5（6 以上は長連なので五ではない）／白は 5 以上（白に長連の
制限は無い）」。**方向限定**なのが要点で、`forbidden.checkFive`（TS: `checkFive`）は
4 方向すべてを見るため、別ラインの五点まで拾って「この四の受け」の意味からずれる。

盤面のコピーや書き換えは不要である。Zig の `jump_patterns.getLineLength` も
TS の `countLine` も中央セルの中身を読まず無条件に 1 と数えるので、空点に対して
呼べば「そこに置いたときの連の長さ」がそのまま得られる。

利用側:

- `vct.zig` `getThreatDefensePositions`（跳び四ブランチ）: 五点が 1 つも無ければ
  四として扱わず、三として受けを広く列挙する（防御側に有利な健全側に倒す）。
- `quiescence.zig` / `threatPatterns.ts` `getFourDefensePosition`: 連続四・跳び四を
  区別せず、方向ごとに五点を列挙して
  - 0 個 → この方向は四ではない（長連にしかならない四）→ 無視
  - 2 個以上 → 両方は塞げない ＝ 活四（防御不可）→ null
  - 1 個 → 止め四。その点が受け

  これで TS 側の `_XXXX_` 誤判定（上記）も同時に解消する。

共有関数 `threats.findJumpGapPosition` 自体は他の用途にも使われるため触っていない。
不要になった `quiescence.zig` の `getLineEnds` / `LineEnds` は削除した。

### 結果

受け点は `{I8}` から `{M8, I8, N8}`（1. の三のケース）/ `{M8}`（2. の四のケース）に
是正され、偽手順は消えて

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
- `getFourDefensePosition: 長連ギャップではなく五になるギャップを返す（issue #115）`（quiescence.zig）
  - 修正前: `expected 12, found 8`（M8 ではなく I8 を返す）で赤、修正後は緑。
- `getFourDefensePosition: 白の _XXXX_ で片端の先が白でも活四（防御不可）`（quiescence.zig）
  - 白に長連の制限が無いことの対比。修正前から緑（回帰用）。
  - 黒の同形（`getFourDefensePosition: black four with overline should not be open four`）も
    修正前から緑。Zig 側の `getLineEnds` には長連補正が入っていたため。
- `getThreatDefensePositions: 同一ラインに長連ギャップと正当なギャップが併存する場合は後者を受けにする（issue #115）`
  - 第二の欠陥の回帰テスト。`classifyThreat(J8).creates_four = true`（四であること自体は正しい）
    を前提として assert したうえで、受けが `{M8}` の 1 点のみであることを固定する。
    修正前は `expected 12, found 8`（M8 ではなく I8 を返す）で赤、修正後は緑。

### TS 単体テスト

`src/logic/cpu/search/fourDefenseOverline.test.ts`（新規）。TS 側の
`threatPatterns.getFourDefensePosition` は vcfPuzzle / vctValidation / vcfCheck から
**live で使われている**ため、Zig と同じ基準に直したうえで 3 ケースを固定した。

| ケース                                  | 修正前               | 修正後 |
| --------------------------------------- | -------------------- | ------ |
| 長連ギャップと正当なギャップの併存 → M8 | I8 を返して赤        | 緑     |
| 黒 `_XXXX_` 片端長連 → 反対の端 B8      | null（防御不可）で赤 | 緑     |
| 白 `_XXXX_` 同形 → null（活四）         | 緑                   | 緑     |

なお `renjuParity.test.ts` はリポジトリ内に存在しない（CLAUDE.md の記述は現状と不一致）。
TS⇄Zig の対応は上記の TS テストと Zig テストを同じ局面で対にすることで担保した。

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

- 1 回目の修正前: `21.J8: 四でないのに受けが I8 の1点に強制されている（そこは攻め手の長連点で五にできない）`
- 2 回目（`getFourDefensePosition` 修正前）: `21.K7 22.M7 23.N8 24.O8 25.J8: 四の受けが I8 の1点に強制されているが、そこは攻め手が打っても五にならない`
- 修正後: 緑

14 石の全木（perf）でも緑。メインラインは修正前後で変わらず

```
15.L7 16.M6 17.J7 18.I6 19.L8 20.L6 21.M8 22.N8 23.K10 24.N7 25.L11 26.L10 27.M12
```

で、木全体（攻め手ノード 39 個）に長連前提の強制受けは無くなった。
`22.I8` / `20.I8` という受け自体は 2 箇所に残るが、そのサブ局面では I8 が
本物の五点であり不変条件を満たす（8 行目の並びが異なる）。

### 不変条件の設計メモ

当初は「受けが 1 点だけの攻め手ノードは四でなければならない」という強い条件にしたが、
**これは成り立たない**ことが分かった。`findVCTSequenceRecursive` は受け手自身が
カウンター脅威を作る場合（`checkDefenseCounterThreat` が win/four/three）を VCF 経路で
処理し、その受けを木の `defenses` に記録しない。つまり木に記録された受けは
`getThreatDefensePositions` の結果の**部分集合**であり、三の攻め手でも記録上 1 点に
なりうる。そこで攻め手の強さで場合分けした。

- 攻め手が**四**なら、受けの 1 点は「攻め手がそこに打つと本当に五になる点」でなければ
  ならない（四の受けは五点を塞ぐ以外にありえないので厳密に成り立つ）。
  → `getFourDefensePosition` 経路を押さえる。
- 攻め手が**四でない**なら、受けの 1 点は少なくとも攻め手の長連点であってはならない。
  → `getThreatDefensePositions` 経路を押さえる。部分集合問題があるのでこちらは弱い条件。

実例: `21.K7 22.M7 23.N8 24.M8 25.M9` の M9 は活三で受けは J6 と N10 の 2 点あるが、
N10 はカウンター脅威扱いで木に載らず J6 だけが記録される。

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
| 修正後 | 39.6 秒 |

受けの選択肢が増えて探索木が広がるため約 6 倍に増えた。**正しさのための必要コスト**
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
| 修正後 | 22,289ms |

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
- `src/logic/cpu/search/threatPatterns.ts` の `findDefenseForJumpFour` /
  `findDefenseForConsecutiveFour` — `getFourDefensePosition` の修正で呼び出し元が
  無くなり、`index.ts` からの再 export だけが残った。**古い（誤った）基準のまま**なので
  そのまま使うと同じバグを踏む。#43 の流れで削除するのが筋。

#121 に追記すべき事項:

- `zig/src/threats.zig` の `getOpenThreeDefensePositions` が黒の長連点（今回の I8）を
  受け点に含めている。白 I8 は三を止めていないので、安全側ではあるものの
  探索木が無駄に広がるうえ、UI に誤った受け分岐が出る。
- TS の `src/logic/cpu/search/vctHelpers.ts` の `getThreatDefensePositions` は
  呼び出し元ゼロの dead export。#43 の流れで削除するのが筋。

### カウンターフォー起因の偽 VCT

上記「カウンターフォーによる偽 VCT の疑い」を参照。別 issue 化予定（番号未採番）。
