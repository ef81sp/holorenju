# 難易度6分割計画

## 新しい難易度構成

| キー名 | 表示名 |
|--------|--------|
| gomoku_beginner | 五目並べ:入門 |
| gomoku_intermediate | 五目並べ:初級 |
| renju_beginner | 連珠:入門 |
| renju_intermediate | 連珠:初級 |
| renju_advanced | 連珠:中級 |
| renju_expert | 連珠:上級 |

## 修正対象ファイル

### 型定義（一元管理）
`src/types/scenario.ts`で定数と型を一元管理：
```typescript
export const DIFFICULTIES = [
  "gomoku_beginner",
  "gomoku_intermediate",
  "renju_beginner",
  "renju_intermediate",
  "renju_advanced",
  "renju_expert",
] as const;

export type ScenarioDifficulty = typeof DIFFICULTIES[number];
```

### 定数をインポートして使用
- `src/stores/appStore.ts` - `Difficulty`型を削除、`ScenarioDifficulty`をインポート
- `src/editor/logic/indexFileHandler.ts` - `DIFFICULTIES`をインポート、ハードコード配列を削除
- `src/editor/components/composables/useScenarioIndexManagement.ts` - 同上
- `src/editor/components/ScenarioReorderDialog.vue` - 同上

### UI
- `src/components/pages/DifficultyPage.vue` - 6つのボタンに拡張、2列×3行レイアウト

### ディレクトリ構造
```
src/data/scenarios/
├── gomoku_beginner/
├── gomoku_intermediate/
├── renju_beginner/
├── renju_intermediate/
├── renju_advanced/
└── renju_expert/
```

## 既存シナリオの移行
- 既存ファイルはひとまずgomoku_begginerに全部配置
- ユーザーがシナリオエディタで手動移行（難易度選択欄で変更）
