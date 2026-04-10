# CPU対戦・振り返り分析 - フローチャート集

> **注記**: TS時代のフローチャート。処理の概念フローは現行Zig版と共通だが、関数名は異なる。

CPU の着手選択ロジックと振り返り分析の全体像を Mermaid フローチャートで可視化したドキュメント。

---

## 1. CPU対戦 - 最善手算出フロー（全体）

```mermaid
flowchart TD
    Start([CPU手番開始]) --> Worker[Web Worker に盤面送信]
    Worker --> CountStones{石数チェック}

    CountStones -->|1〜3手目| Opening[珠型パターン検索<br/>26種の定石]
    Opening -->|該当あり| ReturnOpening([定石手を返す])
    Opening -->|該当なし| MainSearch

    CountStones -->|4手目以降| MainSearch[難易度パラメータ取得]
    MainSearch --> IDTT[findBestMoveIterativeWithTT<br/>反復深化探索]
    IDTT --> BuildResponse[候補手の内訳計算<br/>上位5手 + PV]
    BuildResponse --> Return([着手を返す])
```

### 難易度パラメータ一覧

| 難易度 | 深度 | 時間 | ランダム | ノード上限 | 有効な戦術               |
| ------ | ---- | ---- | -------- | ---------- | ------------------------ |
| 初級   | 2    | 1.5s | 25%      | 30K        | 必須防御のみ             |
| 初中級 | 2    | 2s   | 12%      | 100K       | + ミセ, カウンターフォー |
| 中級   | 3    | 5s   | 8%       | 200K       | + VCT, 枝刈り            |
| 上級   | 4    | 10s  | 0%       | 600K       | 全機能                   |

---

## 2. CPU対戦 - 事前チェック → 反復深化（詳細）

```mermaid
flowchart TD
    Entry([findBestMoveIterativeWithTT]) --> Init[初期化<br/>TT世代更新 / 禁手キャッシュクリア<br/>Zobristハッシュ計算 / ラインテーブル構築]
    Init --> PreSearch[findPreSearchMove<br/>事前チェックパイプライン]

    PreSearch --> Timeout{絶対時間<br/>超過?}
    Timeout -->|Yes| Fallback([緊急フォールバック<br/>候補手1位を返す])

    Timeout -->|No| WinCheck{五連完成<br/>可能?}
    WinCheck -->|Yes| ReturnWin([即勝ち手])

    WinCheck -->|No| DefCheck{相手の活四<br/>or 止め四?}
    DefCheck -->|Yes| MustDef{防御位置は<br/>禁手?}
    MustDef -->|No| ReturnDef([必須防御手])
    MustDef -->|Yes| ToSearch[通常探索へ]

    DefCheck -->|No| VCF{自分のVCF<br/>あり?}
    VCF -->|Yes| ReturnVCF([VCF開始手])

    VCF -->|No| OppVCF[相手のVCF探索]
    OppVCF --> OppMise[相手のミセ手チェック]
    OppMise --> MiseVCF{相手VCFなし<br/>かつ相手ミセ手なし<br/>かつMise-VCF<br/>あり?}
    MiseVCF -->|Yes| ReturnMise([Mise-VCF手])

    MiseVCF -->|No| VCTCheck{VCT有効<br/>かつ石数≥14?}
    VCTCheck -->|Yes| VCTHint[VCTヒント手<br/>取得]
    VCTCheck -->|No| ToSearch
    VCTHint --> ToSearch

    ToSearch --> GenMoves[候補手生成<br/>既存石の2マス以内]
    GenMoves --> Restrict{候補手<br/>制限あり?}
    Restrict -->|VCF防御| FilterVCF[カウンターフォー<br/>+ ブロック位置に制限]
    Restrict -->|活三防御| FilterOT[活三防御位置に制限]
    Restrict -->|なし| NoFilter[制限なし]

    FilterVCF --> ID
    FilterOT --> ID
    NoFilter --> ID

    ID[反復深化ループ<br/>depth = 1 → maxDepth] --> DepthLoop{各深度で<br/>探索}
    DepthLoop --> AW[Aspiration Windows<br/>で α-β 探索]
    AW --> AWCheck{ウィンドウ<br/>外?}
    AWCheck -->|Yes| FullWindow[フルウィンドウ<br/>で再探索]
    AWCheck -->|No| TimeCheck{時間/ノード<br/>残り?}
    FullWindow --> TimeCheck
    TimeCheck -->|Yes| NextDepth[depth++<br/>PVを先頭に移動]
    NextDepth --> DepthLoop
    TimeCheck -->|No| ReturnBest([最善手を返す])
```

---

## 3. CPU対戦 - Minimax探索（1ノード内部）

```mermaid
flowchart TD
    Entry([minimaxWithTT]) --> NodeCount[ノード数++]
    NodeCount --> Limits{時間/ノード<br/>上限超過?}
    Limits -->|Yes| StaticEval([静的評価を返す])

    Limits -->|No| Terminal{直前手で<br/>五連成立?}
    Terminal -->|Yes| ReturnFive([±FIVE スコア])

    Terminal -->|No| TTProbe{TTにエントリ<br/>あり?}
    TTProbe -->|EXACT + 十分な深度| ReturnTT([TTスコア])
    TTProbe -->|UPPER/LOWER| UpdateBounds[α/β境界を更新]
    TTProbe -->|なし| Continue
    UpdateBounds --> Continue

    Continue --> DepthZero{depth = 0?}
    DepthZero -->|Yes| BoardEval([盤面全体評価<br/>パターンスコア集計])

    DepthZero -->|No| NMP{Null Move<br/>Pruning 条件?<br/>depth ≥ 3, 脅威なし}
    NMP -->|Yes| NMPSearch[depth - 1 - 2 で探索<br/>パスしても十分なら枝刈り]
    NMPSearch -->|β cutoff| ReturnNMP([NMPスコア])
    NMPSearch -->|No cutoff| GenMoves
    NMP -->|No| GenMoves

    GenMoves[候補手ソート<br/>TT手 → Killer → 静的評価 → History]
    GenMoves --> MoveLoop{各候補手}

    MoveLoop --> FP{Futility<br/>Pruning?<br/>depth 1-3}
    FP -->|枝刈り| SkipMove[スキップ]
    SkipMove --> NextMove

    FP -->|通常| LMR{Late Move<br/>Reduction?<br/>moveIdx ≥ 3<br/>depth ≥ 3}
    LMR -->|Yes| ReducedSearch[depth-1-R で<br/>縮小探索]
    ReducedSearch --> ReducedCheck{αを超えた?}
    ReducedCheck -->|Yes| FullSearch[depth-1 で<br/>再探索]
    ReducedCheck -->|No| NextMove

    LMR -->|No| FullSearch
    FullSearch --> Recurse[再帰<br/>minimaxWithTT]

    Recurse --> ABCutoff{α-β<br/>cutoff?}
    ABCutoff -->|Yes| RecordKiller[Killer/History<br/>更新] --> TTStore
    ABCutoff -->|No| NextMove[次の候補手]
    NextMove --> MoveLoop

    MoveLoop -->|全手探索完了| TTStore[TTに格納<br/>EXACT/UPPER/LOWER]
    TTStore --> ReturnScore([スコアを返す])
```

---

## 4. 振り返り分析 - 全体フロー

```mermaid
flowchart TD
    Start([振り返り開始]) --> Parse[棋譜をパース]
    Parse --> Queue[評価キュー構築<br/>序盤3手を除く全手]
    Queue --> Pool[Workerプール初期化<br/>2〜8ワーカー]

    Pool --> Phase1[Phase 1: 並列評価]
    Phase1 --> Dispatch{キューに<br/>残りあり?}
    Dispatch -->|Yes| AssignWorker[空きWorkerに割り当て]
    AssignWorker --> WorkerEval[Worker: 1手を評価]
    WorkerEval --> OnResult[結果コールバック<br/>EvaluatedMove構築]
    OnResult --> Dispatch

    Dispatch -->|キュー空 + 全完了| VCTItems{needsVCTCheck<br/>の手あり?}
    VCTItems -->|Yes| Phase2[Phase 2: VCTチェック<br/>単一ワーカーで逐次実行]
    VCTItems -->|No| Done

    Phase2 --> VCTLoop{VCTキューに<br/>残りあり?}
    VCTLoop -->|Yes| VCTEval[vctCheckOnly=true で評価<br/>相手VCT探索]
    VCTEval --> VCTResult[forcedLossType更新]
    VCTResult --> VCTLoop
    VCTLoop -->|No| Done([完了<br/>GameReview構築])

    subgraph "Worker振り分けルール"
        direction LR
        Player[プレイヤー手] -->|isLightEval=false| FullEval[フル評価]
        CPU[コンピュータ手] -->|isLightEval=true| LightEval[軽量評価<br/>強制勝ち検出のみ]
        All[全手分析モード] -->|isLightEval=false| FullEval
    end
```

---

## 5. 振り返り分析 - 1手の評価（Worker内部・フル評価パス）

```mermaid
flowchart TD
    Entry([review.worker<br/>フル評価]) --> Reconstruct[moveIndex時点の<br/>盤面を再構築]

    Reconstruct --> OppThreats[相手の脅威検出<br/>活四・止め四チェック]
    OppThreats --> HasFour{相手に<br/>四あり?}

    HasFour -->|Yes| SkipFW[強制勝ち探索スキップ<br/>四を止めなければ即負け]
    HasFour -->|No| DoubleMise[両ミセ検出<br/>~5ms]

    DoubleMise --> VCFSearch[VCF探索<br/>depth16, 1.5s]
    VCFSearch --> FourThree{1手四三?}
    FourThree -->|Yes| FW_VCF[forcedWin = VCF]

    FourThree -->|No| DM_Check{両ミセ<br/>あり?}
    DM_Check -->|Yes| FW_DM[forcedWin = 両ミセ]

    DM_Check -->|No| LongVCF{長VCF<br/>あり?}
    LongVCF -->|Yes| FW_LVCF[forcedWin = VCF]

    LongVCF -->|No| MiseVCF[Mise-VCF探索]
    MiseVCF -->|あり| FW_MVCF[forcedWin = Mise-VCF]
    MiseVCF -->|なし| VCT{石数≥14?}
    VCT -->|Yes| VCTSearch[VCT探索<br/>depth6, 3s, 分岐収集]
    VCTSearch -->|あり| FW_VCT[forcedWin = VCT]
    VCTSearch -->|なし| NoFW[forcedWin = なし]
    VCT -->|No| NoFW

    SkipFW --> ForcedLoss
    FW_VCF --> ForcedLoss
    FW_DM --> ForcedLoss
    FW_LVCF --> ForcedLoss
    FW_MVCF --> ForcedLoss
    FW_VCT --> ForcedLoss
    NoFW --> ForcedLoss

    ForcedLoss[被必勝検出<br/>着手後の盤面で<br/>相手のVCF/Mise-VCF探索<br/>VCTはPhase 2に委譲]

    ForcedLoss --> Minimax[Minimax探索<br/>depth8, 15s, 2Mノード]

    Minimax --> FWRetry{minimaxがFIVE<br/>だがforcedWin<br/>未検出?}
    FWRetry -->|Yes| VCTRetry[VCT再探索<br/>閾値無視]
    FWRetry -->|No| Branch
    VCTRetry --> Branch

    Branch{forcedWin<br/>あり?}
    Branch -->|Yes| FWPath[強制勝ちパス<br/>→ 図6参照]
    Branch -->|No| NormalPath[通常パス<br/>→ 図7参照]
```

---

## 6. 振り返り分析 - 強制勝ちパス（候補手構築 + スコア算出）

```mermaid
flowchart TD
    Entry([強制勝ちパス]) --> BestScore["bestScore = FIVE (100,000)<br/>bestMove = forcedWin.firstMove"]

    BestScore --> EvalPlayed[実際の手を評価<br/>evaluatePlayedForcedWin]

    EvalPlayed --> PlayedCheck{実際の手 =<br/>最善手?}
    PlayedCheck -->|Yes| PlayedFIVE["playedScore = FIVE"]

    PlayedCheck -->|No| PlayedDM{実際の手は<br/>両ミセ手?}
    PlayedDM -->|Yes| PlayedFIVE

    PlayedDM -->|No| PlayedVCF{実際の手から<br/>VCF成立?}
    PlayedVCF -->|Yes| PlayedFIVE2["playedScore = FIVE<br/>+ VCFシーケンス記録"]

    PlayedVCF -->|No| PlayedVCT{石数≥14 かつ<br/>実際の手から<br/>VCT成立?}
    PlayedVCT -->|Yes| PlayedFIVE3["playedScore = FIVE<br/>+ VCTシーケンス記録"]
    PlayedVCT -->|No| PlayedMinimax["playedScore = minimax候補のスコア<br/>or (bestScore - 2000)"]

    PlayedFIVE --> BuildCands
    PlayedFIVE2 --> BuildCands
    PlayedFIVE3 --> BuildCands
    PlayedMinimax --> BuildCands

    BuildCands[候補手リスト構築]
    BuildCands --> FWCand["#1: 追詰開始手<br/>score=FIVE, PV=シーケンス"]
    FWCand --> MinimaxCands["#2〜: minimax上位5手<br/>重複排除"]
    MinimaxCands --> PlayedCand{実際の手が<br/>候補にある?}
    PlayedCand -->|追詰あり| UpdatePV[PVを追詰シーケンスで上書き]
    PlayedCand -->|なし| AddPlayed[候補に追加]
    PlayedCand -->|既存| Skip[そのまま]

    UpdatePV --> Verify
    AddPlayed --> Verify
    Skip --> Verify

    Verify[候補手事後検証<br/>verifyCandidates]
    Verify --> VerifyLoop{候補手を順に<br/>仮配置}
    VerifyLoop --> CheckLoss[checkCandidateForcedLoss<br/>相手の必勝手順を探索]
    CheckLoss -->|被必勝あり| Flag[opponentForcedWin<br/>フラグ付与]
    Flag --> VerifyLoop
    CheckLoss -->|安全| StopVerify[検証打ち切り]

    StopVerify --> Demoted{最善手が<br/>降格?}
    Demoted -->|Yes| FindSafe[安全な候補を検索<br/>安全度→スコア順]
    FindSafe --> SafeFound{安全な手<br/>あり?}
    SafeFound -->|Yes| UseSafe["bestMove = 安全な候補"]
    SafeFound -->|No| AllUnsafe["局面自体が被必勝<br/>forcedLossType 設定"]
    Demoted -->|No| ReturnResult

    UseSafe --> ReturnResult
    AllUnsafe --> ReturnResult
    ReturnResult([レスポンス返却])
```

---

## 7. 振り返り分析 - 通常パス（forcedWinなし）

```mermaid
flowchart TD
    Entry([通常パス]) --> BestFromMinimax["bestMove = minimax最善手<br/>bestScore = minimaxスコア"]

    BestFromMinimax --> PlayedLookup{実際の手が<br/>minimax候補に<br/>ある?}
    PlayedLookup -->|Yes| PlayedFromCand["playedScore = 候補のスコア"]
    PlayedLookup -->|No| PlayedPenalty["playedScore = bestScore - 2000<br/>（候補外ペナルティ）"]

    PlayedFromCand --> BuildCands
    PlayedPenalty --> BuildCands

    BuildCands["候補手リスト = minimax上位5手<br/>+ 実際の手（候補外なら追加）"]

    BuildCands --> Verify[候補手事後検証<br/>verifyCandidates<br/>（図6と同一ロジック）]

    Verify --> Demoted{最善手が<br/>降格?}
    Demoted -->|Yes| FindSafe[安全な候補を検索]
    FindSafe --> SafeFound{安全な手<br/>あり?}
    SafeFound -->|Yes| UseSafe["bestMove = 安全な候補"]
    SafeFound -->|No| AllUnsafe["局面自体が被必勝"]
    Demoted -->|No| Return

    UseSafe --> Return
    AllUnsafe --> Return

    Return([レスポンス返却])
```

---

## 8. 共通 - 被必勝検出（checkForcedLoss）

着手後の盤面で相手側から見た必勝手順を探索する。
CPU探索の事前チェック（図2）とは異なり、振り返り専用のパラメータで深く探索する。

```mermaid
flowchart TD
    Entry([checkForcedLoss<br/>着手後の盤面]) --> WhiteScan{相手は白?}
    WhiteScan -->|Yes| ScanWhite[白の四四/三三<br/>事前スキャン]
    ScanWhite --> VCF
    WhiteScan -->|No| VCF

    VCF[VCF探索<br/>depth16, 1.5s]
    VCF -->|あり + 禁手罠| ReturnFT(["type: forbidden-trap"])
    VCF -->|あり| ReturnVCF(["type: vcf"])

    VCF -->|なし| WhiteDF{白の四四<br/>あり?}
    WhiteDF -->|あり| ReturnDF(["type: double-four"])
    WhiteDF -->|なし| DM[両ミセ検出<br/>~5ms]

    DM -->|あり| ReturnDM(["type: double-mise"])

    DM -->|なし| MiseVCF[Mise-VCF探索<br/>depth12, 0.5s]
    MiseVCF -->|あり| ReturnMise(["type: mise-vcf"])

    MiseVCF -->|なし| WhiteDT{白の三三<br/>あり?}
    WhiteDT -->|あり| ReturnDT(["type: double-three"])

    WhiteDT -->|なし| VCTGate{石数≥14<br/>かつ skipVCT<br/>でない?}
    VCTGate -->|Yes| VCTSearch[VCT探索<br/>depth6, 10s]
    VCTSearch -->|あり| ReturnVCT(["type: vct"])
    VCTSearch -->|なし| ReturnNone([被必勝なし])
    VCTGate -->|No| ReturnNone
```

---

## 9. 振り返り分析 - 品質分類と精度算出

```mermaid
flowchart TD
    Entry([Worker結果]) --> ScoreDiff["scoreDiff = bestScore - playedScore"]

    ScoreDiff --> Classify{"|scoreDiff| の値"}
    Classify -->|= 0| Excellent[最善手]
    Classify -->|≤ 80| Good[好手]
    Classify -->|≤ 300| Inaccuracy[疑問手]
    Classify -->|≤ 1000| Mistake[悪手]
    Classify -->|> 1000| Blunder[大悪手]

    Excellent --> DMCheck{missedDoubleMise<br/>あり?}
    DMCheck -->|Yes| Downgrade[好手に降格<br/>両ミセ見逃し]
    DMCheck -->|No| Final

    Good --> Final
    Inaccuracy --> Final
    Mistake --> Final
    Blunder --> Final
    Downgrade --> Final

    Final[EvaluatedMove構築]
    Final --> Aggregate[全プレイヤー手を集計]
    Aggregate --> Accuracy["精度 = (最善手+好手) / 全手 × 100%"]
    Aggregate --> Errors["重大エラー = 悪手 + 大悪手 の件数"]
    Accuracy --> Review([GameReview])
    Errors --> Review
```

---

## 主要ファイル一覧

| ファイル                                               | 役割                               |
| ------------------------------------------------------ | ---------------------------------- |
| `src/logic/cpu/cpu.worker.ts`                          | CPU対戦Worker（エントリポイント）  |
| `src/logic/cpu/search/iterativeDeepening.ts`           | 反復深化 + 事前チェック            |
| `src/logic/cpu/search/minimaxCore.ts`                  | α-β探索コア                        |
| `src/logic/cpu/search/vcf.ts`                          | VCF（四追い）ソルバー              |
| `src/logic/cpu/search/vct.ts`                          | VCT（追い詰め）ソルバー            |
| `src/logic/cpu/search/miseVcf.ts`                      | Mise-VCF（ミセ四追い）ソルバー     |
| `src/logic/cpu/evaluation/patternScores.ts`            | パターンスコア定数                 |
| `src/logic/cpu/evaluation/threatDetection.ts`          | 脅威検出                           |
| `src/logic/cpu/evaluation/tactics.ts`                  | 両ミセ検出                         |
| `src/logic/cpu/review.worker.ts`                       | 振り返りWorker（エントリポイント） |
| `src/logic/cpu/review/forcedLossCheck.ts`              | 被必勝検出（SSoT）                 |
| `src/logic/reviewLogic.ts`                             | 品質分類・精度算出                 |
| `src/components/cpu/composables/useReviewEvaluator.ts` | Workerプール管理                   |
| `src/logic/cpu/opening.ts`                             | 珠型パターン（26定石）             |
