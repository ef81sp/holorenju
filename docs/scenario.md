# シナリオ再設計

## 要件

- デモパートと問題パートがある
  - デモパートでは、
    - 説明が行われる
    - 会話に合わせて自動的に盤面が更新されていく(ユーザーは操作できない)
    - 会話は自分で進めたり戻したりできる(アドベンチャーゲーム的)
    - 会話は2キャラクターが交代しながら進む
  - 問題パートでは、ユーザーが自分で盤面を操作して解く
- シナリオは複数のセクションに分かれている
  - 各セクションはデモパートか問題パートのいずれかである
  - デモパートと問題パートは混在可能（デモ→問題→デモ→問題...）
- シナリオの進行状況を保存・復元できる

## デモパートの盤面更新方式

### 方式A: 操作指定方式

各ダイアログに対して、石を置く操作（Position + Color）を指定する。

**メリット:**

- アニメーション再生が自然（石を置く動作を再現できる）
- マークやハイライトを操作対象に付けやすい
- 「ここに置くと...」という説明と動作が直結
- 操作の取り消し（戻る）が実装しやすい

**デメリット:**

- データ量がやや多い
- 盤面状態を直接指定できない（初期状態から順に計算が必要）

### 方式B: 状態指定方式

各ダイアログに対して、その時点での盤面状態全体を指定する。

**メリット:**

- データ構造がシンプル
- 任意の盤面状態を直接表現できる
- バグが起きにくい（状態が明示的）

**デメリット:**

- アニメーションが不自然（盤面が切り替わる感じ）
- どの石が新しく置かれたかの判定が必要
- データ量が多い（毎回全盤面）

### 採用方針（検討中）

**操作指定方式**を基本とし、必要に応じて状態指定も可能なハイブリッド方式が良さそう？

- 通常は操作指定で自然なアニメーション
- 複雑な局面では状態指定でスキップ可能

## シナリオデータ構造

### 全体構造

```typescript
interface Scenario {
  id: string;
  title: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  description: string;
  objectives: string[];

  // セクションの配列（デモと問題が混在可能）
  sections: Section[];
}

type Section = DemoSection | ProblemSection;

interface BaseSection {
  id: string;
  type: "demo" | "problem";
  title: string;
}
```

### デモセクション

```typescript
interface DemoSection extends BaseSection {
  type: "demo";

  // 初期盤面（このセクション開始時の状態）
  initialBoard: string[];

  // 会話の流れ
  dialogues: DemoDialogue[];
}

interface DemoDialogue {
  id: string;
  character: string; // "fubuki" | "miko" など
  text: string;
  emotion?: string; // "happy" | "thinking" など

  // 盤面操作（オプション）
  boardAction?: BoardAction;
}

// 盤面操作（ハイブリッド方式）
type BoardAction =
  | PlaceMoveAction
  | RemoveMoveAction
  | SetBoardAction
  | MarkAction
  | LineAction;

// 操作指定方式：石を置く
interface PlaceMoveAction {
  type: "place";
  position: { row: number; col: number };
  color: "black" | "white";
  highlight?: boolean; // ハイライト表示するか
}

// 石を削除する
interface RemoveMoveAction {
  type: "remove";
  position: { row: number; col: number };
}

// 状態指定方式：盤面全体を設定
interface SetBoardAction {
  type: "setBoard";
  board: string[];
}

// マーク表示：説明用のマークを表示
interface MarkAction {
  type: "mark";
  positions: { row: number; col: number }[];
  markType: "circle" | "cross" | "arrow"; // マークの種類
  label?: string; // マークのラベル（オプション）
}

// 線を引く/消す：石同士を結ぶ説明用の線
interface LineAction {
  type: "line";
  fromPosition: { row: number; col: number };
  toPosition: { row: number; col: number };
  action: "draw" | "remove"; // 線を引く or 線を消す
  style?: "solid" | "dashed"; // 線のスタイル
}
```

### 問題セクション

```typescript
interface ProblemSection extends BaseSection {
  type: "problem";

  // 初期盤面
  initialBoard: string[];

  // 説明文
  description: string;

  // 正解条件（複数指定可能で、AND条件）
  successConditions: SuccessCondition[];

  // ヒント（複数段階のヒントが可能）
  hints?: Hint[];

  // フィードバック会話
  feedback: ProblemFeedback;
}

// 正解条件
type SuccessCondition =
  | PositionCondition
  | PatternCondition
  | SequenceCondition;

// 条件A: 特定位置に石を置く（1手完結問題）
interface PositionCondition {
  type: "position";
  positions: { row: number; col: number }[]; // いずれかの位置（OR条件）
  color: "black" | "white";
}

// 条件B: 特定パターンを作る（例：活三を作る）
interface PatternCondition {
  type: "pattern";
  pattern: "live3" | "live4" | "five" | string; // パターン名
  color: "black" | "white";
}

// 条件C: 手順を指定（複数手問題）
interface SequenceCondition {
  type: "sequence";
  moves: { row: number; col: number; color: "black" | "white" }[];
  strict: boolean; // 厳密に順番通りか、最終結果が合っていればOKか
}

// ヒント
interface Hint {
  level: number; // ヒントレベル（1, 2, 3...）

  // 会話形式のヒント
  dialogue?: {
    character: string;
    text: string;
    emotion?: string;
  };

  // 盤面上のヒント（マーク表示）
  marks?: {
    positions: { row: number; col: number }[];
    markType: "circle" | "cross" | "arrow";
  };
}

// フィードバック
interface ProblemFeedback {
  // 成功時の会話
  success: {
    character: string;
    text: string;
    emotion?: string;
  }[];

  // 失敗時の会話
  failure: {
    character: string;
    text: string;
    emotion?: string;
  }[];

  // 途中経過のフィードバック（オプション）
  progress?: {
    character: string;
    text: string;
    emotion?: string;
  }[];
}
```

### 進行状況の保存

```typescript
interface ScenarioProgress {
  scenarioId: string;

  // 現在のセクション
  currentSectionIndex: number;

  // 完了したセクション
  completedSections: string[]; // section.id の配列

  // デモセクション内の現在位置
  currentDialogueIndex?: number;

  // 問題セクションの試行回数
  attempts?: Record<string, number>; // sectionId -> 試行回数

  // ヒント使用状況
  hintsUsed?: Record<string, number>; // sectionId -> 使用したヒントレベル

  // 完了状態
  isCompleted: boolean;

  // スコア計算用
  score: number;
}
```

## 具体例：活三を学ぶシナリオ

新しいデータ構造に基づいた sc001.json の例：

```json
{
  "id": "sc001",
  "title": "活三を見つけよう",
  "difficulty": "beginner",
  "description": "連珠の基本、活三パターンを学びます",
  "objectives": [
    "活三とは何かを理解する",
    "盤面上の活三を見つける",
    "活三を作る手を打つ"
  ],
  "sections": [
    {
      "id": "demo1",
      "type": "demo",
      "title": "活三とは",
      "initialBoard": [
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------"
      ],
      "dialogues": [
        {
          "id": "d1-1",
          "character": "fubuki",
          "text": "こんにちは、みこさん！今日は連珠の基本、「活三」について学びましょう。",
          "emotion": "happy"
        },
        {
          "id": "d1-2",
          "character": "miko",
          "text": "よろしくお願いします、フブキ先生！",
          "emotion": "happy"
        },
        {
          "id": "d1-3",
          "character": "fubuki",
          "text": "活三というのは、3つの石が並んでいて、両端が空いている状態のことです。",
          "emotion": "explaining"
        },
        {
          "id": "d1-4",
          "character": "fubuki",
          "text": "次に1手打てば四連になれる、攻撃的な形ですね。\nこんな感じです。",
          "emotion": "explaining",
          "boardAction": {
            "type": "place",
            "position": { "row": 7, "col": 7 },
            "color": "black",
            "highlight": true
          }
        },
        {
          "id": "d1-5",
          "character": "fubuki",
          "text": "あ、すみません。もう一度。",
          "emotion": "thinking",
          "boardAction": {
            "type": "remove",
            "position": { "row": 7, "col": 7 }
          }
        },
        {
          "id": "d1-6",
          "character": "fubuki",
          "text": "石を3つ置きますね。",
          "emotion": "explaining",
          "boardAction": {
            "type": "place",
            "position": { "row": 7, "col": 8 },
            "color": "black"
          }
        },
        {
          "id": "d1-7",
          "character": "fubuki",
          "text": "",
          "emotion": "explaining",
          "boardAction": {
            "type": "place",
            "position": { "row": 7, "col": 9 },
            "color": "black"
          }
        },
        {
          "id": "d1-8",
          "character": "fubuki",
          "text": "",
          "emotion": "explaining",
          "boardAction": {
            "type": "place",
            "position": { "row": 7, "col": 10 },
            "color": "black"
          }
        },
        {
          "id": "d1-9",
          "character": "fubuki",
          "text": "ここに両側が空いていて、次に打つと4連になるでしょう？",
          "emotion": "explaining",
          "boardAction": {
            "type": "line",
            "fromPosition": { "row": 7, "col": 7 },
            "toPosition": { "row": 7, "col": 11 },
            "action": "draw"
          }
        },
        {
          "id": "d1-10",
          "character": "miko",
          "text": "あ！分かりました。ここが活三なんですね！",
          "emotion": "happy"
        }
      ]
    },
    {
      "id": "problem1",
      "type": "problem",
      "title": "活三を見つける",
      "description": "盤面上で活三ができる場所を見つけて石を置いてください",
      "initialBoard": [
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---eexxee------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------"
      ],
      "successConditions": [
        {
          "type": "position",
          "positions": [
            { "row": 6, "col": 2 },
            { "row": 6, "col": 8 }
          ],
          "color": "black"
        }
      ],
      "hints": [
        {
          "level": 1,
          "dialogue": {
            "character": "fubuki",
            "text": "黒石が2つ並んでいますね。活三を作るなら、その側に置いてみてください。",
            "emotion": "thinking"
          }
        },
        {
          "level": 2,
          "marks": {
            "positions": [
              { "row": 6, "col": 2 },
              { "row": 6, "col": 8 }
            ],
            "markType": "circle"
          }
        }
      ],
      "feedback": {
        "success": [
          {
            "character": "fubuki",
            "text": "その通りです！両端が空いている3連になりましたね。これが活三です。",
            "emotion": "happy"
          },
          {
            "character": "miko",
            "text": "やった！理解できました～！",
            "emotion": "happy"
          }
        ],
        "failure": [
          {
            "character": "fubuki",
            "text": "うーん、惜しい。その場所だと活三にはなりません。",
            "emotion": "thinking"
          },
          {
            "character": "fubuki",
            "text": "もう一度、両端が開いている場所を探してみましょう。",
            "emotion": "thinking"
          }
        ]
      }
    },
    {
      "id": "demo2",
      "type": "demo",
      "title": "活三の応用",
      "initialBoard": [
        "---------------",
        "---------------",
        "---------------",
        "------e--------",
        "------x--------",
        "------e--------",
        "------x--------",
        "------e--------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------"
      ],
      "dialogues": [
        {
          "id": "d2-1",
          "character": "fubuki",
          "text": "では次に、縦方向の活三を見てみましょう。",
          "emotion": "explaining"
        },
        {
          "id": "d2-2",
          "character": "fubuki",
          "text": "同じように、3つの石が並んでいて、両端が空いている形です。",
          "emotion": "explaining",
          "boardAction": {
            "type": "place",
            "position": { "row": 5, "col": 6 },
            "color": "black"
          }
        },
        {
          "id": "d2-3",
          "character": "miko",
          "text": "横だけじゃなく、縦や斜めでも活三ができるんですか？",
          "emotion": "curious"
        },
        {
          "id": "d2-4",
          "character": "fubuki",
          "text": "そう！連珠では、どの方向でも活三は活三です。\n4連や5連も、全ての方向で成立します。",
          "emotion": "happy"
        }
      ]
    },
    {
      "id": "problem2",
      "type": "problem",
      "title": "別の活三を作る",
      "description": "今度は別の方向で活三を作ってみましょう",
      "initialBoard": [
        "---------------",
        "---------------",
        "---------------",
        "------e--------",
        "------x--------",
        "------e--------",
        "------x--------",
        "------e--------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------",
        "---------------"
      ],
      "successConditions": [
        {
          "type": "position",
          "positions": [
            { "row": 3, "col": 6 },
            { "row": 8, "col": 6 }
          ],
          "color": "black"
        }
      ],
      "hints": [
        {
          "level": 1,
          "dialogue": {
            "character": "fubuki",
            "text": "縦方向を見てください。黒石の側に置いてみましょう。",
            "emotion": "thinking"
          }
        }
      ],
      "feedback": {
        "success": [
          {
            "character": "fubuki",
            "text": "完璧です！縦方向でも活三を作ることができました。",
            "emotion": "happy"
          },
          {
            "character": "miko",
            "text": "楽しい！もっとやりたいです！",
            "emotion": "happy"
          }
        ],
        "failure": [
          {
            "character": "fubuki",
            "text": "残念。その位置ではまだ活三になりません。",
            "emotion": "thinking"
          }
        ]
      }
    }
  ]
}
```

## パーサーの使用方法

```typescript
import { parseScenario, validateBoardState } from "../logic/scenarioParser";

// シナリオの解析（実行時）
try {
  const scenario = parseScenario(jsonData);
  // scenario は完全に型付きされた Scenario 型
} catch (error) {
  console.error("シナリオのパースに失敗:", error.message);
}

// 盤面の検証（JSON編集時）
const errors = validateBoardState(boardArray);
if (errors.length > 0) {
  console.error("盤面に問題があります:");
  errors.forEach((error) => console.error("  -", error));
}
```
