# テスト追加計画 Phase 2 - 概要

## 背景

Phase 1で以下7ファイルのテストを完了:

- `problemConditions.ts`, `dialogStore.ts`, `preferencesStore.ts`
- `useKeyboardNavigation.ts`, `boardStore.ts`
- `useBoardActions.ts`, `useSuccessConditions.ts`

Phase 2では残り15ファイルにテストを追加する。

## 対象ファイル一覧

### Tier 1: 高テスト容易性（5ファイル）

→ 詳細: [test-plan-phase2-tier1.md](./test-plan-phase2-tier1.md)

| ファイル                 | パス                                                                     |
| ------------------------ | ------------------------------------------------------------------------ |
| useFeedbackEditor        | `src/editor/composables/useFeedbackEditor.ts`                            |
| useDialogueEditor        | `src/editor/composables/useDialogueEditor.ts`                            |
| useBoardSize             | `src/components/scenarios/ScenarioPlayer/composables/useBoardSize.ts`    |
| characterSprites         | `src/logic/characterSprites.ts`                                          |
| useRenjuBoardInteraction | `src/components/game/RenjuBoard/composables/useRenjuBoardInteraction.ts` |

### Tier 2: 中テスト容易性（6ファイル）

→ 詳細: [test-plan-phase2-tier2.md](./test-plan-phase2-tier2.md)

| ファイル                  | パス                                                                       |
| ------------------------- | -------------------------------------------------------------------------- |
| useCutinDisplay           | `src/components/scenarios/ScenarioPlayer/composables/useCutinDisplay.ts`   |
| useQuestionSolver         | `src/components/scenarios/ScenarioPlayer/composables/useQuestionSolver.ts` |
| useFullscreenPrompt       | `src/logic/useFullscreenPrompt.ts`                                         |
| useScenarioExport         | `src/editor/components/composables/useScenarioExport.ts`                   |
| useScenarioFileOperations | `src/editor/components/composables/useScenarioFileOperations.ts`           |
| scenarioFileHandler       | `src/logic/scenarioFileHandler.ts`                                         |

### Tier 3: 低テスト容易性（4ファイル）

→ 詳細: [test-plan-phase2-tier3.md](./test-plan-phase2-tier3.md)

| ファイル                   | パス                                                                           |
| -------------------------- | ------------------------------------------------------------------------------ |
| useRenjuBoardAnimation     | `src/components/game/RenjuBoard/composables/useRenjuBoardAnimation.ts`         |
| useScenarioNavigation      | `src/components/scenarios/ScenarioPlayer/composables/useScenarioNavigation.ts` |
| useScenarioDirectory       | `src/editor/components/composables/useScenarioDirectory.ts`                    |
| useScenarioIndexManagement | `src/editor/components/composables/useScenarioIndexManagement.ts`              |

## 実装方針

- **Tier 1**: 完全なユニットテスト（高カバレッジ）
- **Tier 2**: 標準的なユニットテスト（ブラウザAPIモック使用）
- **Tier 3**: 呼び出し検証レベル（File System Access API/GSAP依存）

## 検証コマンド

```bash
# 全テスト実行
pnpm test

# 型チェック + lint
pnpm check-fix

# 特定ファイルのテスト
pnpm vitest run src/editor/composables/useFeedbackEditor.test.ts
```

## 参照テストファイル

既存のパターンを参考にする:

- `src/editor/composables/useBoardActions.test.ts` - エディタComposable
- `src/editor/composables/useSuccessConditions.test.ts` - 型アサーション
- `src/stores/preferencesStore.test.ts` - localStorageモック
