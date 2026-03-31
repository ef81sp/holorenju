# 連珠戦術知識ベース

連珠（Renju）の戦術・定石・パターン認識に関する知識を体系的にまとめたドキュメント集です。
CPU AIアルゴリズムの改善や、学習シナリオの作成に活用できます。

## 目次

| ファイル                                         | 内容                                 |
| ------------------------------------------------ | ------------------------------------ |
| [opening-patterns.md](opening-patterns.md)       | 26珠型と開局の知識                   |
| [tactics-vcf-vct.md](tactics-vcf-vct.md)         | VCF/VCT/ミセ手/フクミ手の戦術解説    |
| [forbidden-tactics.md](forbidden-tactics.md)     | 禁手を利用した白の戦術               |
| [pattern-recognition.md](pattern-recognition.md) | パターン認識（連・跳び三・跳び四等） |
| [evaluation-guide.md](evaluation-guide.md)       | 局面評価の考え方                     |

## 座標表記

- 15x15の盤面、左下が原点
- 列: A-O（左から右）、行: 1-15（下から上）
- 天元: H8
- 例: `H8 I9 G7` = 天元、右上、左下

## 関連ドキュメント

- `docs/renju-tactics-and-evaluation.md` — AI評価関数の実装詳細（本知識ベースに統合済み）
- `docs/cpu-ai-algorithm.md` — CPUアルゴリズム詳細
- `docs/rules/renju-forbidden-rules.md` — 禁手判定ルールの実装仕様
- `docs/rules/opening-rules-research.md` — 開局規定の調査レポート
