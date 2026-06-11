# 連珠CPU強化ロードマップ（機械学習なし）

> 生成: 2026-06-10。Rapfi（世界最強格エンジン）を解析オラクルに使い、自己対局を採点して
> 抽出した **検証済み blunder 46件** と、Zig/WASM 実装（探索/評価/VCF/VCT/quiescence/着手順序）の
> コード精読を、多エージェント・ワークフロー（理解→分類→診断→敵対的検証→統合）で統合した結果。
> ツール: `scripts/rapfi/`（`rapfiClient.ts` / `mineBlunders.ts` / `forbiddenParity.ts` / `strengthWorkflow.mjs`）。

## blunder 分類（検証済み46件 / verifiedDrop 614–3069）

| カテゴリ                            | 件数 | 備考                                                               |
| ----------------------------------- | ---- | ------------------------------------------------------------------ |
| eval-misjudgment（位置評価誤り）    | 30   | 最多。ただし新評価軸は Phase B(`line_potential`)と共線で相殺リスク |
| allowed-opponent-threat（受け落ち） | 8    | 二重活三の受け落ち                                                 |
| missed-tactical-win（攻め見落とし） | 6    | 四三絡みのテンポ割引が原因                                         |
| horizon-quiescence（水平線/TT汚染） | 1    | 件数は少ないが**探索全域を汚染する上流バグ**                       |
| hallucinated-win（幻勝ち）          | 1    | TT汚染の症状。単体修正は reject                                    |

## 大原則（過去の失敗を踏まえる）

- **1コミット1施策**。`1fa2668`（PVS+Counter-move+Threat Extension+Score Verification の4機能混在）が main 比 **Elo +44.5 弱体化**の犯人で、個別原因の切り分けを不能にした轍を踏まない。
- **評価軸の追加は最後**。`project_eval_axis_redundancy.md` の通り、新評価軸は Phase B(`line_potential`)と情報重複して相殺・悪化する。上位施策は**評価軸を増やさず、既存の探索バグ・マスクバグを正す**ものを優先。
- **検証は `commit-bench` r0.02 × 8セット(416局)**。対局CPU直結の変更は必ず Elo 測定。r0.05/単一データ点は不可。
- **VERIFY_INCREMENTAL parity**（`incremental_eval.zig:338` の bulk vs incremental 完全一致 Debug assert）を評価系変更の安全網にする。

## 優先度付き施策リスト（影響 × 労力）

| #     | 施策                                                             | 影響   | 労力   | 独立性 | 回帰    | verdict       | 順位根拠                                                        |
| ----- | ---------------------------------------------------------------- | ------ | ------ | ------ | ------- | ------------- | --------------------------------------------------------------- |
| **1** | **TT の perspective/ply 汚染修正**                               | high   | medium | OK     | medium  | revise→再設計 | 探索全域を汚染。幻勝ちの上流。評価軸非依存                      |
| **2** | **VCT 受け点の過少列挙修正（夏止め欠落）**                       | high   | low    | OK     | low-med | severity:high | 幻勝ちVCTを`FIVE-20`で即指し＝自滅手の直接原因。1関数統一       |
| **3** | **必須防御マスクの「全活線カバー」化（再設計）**                 | high   | medium | OK     | high    | revise        | 二重活三の受け落ち。「両止め強制」は誤り→反撃テンポ許容で再設計 |
| 4     | テンポ割引の四三絡み免除（`incremental_eval.zig`）               | medium | medium | 要検証 | medium  | revise        | 攻め見落とし。四三ボーナス二重計上の回帰テスト必須              |
| 5     | VCT カウンターフォー耐性の全分岐検証（PV一本道→AND全分岐）       | high   | high   | OK     | medium  | severity:high | 非PV分岐の幻勝ち。労力高                                        |
| 6     | VCF の四四を防御不能=勝ち扱い（`getFourDefensePosition`）        | medium | low    | OK     | low     | severity:high | 四四勝ち取りこぼし。安全側                                      |
| 7     | NMP/Futility を専用フラグに分離（`enable_counter_four`流用解消） | medium | low    | OK     | low     | severity:high | チューニング阻害解消。施策1-4の前提整備                         |
| 8     | リーフ中央性/接触ブロックペナルティ                              | medium | medium | **NG** | medium  | revise        | 30件と最多だが Phase B と共線。block-penalty 単体のみ条件付き   |
| 9     | History/Counter/Killer の色区別・ply管理                         | medium | medium | OK     | low     | medium-high   | 着手順序のノイズ。探索効率                                      |
| 10    | Aspiration の非対称再探索・ルートPVS                             | medium | medium | OK     | low     | medium        | 到達深度改善。効果はベンチ次第                                  |

**除外**: 施策8(1)リーフ中央性移設は独立性NG・Phase B共線で棄却（block-penalty が有意な場合のみ条件付き）。allowed-opponent-threat 元案の `can_win_first` バイパス無効化は連珠的に誤り（反撃テンポを枝刈り）のため撤回。

---

## 上位3施策の詳細

### 施策1: TT の perspective/ply 汚染修正

**対象**: `zig/src/zobrist.zig:5,68-86` / `zig/src/tt.zig:76-120`（probe/store） / `zig/src/minimax.zig:380-389`（probe後 `return entry.score`）, `:417-421`（threat probe の `FIVE-1 .exact` store）, `:365-370`（終端五連 ±FIVE return） / `zig/src/scores.zig`（`MATE_THRESHOLD`/`isMateScore` 追加）

**変更内容**

1. **手番混入の解消（主犯）**: `computeBoardHash`/`updateHash` は石配置のみで side-to-move を含まず、`global_tt` は探索ごとに clear せず `newGeneration()` のみ。→ **side-to-move 用 Zobrist キーを追加し手番で XOR**。「脇手が near-win を継承し ourScore 6292 級に膨張」の整合的機序。
2. **ply 補正（副犯）**: `scores.zig` に `MATE_THRESHOLD = FIVE-100`/`isMateScore`。`tt.store` に `ply` 引数を足し、保存前に詰みスコアを `±ply` で root基準→ノード基準へ正規化、probe 返却時に逆補正。threat probe の `FIVE-1`・終端 ±FIVE・通常 store/return をすべて補正経路に。
3. **`.exact` 撒きすぎ対策（別コミット）**: threat probe が `FIVE-1` を常時 `.exact` で撒くのが汚染を増幅。lower/upper-bound 化を検討。

**最初に書く TDD テスト（Red から）**

```
test "TT round-trip preserves mate distance over ply 0..8"
test "side-to-move separates TT entries"（同石配置の黒手番 FIVE-1 が白手番 probe でヒットしない）
test "horizon id=10 reproduction"（白 I7J7K7 × I5I6I7 交差盤で脇手 G6 を near-win で返さない）
```

**回帰リスクと検証**: medium。`commit-bench` r0.02 × 8セット必須。既存 VCF 詰み局面で**最短手順を選ぶ**回帰テスト併設。手番分離と ply補正は**別コミット・別ベンチ**で切り分ける。

**TS-Zig 二重実装**: 影響なし（探索スコア簿記のみ。`forbidden`/`renjuRules` 非干渉。TS探索はWASM専用化済み）。

### 施策2: VCT 受け点の過少列挙修正（夏止め欠落）

**対象**: `zig/src/vct.zig:365-370`（`getThreatDefensePositions` が活三に `getLineEnds`＝両端2点のみ）→ 統一先 `zig/src/threats.zig:134` `getOpenThreeDefensePositions`（夏止め点を含む。`mise_vcf.zig:141`・`threats.zig:570` は既にこちらを使用）

**変更内容**: VCT の活三受け列挙を `getLineEnds` → `getOpenThreeDefensePositions` に統一。VCT は「全受けが VCT に繋がる(AND)」で勝ち判定するため、**夏止めを見落とすと「全受け→勝ち」を誤成立**させ `search.zig:187` が `FIVE-20` で即指し→自滅。受けを**広げる**＝誤った勝ち証明が減る安全方向。

**最初に書く TDD テスト**

```
test "VCT defense enumeration includes 夏止め"（getThreatDefensePositions == getOpenThreeDefensePositions）
test "false-VCT rejected when 夏止め defends"
```

**回帰リスクと検証**: low-medium。受けを広げるため「成立していた正当な VCT が不成立化」しないか既存 VCT テスト全緑を確認。`commit-bench` r0.02 × 8セットで自滅手減少＝Elo改善を測定。

**TS-Zig 二重実装**: VCT/脅威ヘルパは `renjuParity`（禁手）対象外。TS二重実装なし。

### 施策3: 必須防御マスクの「全活線カバー」化（再設計版）

**対象**: `zig/src/threats.zig:570-577`（防御点を `addUniqueList` で単一 union 合流） / `zig/src/position_eval.zig:339-340`（`contains` union判定） / `zig/src/move_order.zig:236-238`（lazy 経路の `defense_bitmap`）

**変更内容（verdict の再設計を反映）**: 元案「全グループ防御点に含まれなければ -1000000」は**連珠的に誤り**——独立2活三は1手で両止め不能が普通で、正着はしばしば**自分の四による反撃(テンポ)**。枝刈りすると新たな受け落ちを生む。よって:

1. 活三を**グループ単位**で保持（union 温存＋`OpenThreeGroup{defenses}` 配列）。
2. マスク判定を「候補手が**全グループを止める** OR **同等以上に速い反撃（自分の四/活四/四三）を持つ**」に変更。反撃手は非ペナルティ。
3. **`can_win_first` バイパスは維持**（元案の無効化は撤回）。
4. lazy 経路の再計算コストは設計で解決（評価関数内ローカル計算に閉じ込め、bridge エンコードに新フィールドを足さない）。

**最初に書く TDD テスト**

```
test "二重活三で片方だけ止め＋反撃なしの手は -1000000"
test "両活三を1手で止める急所は非ペナルティ"
test "自分の四による反撃手は二重活三下でも非ペナルティ"  ← 元案の欠陥を防ぐ要
test "id=23/28 再現"（放置手を返さず Rapfi 防御点 F9/I12系 を選ぶ）
```

**回帰リスクと検証**: **high**（必須防御は対局CPU直結）。`commit-bench` r0.02 × 8セット必須。被覆判定のみを最小単位で入れ、`can_win_first` 速度比較や構造拡張は別フェーズ。

**TS-Zig 二重実装**: 必須防御マスクは `position_eval.zig`(Zig) と `src/logic/cpu/evaluation/patternScores.ts`(TS) の二重実装で評価パリティ領域。被覆判定を**評価関数内ローカル計算に閉じ込め** precomputed_threats の bridge に新フィールドを足さない。パリティテストでランダム盤面の必須防御マスク一致を検証してドリフト防止。

---

## 次の一手（ワークフロー推奨）

**施策2「VCT 受け点の夏止め欠落修正」**。理由: 自滅手の直接原因で影響 high、1関数統一で最低労力、受けを広げる安全方向、評価軸非依存、TS二重実装なしで Zig 片側完結。TDD を Red から始めやすい。施策1（TT汚染）は影響最大だが手番分離＋ply補正の2フェーズで労力medium・回帰mediumのため、施策2のクイックウィン直後に着手。

## 実装者向けの留意（人間レビュー必須）

- **施策1の「Zobrist に手番ビットが無い」汚染**は、盤面の石数パリティで手番が一意に決まるため、通常の局面遷移だけでは同一ハッシュ×異手番は生じない。**null move（NMP のパス）が同一盤面・異手番を作る**のが主トリガと考えられる。修正（手番ビット追加）は標準的に正しいが、**汚染の実トリガを実装時に再現テストで確認**すること（施策7のフラグ分離・NMP 挙動と関連）。
- mining は medium 相当・Rapfi 700ms 採点。**最強設定(hard)での再マイニング**で blunder 分布が変わる可能性あり。
