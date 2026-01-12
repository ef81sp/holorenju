# テスト整備計画

## 現状

- テスト基盤が完全に不在（Vitest、Testing Library、設定ファイルなし）
- pnpm使用、Vite (rolldown-vite) + Vue 3 + TypeScript + Pinia構成
- Konva (vue-konva) でcanvas描画

## 方針

- **Vitest Browser Mode** を使用（Vitest 4.0で安定版）
- canvas/Konvaコンポーネントを実ブラウザ環境でテスト可能
- Playwrightをブラウザプロバイダーとして使用

## インクリメンタル実装計画

### Phase 1: テスト基盤のセットアップ

**必要なパッケージ**:

```bash
pnpm add -D vitest @vitest/browser playwright @vue/test-utils @testing-library/vue
```

**設定ファイル作成**:

1. `vitest.config.ts` - Vue対応、Browser Mode (Playwright) 設定
2. `vitest.workspace.ts` - ユニットテスト（Node）とブラウザテストを分離
3. `package.json` - テストスクリプト追加（`test`, `test:browser`, `test:watch`）

**成果物**: `pnpm test` でVitestが起動する状態

---

### Phase 2: 純粋関数のユニットテスト（Node環境）

最もテストしやすい純粋関数から開始。これらはブラウザ不要。

**対象ファイル**:

1. `src/logic/renjuRules.ts` - 最重要、複雑なロジック
   - `isValidPosition()` - 境界チェック
   - `checkFive()` - 5連検出（4方向）
   - `checkForbiddenMove()` - 禁じ手検出（三三、四四、長連）
   - `checkWin()` - 勝利判定
   - `recognizePattern()` - パターン認識

2. `src/logic/boardParser.ts`
   - `parseInitialBoard()` - ボード文字列のパース

3. `src/logic/textParser.ts`
   - `parseInlineTextFromString()` - ルビ、強調のパース
   - `parseText()` - 行区切り、リスト
   - ラウンドトリップテスト（parse → stringify → parse）

**テストファイル配置**: 各ファイルと同階層に `*.test.ts`

---

### Phase 3: RenjuBoardコンポーネントのテスト（Browser Mode）

Konvaコンポーネントを実ブラウザ環境でテスト。

**対象ファイル**:

1. `src/components/game/RenjuBoard/RenjuBoard.vue`
   - マウントとレンダリング
   - クリックによる石の配置
   - ホバー状態の更新

2. `src/components/game/RenjuBoard/composables/useRenjuBoardLayout.ts`
   - `positionToPixels()` - 座標変換
   - `pixelsToPosition()` - 逆変換

3. `src/components/game/RenjuBoard/composables/useRenjuBoardInteraction.ts`
   - クリックハンドリング
   - プレビュー石の表示

**テスト手法**:

- Vitest Browser Mode + Playwright
- `@testing-library/vue` でコンポーネントマウント
- 実際のcanvas要素でイベント発火
- Konvaステージへのアクセスと検証

**テストファイル配置**: `*.browser.test.ts` で区別

---

### Phase 4: シナリオパーサーのテスト（Node環境）

**対象ファイル**:

- `src/logic/scenarioParser.ts` - 複雑なバリデーションロジック
  - セクションバリデーション（demo/question）
  - アクションバリデーション（place, remove, mark等）
  - 成功条件バリデーション
  - エラーケースの網羅

---

### Phase 5: Piniaストアのテスト

**対象ファイル** (優先度順):

1. `src/stores/gameStore.ts`
   - 手番管理、禁じ手判定、勝利判定
   - boardStoreのモック必要

2. `src/stores/progressStore.ts`
   - localStorage統合（モック必要）
   - スコア加算、重複防止

3. `src/stores/appStore.ts`
   - ナビゲーション状態遷移

**テスト環境**: `setActivePinia(createPinia())` でストア初期化

---

### Phase 6: 統合テスト（Browser Mode）

ScenarioPlayerなど複合コンポーネントのテスト。

**対象**:

- `src/components/scenarios/ScenarioPlayer/` - シナリオ再生の統合テスト
- ダイアログ表示、ボード操作、進行管理の連携

---

## 検証方法

各Phaseの完了時:

1. `pnpm test` - 全テストがパス
2. `pnpm check-fix` - 型エラー・lint/formatエラーなし

## ファイル構成

```
src/
├── logic/
│   ├── renjuRules.ts
│   ├── renjuRules.test.ts           # Phase 2 (Node)
│   ├── boardParser.ts
│   ├── boardParser.test.ts          # Phase 2 (Node)
│   ├── textParser.ts
│   ├── textParser.test.ts           # Phase 2 (Node)
│   ├── scenarioParser.ts
│   └── scenarioParser.test.ts       # Phase 4 (Node)
├── stores/
│   ├── gameStore.ts
│   ├── gameStore.test.ts            # Phase 5
│   └── ...
└── components/
    └── game/RenjuBoard/
        ├── RenjuBoard.vue
        ├── RenjuBoard.browser.test.ts   # Phase 3 (Browser)
        ├── composables/
        │   ├── useRenjuBoardLayout.ts
        │   └── useRenjuBoardLayout.test.ts  # Phase 3
        └── logic/
            ├── boardRenderUtils.ts
            └── boardRenderUtils.test.ts     # Phase 2
```

## vitest.workspace.ts 構成例

```typescript
export default [
  {
    test: {
      name: "unit",
      include: ["src/**/*.test.ts"],
      exclude: ["src/**/*.browser.test.ts"],
      environment: "node",
    },
  },
  {
    test: {
      name: "browser",
      include: ["src/**/*.browser.test.ts"],
      browser: {
        enabled: true,
        provider: "playwright",
        name: "chromium",
      },
    },
  },
];
```

## 参考リソース

- [Vitest Browser Mode](https://vitest.dev/guide/browser/why.html)
- [Vue 3 Testing with Vitest Browser Mode](https://alexop.dev/posts/vue3_testing_pyramid_vitest_browser_mode/)
