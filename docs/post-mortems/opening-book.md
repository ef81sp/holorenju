# 定跡 DB (Opening Book) プロジェクト — 失敗記録

**期間**: 2026-04-22 〜 2026-05-10
**結論**: **アプローチ全体を破棄**。コード・データ・関連 UI を完全削除。

## 何をやろうとしたか

CPU の序盤候補手のスコア差が小さい（事実上 move-order 順で先着が決まる）問題に対し、オフラインで候補手ツリーを minimax 逆伝播した「定跡 DB」を構築する。目的は 2 つ:

1. **DB ビューア**: 学習者が起点局面の最善手 / 候補値を眺めて勉強する（主目的）
2. **CPU 強化**: 対局時に DB ヒットすれば即座に最善手を返す（副次）

## 実装したもの

- **Zig 側 (1 GB BSS TT)**: `opening_book.zig` (DFS + minimax + D4 対称性正規化), `opening_book_tt.zig` (open-addressing flat TT, 16B/entry, 64M capacity), `ob_terminal.zig` (VCT/VCF 早期打ち切り), `ob_leaf_eval.zig` (葉の評価値→i16 スケール)
- **WASM extern**: `obInit/obRunLoop/obGetStats/obQueryBestMove/obGetCandidates/obStoreEntry/obResumeWithDepth/obSetWinCheckParams/obGetTT*` 等
- **TS スクリプト群**: `scripts/opening-book/{builder,deepen,merge,inspect,export,verify-vs-ab,checkpoint}.ts` + bookFile/bookReader/bookWriter
- **GUI ビューア**: 単体 DB / family（雲月の 4 分岐をまとめて表示）対応
- **真の反復深化**: BookEntry に `depth_reached` を埋め、既存 entries は深度十分なら再計算しない仕組み
- **チェックポイント機構**: chunked 実行 + SIGINT graceful shutdown
- **構築実績**:
  - 雲月 (3-stone) C=5 K=10〜13、雲月-keima C=5 K=10〜13
  - 雲月 4 手目別 (h7/j8/g8/h9) C=3 K=17

## なぜ失敗したか（複合要因）

### 1. 評価軸の誤り（致命的）

完成した DB が **「桂馬挟み (H9) は白の悪手」** という結果を返した。連珠の伝統的定石では「桂馬挟みは白の最強防御」とされるため、明らかに評価が間違っている。

原因の有力な仮説:

- **C=3 が狭すぎる**: 桂馬挟み後の局面は「黒の繊細な活三防御 + 白の正確なカウンター」が成立する筋で、C=3 だと白の正解防御手が top-3 に入らず溢れ、黒視点で過大評価される
- **VCT/VCF 早期打ち切りパラメータが緩い** (`max_nodes=300`): 白が防げる筋を「黒勝ち確定」と誤判定
- **評価関数自体のバイアス**: minimax の葉値は CPU の評価関数なので、評価関数の既知のバイアス（特に Phase B 評価軸の冗長性、水平線効果）がそのまま minimax 値に伝播する

### 2. 主目的との不適合（イシューレビュワー指摘）

学習者が見たいのは「**プロの着手傾向 + 定石の意味**」であって、深度 13-17 の minimax 値ではない。学習用途には Rapfi / RenjuNet / RenLib の公開棋譜から頻度統計を取る方が桁違いに安く、価値も高い。**minimax DB は主目的にオーバースペック、副次の CPU 強化でこそ真価を発揮する位置付けだったが、その CPU 強化効果も評価軸の誤りで実証できない**。

### 3. スケーラビリティ破綻

- 雲月 K=13 で 62 M entries / 1 GB TT の 97% 満載
- 連珠の珠型は全 26 種。1 珠型 50M × 26 = 20 GB → 1 GB WASM TT に乗らない
- merged ファイルは設計段階で破綻していた（97% 満載 TT への 38M 件 obStoreEntry が 7 時間ハング = 設計バグ）
- 「hash 下位 1bit で 2 TT 振り分け」案は対症療法（4bit, 8bit と増やす羽目になる）

### 4. WASM32 の物理制約

- LEB128 varint32 が 2 GB を encode できないため TT を 1 GB 超に拡張不可
- WASM linear memory 4 GB 上限のうち実用 1-2 GB

## 学び

- **新規 DSL/データ構造を作る前に「主目的に対する妥当性」を冷徹に確認**する。「あったら便利そう」では着手しない
- **評価軸（minimax の葉値）の信頼性は CPU 評価関数の信頼性以下** の事実を軽視していた
- **フィージビリティ検証は最小スコープで**: C=5 K=10 が動いた時点で「これで運用できるか」「学習価値があるか」を Elo 測定や DB 内容の伝統定石照合で検証すべきだった
- **「26 珠型に展開する想定だと破綻するか」のスケーラビリティは MVP 着手前に試算すべき**
- イシューレビュワーの「そもそも論」は実装が進んだ後でも傾聴すべき価値があった

## もし将来この方向を再開するなら

- 評価源を CPU の minimax ではなく **公開棋譜の頻度統計** に切り替える
- 1 珠型 = 1 ファイル + manifest による on-demand ロード（merge 廃止）
- DB 値を伝統定石と突き合わせる **校正テスト**を MVP に含める
- C を可変にする（root 付近で広く、深部で狭く）
- ただし「学習価値」を考えると最初から RenjuNet 棋譜統計から始める方が筋が良い

## 削除されたもの

- `zig/src/opening_book.zig`, `opening_book_tt.zig`, `ob_terminal.zig`, `ob_leaf_eval.zig`
- `zig/src/main.zig` の `obXyz` extern 群 + `opening_book` import
- `zig/build.zig` の関連 test
- `scripts/opening-book/` 一式
- `src/logic/openingBook/` 一式
- `src/components/pages/OpeningBookViewerPage.vue` + メニュー導線
- `src/stores/appStore.ts` の `openingBookViewer` scene
- `src/constants/sceneTitles.ts` のエントリ
- `src/logic/cpu/wasm/types.ts` の `obXyz` メソッド群
- `package.json` の `ob:*` scripts
- `bench-results/opening-books/*.book` (合計 ~10 GB)
