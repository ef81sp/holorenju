# ScenarioPlayer

シナリオ学習の中核コンポーネント。連珠の戦略をキャラクターの会話を通じて学ぶ「デモモード」と、実際に石を配置して問題を解く「問題モード」を提供する。

## 概要

- **デモモード**: キャラクターの会話に合わせて盤面が変化し、戦略を解説
- **問題モード**: ユーザーが正解の位置に石を配置する問題を出題

## コンポーネント構成

```mermaid
graph TD
    SP[ScenarioPlayer.vue] --> BB[BackButton]
    SP --> SC[SettingsControl]
    SP --> CI[ControlInfo]
    SP --> SIP[ScenarioInfoPanel]
    SP --> RB[RenjuBoard]
    SP --> CO[CutinOverlay]
    SP --> DS[DialogSection]
```

### レイアウト（CSS Grid）

```
┌─────────────┬───────────────┬─────────────┐
│  control    │    board      │    info     │
│  (4fr)      │    (7fr)      │    (5fr)    │
│             │               │             │
│  BackButton │  RenjuBoard   │  Scenario   │
│  Settings   │  CutinOverlay │  InfoPanel  │
│  ControlInfo│               │             │
├─────────────┴───────────────┤             │
│      dialog (11fr)          │             │
│      DialogSection          │             │
└─────────────────────────────┴─────────────┘
```

## Composables

| Composable              | 役割                                        |
| ----------------------- | ------------------------------------------- |
| `useScenarioNavigation` | シナリオ読み込み、セクション/ダイアログ移動 |
| `useKeyboardNavigation` | WASD カーソル移動、Space/Enter で石配置     |
| `useQuestionSolver`     | 問題の正誤判定、フィードバック表示          |
| `useCutinDisplay`       | ○/× カットインの表示・自動消滅管理          |
| `useBoardSize`          | ボードフレームサイズの監視・計算            |
| `problemConditions`     | 成功条件（position/pattern/sequence）の評価 |

## 関連ストア

| Store                    | 役割                                   |
| ------------------------ | -------------------------------------- |
| `boardStore`             | 盤面状態（stones がSSoT）              |
| `scenarioAnimationStore` | 石・マーク・ラインのアニメーション制御 |
| `dialogStore`            | キャラクターのセリフ表示               |
| `progressStore`          | 学習進捗の記録                         |
| `appStore`               | 画面遷移                               |

## データフロー

### シナリオ読み込み

```mermaid
sequenceDiagram
    participant SP as ScenarioPlayer
    participant Nav as useScenarioNavigation
    participant BS as boardStore
    participant DS as dialogStore

    SP->>Nav: loadScenario()
    Nav->>Nav: JSONファイル読み込み
    Nav->>Nav: allDialogues構築
    Nav->>BS: setBoard(initialBoard)
    Nav->>Nav: showIntroDialog()
    Nav->>DS: showMessage(dialogue)
```

### ダイアログナビゲーション（デモモード）

```mermaid
sequenceDiagram
    participant User
    participant Nav as useScenarioNavigation
    participant BS as boardStore
    participant AS as scenarioAnimationStore
    participant DS as dialogStore

    User->>Nav: nextDialogue()
    Nav->>AS: cancelOngoingAnimations()
    Nav->>Nav: セクション境界チェック
    alt セクション変更あり
        Nav->>BS: setBoard(newInitialBoard)
        Nav->>BS: clearMarks/Lines
    end
    Nav->>DS: showMessage(dialogue)
    Nav->>AS: prepareForAnimation(ids)
    Nav->>BS: addStones/addMarks/addLines
    Nav->>AS: animateStones/Marks/Lines
    Nav->>Nav: saveBoardSnapshot()
```

### 問題解答フロー

```mermaid
sequenceDiagram
    participant User
    participant SP as ScenarioPlayer
    participant QS as useQuestionSolver
    participant BS as boardStore
    participant DS as dialogStore

    User->>SP: クリック/Enter
    SP->>QS: handlePlaceStone(position)
    QS->>BS: setBoard(newBoard)
    QS->>QS: checkAllConditions()
    alt 正解
        QS->>SP: onShowCorrectCutin()
        QS->>DS: showMessage(successFeedback)
        QS->>SP: onSectionComplete()
    else 不正解
        QS->>BS: setBoard(attemptBaseBoard)
        QS->>SP: onShowIncorrectCutin()
        QS->>DS: showMessage(failureFeedback)
    end
```

## SSoT（Single Source of Truth）

盤面状態は`boardStore.stones`をSSoTとして管理。`board`は`stones`から computed で導出される。

```mermaid
flowchart LR
    subgraph boardStore
        stones["stones: Stone[]<br>(SSoT)"]
        board["board: BoardState<br>(computed)"]
        stones --> board
    end
    subgraph 外部
        Nav[useScenarioNavigation]
        QS[useQuestionSolver]
        RB[RenjuBoard]
    end
    Nav -->|addStones/setBoard| stones
    QS -->|setBoard| stones
    board -->|参照| RB
```

## キャッシュ機構（boardCache）

ダイアログを戻る操作を高速化するため、各ダイアログ時点の盤面スナップショットをキャッシュ。

```
boardCache: Map<sectionIndex, Map<dialogueIndex, BoardSnapshot>>

BoardSnapshot {
  stones: Stone[]         // 石のリスト（SSoT）
  marks: Mark[]           // マークのリスト
  lines: Line[]           // ラインのリスト
  descriptionNodes: TextNode[]  // 説明文
}
```

- **保存タイミング**: `nextDialogue()`完了後、`showIntroDialog()`完了後
- **復元タイミング**: `previousDialogue()`時にキャッシュがあれば使用
- **クリアタイミング**: `loadScenario()`時
