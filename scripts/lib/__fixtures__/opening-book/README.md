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
