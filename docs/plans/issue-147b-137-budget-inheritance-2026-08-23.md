# #147-B / #137 設計メモ: 入れ子 limiter の予算継承と threatProbe 予算の較正（2026-08-23、オーケストレータ作成）

## 背景

- #151（A）で絶対デッドライン（1 手 10s の天井）は保証された。
- 残る「予算復活」: `findVCFSequence` / `findVCTSequence` / `hasVCF` などのエントリが **自前の limiter を `start_time = now` で作る**ため、親（threatProbe の 50ms、pre-search VCT 300ms）の中で子が呼ばれるたびに予算が復活する（実測: probe 50ms → 最大 141ms、pre-search VCT 300ms → 494ms）。`mise_vcf.zig` の 2 箇所は壁時計無制限。
- threatProbe VCT が hard の思考時間の 50〜90% を占める（g3 の 36 局面で「10s フル使用」が 47%、大半が probe VCT）。`vct_nodes` は #136 で 0（無制限、時間のみ）。これは #137 の較正対象。

## 方針

### B. 予算は継承し、復活させない（本 PR の本体）

- 原則: **子 limiter の壁時計予算は親の残り時間を超えない**。子が独自の小予算（例: probe 50ms）を持つ場合は `min(独自予算, 親の残り)`。
- 実装案（どれか、実装者が既存 API を見て選ぶ。SSoT を保つこと）:
  1. `TimeLimiter` に `pub fn child(self, own_budget_ms: u32, own_max_nodes: u32) TimeLimiter` を追加し、`start_time = now`、`time_limit = min(own_budget_ms, self.remainingMs())`（親が無制限なら own のまま）、`max_nodes = own or remainingNodes`。全ての「子 limiter を作る箇所」（vct.zig の内部 VCF 呼び出し、probe、pre-search の VCF/VCT、mise_vcf の 2 箇所）でこれを使う。
  2. エントリ関数（`findVCFSequence` 等）に親 limiter を渡すオーバーロード（`…WithLimiter`、#136 で `findVCTSequenceWithLimiter` はある）を増やし、自前 limiter を作らない。
- `mise_vcf.zig` の壁時計無制限 limiter 2 箇所も親の残りを継承。
- **探索の中身が変わる**（probe が 50ms で本当に止まる、pre-search が 300ms で止まる）→ Elo は commit-bench で確認（下記）。

### #137 プローブ（較正の第 1 手、本 PR には含めない）

- B の上に **1 コミットだけ** `getThreatBudget` の `vct_nodes` を 0 → 50_000 にした枝 `probe/issue-137-vct-nodes-50k` を作る（PR にしない、bench 用）。
- bench 計画（オーケストレータが実行）: (1) development(#151 後) vs PR-B head、(2) PR-B head vs probe 枝。各 416 局・r0.02・jobs=5。
- 判断: (2) が中立なら `vct_nodes=0` のまま #137 クローズ（時間のみで十分）、有意に正なら較正を続ける。

## 不変条件・テスト（Zig、先に赤）

1. 親 limiter が残り 30ms のとき、`child(50ms)` の `time_limit` は 30ms（`deadline.test_now_ms` を進めて確認）。親無制限なら 50ms。
2. probe（`threatProbe` の VCT/VCF）が親の残り時間を超えない（擬似時計で「親の残り 10ms で子が 10ms 後に打ち切る」）。
3. `findVCTSequence` を直接呼ぶ振り返り経路（親なし）は不変（`reviewSnapshot` 無変化）。
4. 既存テスト全緑。

## リスク

- probe の実効予算が減る（141ms→50ms）ので対局の VCT 検出が減り弱くなる可能性／逆にメイン探索に時間が戻り強くなる可能性。bench で判断。負なら probe 予算値の方を引き上げる（#137 の較正問題として扱う）。

## 成果物

- `docs/plans/issue-147b-137-budget-inheritance-2026-08-23.md` としてこのメモを保存しコミット。
- PR-B（base development、`Refs #137`、#147 の B 部分である旨）。probe 枝は push のみ（PR なし）。
