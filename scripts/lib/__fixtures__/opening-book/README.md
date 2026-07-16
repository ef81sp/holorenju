# オープニングブック開発用フィクスチャ

`trap-mining.ts --dump-book` の軽量実行（浦月ルート1本、1コア、数十秒）で生成した
実データ。`buildOpeningBook.test.ts` / `verifyBookBlocksTraps.test.ts` が、
テストコード内で組み立てた合成ノードだけでなく、実際のダンプ形式ファイルを
読み込む経路もカバーするために使う。

**権威資産（`src/assets/opening-book-hard.json`）とは無関係**。あちらは
`--dump-book` の権威フル実行（全26珠型+珠型外ルート、実機タイムリミット）から
生成する本番資産。

## ファイル

- `dump.jsonl`: `--dump-book` の出力（メタデータ行 + white4/6/8 ノード16件）。
  うち2件がトラップ（VCF/VCT検出・検証済み生存手あり）。
- `severity-a.jsonl`: 同じ実行の `--out`（severity-A トラップレコード2件）。
  `dump.jsonl` の2トラップノードと同一の canonicalKeyPly8 を持つ
  （= このフィクスチャから構築したブックで `verify-book-blocks-traps.ts` を
  実行すると封鎖できるはず、という対応関係がある）。
- `dump-black.jsonl`: 黒番採掘の権威実行（`bench-results/opening-book-dump-black.jsonl`、
  非公開）から、severity-A になった1トラップノードだけを抜粋したもの
  （黒ダンプ全体は焼き込まない方針のため、フィクスチャも最小限に絞っている）。
- `severity-a-black.jsonl`: 対応する黒番severity-Aレコード1件
  （`bench-results/opening-traps-black-run1.jsonl` のコピー）。

## 再生成コマンド

```bash
node --experimental-strip-types --import ./scripts/register-loader.mjs \
  scripts/trap-mining.ts --roots=浦月 --b5=3 --b7=4 --jobs=1 --hard-time=800 \
  --dump-book=scripts/lib/__fixtures__/opening-book/dump.jsonl \
  --out=scripts/lib/__fixtures__/opening-book/severity-a.jsonl
```

シードは `trap-mining.ts` の既定値（20260716）固定だが、hard の探索結果自体は
wasm ビルドやコード変更で変わり得るため、完全な再現性は保証しない
（テストは特定の手の値ではなく構造的な性質を検証している）。

`dump-black.jsonl` / `severity-a-black.jsonl` は黒番採掘の権威実行（マシン専有・
数時間）の成果物からの抜粋のため、同じ手順で軽量に再生成することはできない。
黒番採掘スクリプト自体が再実行された場合は、新しい severity-A レコードと
対応するダンプノードを手動で抜粋し直すこと。
