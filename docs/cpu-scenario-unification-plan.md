# CPU対戦とシナリオプレイヤーの共通化計画

> **ステータス**: 計画済み（未着手）
> **作成日**: 2026-01-31

## 概要

CPU対戦（`CpuGamePlayer.vue`）とシナリオプレイヤー（`ScenarioPlayer.vue`）で重複している実装を整理し、共通化する。

## 発見された重複

### 1. グリッドレイアウト（優先度：高）

**完全に同一のCSS設定**:
```css
display: grid;
grid-template-columns: 4fr 7fr 5fr;
grid-template-rows: 7fr 2fr;
padding: var(--size-14);
gap: var(--size-14);
```

**重複しているクラス**（約60行のCSS）:
- `.control-section-slot` - 完全一致
- `.control-header` - 完全一致
- `.header-controls` - 完全一致
- `.board-section-wrapper` - 完全一致
- `.info-section-slot` - ほぼ一致
- `.dialog-section-slot` - ほぼ一致

### 2. カットイン表示管理（優先度：高）

| 項目 | シナリオ版 | CPU対戦版 |
|------|-----------|----------|
| 場所 | `src/components/scenarios/ScenarioPlayer/composables/useCutinDisplay.ts` | `CpuGamePlayer.vue` 行55-119（インライン） |
| 行数 | 104行（完全なcomposable） | 約40行（関数2つ + 変数） |
| 機能 | showPopover、自動非表示、キーボードスキップ | showPopover、自動非表示 |

**差分**:
- シナリオ版: キーボードリスナーを内部管理（任意キーでスキップ）
- CPU版: キーボードリスナーは外部の`handleKeyDown`で管理

### 2. プレイヤー色推論関数（優先度：中）

`getPlayerColorFromConditions` が2箇所に完全重複:
- `src/components/scenarios/ScenarioPlayer/composables/useQuestionSolver.ts` 行23-38
- `src/components/scenarios/ScenarioPlayer/ScenarioPlayer.vue` 行190-205

### 3. 盤面クローン関数（優先度：低）

`cloneBoard` が `useQuestionSolver.ts` 行78-79 に存在。
他にも同様のパターンが散在している可能性あり。

---

## 実装計画

### Step 1: Vueレイアウトコンポーネントの作成

**作業内容**:
`GamePlayerLayout.vue` を作成し、slotで各セクションの中身を差し込む構造にする

**新規ファイル**: `src/components/common/GamePlayerLayout.vue`
```vue
<template>
  <div class="game-player-layout">
    <!-- 操作セクション（左上）-->
    <div class="control-section">
      <div class="control-header">
        <slot name="back-button" />
        <div class="header-controls">
          <slot name="header-controls" />
        </div>
      </div>
      <slot name="control-info" />
    </div>

    <!-- 盤面セクション（中央）-->
    <div class="board-section" ref="boardFrameRef">
      <slot name="board" />
    </div>

    <!-- 情報セクション（右側）-->
    <div class="info-section">
      <slot name="info" />
    </div>

    <!-- セリフ部（左下）-->
    <div class="dialog-section">
      <slot name="dialog" />
    </div>
  </div>
</template>
```

**Props**:
- `boardFrameRef` をexposeして、`useBoardSize` で使用可能にする

**変更ファイル**:
- `src/components/common/GamePlayerLayout.vue` （新規作成）
- `src/components/scenarios/ScenarioPlayer/ScenarioPlayer.vue` （レイアウト部分をslot使用に変更）
- `src/components/cpu/CpuGamePlayer.vue` （レイアウト部分をslot使用に変更）

**注意点**:
- 各コンポーネント固有のスタイル（`.back-button`等）は各コンポーネントの`<style scoped>`に残す
- `boardFrameRef` はレイアウトコンポーネントからexposeし、親でアクセス

### Step 2: カットイン表示composableの共通化

**作業内容**:
1. `useCutinDisplay.ts` を `src/composables/` に移動
2. `CpuGamePlayer.vue` のインライン実装を削除し、composableを使用

**変更ファイル**:
- `src/composables/useCutinDisplay.ts` （新規作成 = 移動）
- `src/components/scenarios/ScenarioPlayer/composables/useCutinDisplay.ts` （削除）
- `src/components/scenarios/ScenarioPlayer/ScenarioPlayer.vue` （import パス変更）
- `src/components/cpu/CpuGamePlayer.vue` （インライン実装をcomposable使用に置換）

**インターフェース** （変更なし）:
```typescript
export const useCutinDisplay = (
  cutinRef: Ref<{ showPopover: () => void; hidePopover: () => void } | null>,
): {
  isCutinVisible: Ref<boolean>;
  showCutin: (type: CutinType) => void;
  hideCutin: () => void;
}
```

**注意点**:
- CPU対戦側のキーボード処理（Escキー対応）は既存の`handleKeyDown`内に残す
- composableのキーボードスキップ機能がそのまま使える

### Step 3: getPlayerColorFromConditions の共通化

**作業内容**:
1. `src/utils/conditionUtils.ts` を新規作成
2. 関数を移動し、両方のファイルから参照

**変更ファイル**:
- `src/utils/conditionUtils.ts` （新規作成）
- `src/components/scenarios/ScenarioPlayer/composables/useQuestionSolver.ts` （関数削除、import追加）
- `src/components/scenarios/ScenarioPlayer/ScenarioPlayer.vue` （関数削除、import追加）

### Step 4: cloneBoard の共通化（オプション）

**作業内容**:
- `boardStore.ts` に `cloneBoard` 関数をエクスポート

**変更ファイル**:
- `src/stores/boardStore.ts` （関数追加）
- `src/components/scenarios/ScenarioPlayer/composables/useQuestionSolver.ts` （import変更）

---

## ディレクトリ構造（変更後）

```
src/
  components/
    common/
      GamePlayerLayout.vue  # NEW: ゲームプレイ画面の共通レイアウト
  composables/              # NEW: 共有composables
    useCutinDisplay.ts      # 移動元: ScenarioPlayer/composables/
  utils/
    conditionUtils.ts       # NEW: 条件関連ユーティリティ
    sectionUtils.ts         # 既存
  stores/
    boardStore.ts           # cloneBoard追加（オプション）
```

---

## 検証方法

### 1. スナップショットテストの準備（実装前）

各Stepの実装前に、Playwright MCPでスナップショットを取得して保存：

```bash
# シナリオプレイヤー
docs/snapshots/before/scenario-player.png

# CPU対戦
docs/snapshots/before/cpu-game-player.png
```

### 2. 各Step完了後の検証

1. `pnpm check-fix` でTypeScript/ESLint/Prettierエラーがないことを確認
2. スナップショット比較:
   - **許容される差分**: 統一によりCSSが揃う部分の微調整
   - **許容されない差分**: レイアウト崩れ、要素の消失、位置の大幅なズレ

### 3. 機能テスト

開発サーバーで以下を手動テスト:
- シナリオプレイヤーでカットイン表示（正解/不正解）が動作すること
- CPU対戦でカットイン表示（勝利/敗北）が動作すること
- 両方でキー押下によるカットインスキップが動作すること

---

## 見送り事項

以下は今回の対象外:
- ゲーム状態管理の統合（`cpuGameStore` と シナリオナビゲーションは目的が異なるため）
- 禁じ手チェックのシナリオへの導入（シナリオでは出題者が設定で確認）
- 勝利判定の統合（シナリオは`evaluateAllConditions`、CPU対戦は`checkWin`で目的が異なる）
