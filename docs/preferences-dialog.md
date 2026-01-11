# 設定ダイアログ

## 概要

ユーザーが学習体験をカスタマイズできる設定ダイアログを実装する。

## 要件

1. 各画面右上に設定ボタンを固定配置
2. シナリオ選択画面のページ表示を右下に移動（設定ボタンと干渉を避けるため）
3. PreferencesStoreを新設し、ローカルストレージと同期
4. ダイアログはモーダル形式

## 設定項目

### 1. アニメーション

| 項目               | 型                           | デフォルト | 説明                                    |
| ------------------ | ---------------------------- | ---------- | --------------------------------------- |
| アニメーション有効 | boolean                      | true       | 全アニメーションの有効/無効             |
| 石の配置速度       | "slow" \| "normal" \| "fast" | "normal"   | slow: 400ms, normal: 200ms, fast: 100ms |

**対応箇所**:

- `useRenjuBoardAnimation.ts`: 石・マーク・ライン
- `CutinOverlay.vue`: カットイン表示
- `MainView.vue`: 画面遷移

**無効時の動作**: 石は即時配置、遷移はフェードのみ

### 2. 表示

| 項目           | 型                             | デフォルト | 説明                       |
| -------------- | ------------------------------ | ---------- | -------------------------- |
| テキストサイズ | "small" \| "normal" \| "large" | "normal"   | ダイアログ・説明文のサイズ |

**対応箇所**:

- `CharacterDialog.vue`
- `ScenarioInfoPanel.vue`
- `style.css`: CSS変数で制御

### 3. データ管理

| 項目         | 型     | 説明                          |
| ------------ | ------ | ----------------------------- |
| 進度リセット | button | 確認後、progressStoreをクリア |

## UI設計

### 設定ボタン配置

```
┌─────────────────────────────────┐
│                           [⚙️] │ ← 右上固定
│                                 │
│         各画面コンテンツ         │
│                                 │
└─────────────────────────────────┘
```

### シナリオ選択画面（変更後）

```
┌─────────────────────────────────┐
│                           [⚙️] │
│                                 │
│       シナリオ一覧カード         │
│                                 │
│                      [< 1/3 >] │ ← 右下に移動
└─────────────────────────────────┘
```

### 設定ダイアログ

```
┌─────────────────────────────────┐
│  設定                      [×] │
├─────────────────────────────────┤
│                                 │
│  ■ アニメーション               │
│  ┌─────────────────────────────┐│
│  │ アニメーション有効    [✓]  ││
│  │ 石の配置速度  [遅い ▼]     ││
│  └─────────────────────────────┘│
│                                 │
│  ■ 表示                         │
│  ┌─────────────────────────────┐│
│  │ テキストサイズ [標準 ▼]    ││
│  └─────────────────────────────┘│
│                                 │
│  ■ データ管理                   │
│  ┌─────────────────────────────┐│
│  │ [進度をリセット]            ││
│  └─────────────────────────────┘│
│                                 │
└─────────────────────────────────┘
```

## コンポーネント構成

```
SettingsControl.vue (統合コンポーネント)
├── SettingsButton.vue (ボタン単体)
└── PreferencesDialog.vue (ダイアログ単体)
```

- **SettingsControl**: ボタンとダイアログを統合。各画面はこれを配置するだけで済む
- **SettingsButton**: ボタン単体。将来的に別用途で使う場合に備える
- **PreferencesDialog**: ダイアログ単体。外部からの開閉制御が必要な場合に使用

### 使用例

```vue
<!-- 各画面での使用（シンプル） -->
<template>
  <div class="view">
    <SettingsControl />
    <!-- 画面コンテンツ -->
  </div>
</template>
```

## 実装詳細

### PreferencesStore

```typescript
// src/stores/preferencesStore.ts
import { defineStore } from "pinia";
import { ref, watch } from "vue";

const STORAGE_KEY = "holorenju_preferences";

interface Preferences {
  animation: {
    enabled: boolean;
    stoneSpeed: "slow" | "normal" | "fast";
  };
  display: {
    textSize: "small" | "normal" | "large";
  };
}

const defaultPreferences: Preferences = {
  animation: {
    enabled: true,
    stoneSpeed: "normal",
  },
  display: {
    textSize: "normal",
  },
};

export const usePreferencesStore = defineStore("preferences", () => {
  const preferences = ref<Preferences>(loadFromStorage());

  function loadFromStorage(): Preferences {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        return { ...defaultPreferences, ...JSON.parse(saved) };
      } catch {
        return { ...defaultPreferences };
      }
    }
    return { ...defaultPreferences };
  }

  function saveToStorage(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences.value));
  }

  // 変更時に自動保存
  watch(preferences, saveToStorage, { deep: true });

  // 個別のgetter/setter
  const animationEnabled = computed({
    get: () => preferences.value.animation.enabled,
    set: (v) => (preferences.value.animation.enabled = v),
  });

  const stoneSpeed = computed({
    get: () => preferences.value.animation.stoneSpeed,
    set: (v) => (preferences.value.animation.stoneSpeed = v),
  });

  const textSize = computed({
    get: () => preferences.value.display.textSize,
    set: (v) => (preferences.value.display.textSize = v),
  });

  // 速度値のマッピング
  const stoneAnimationDuration = computed(() => {
    if (!preferences.value.animation.enabled) return 0;
    const speeds = { slow: 0.4, normal: 0.2, fast: 0.1 };
    return speeds[preferences.value.animation.stoneSpeed];
  });

  return {
    preferences,
    animationEnabled,
    stoneSpeed,
    textSize,
    stoneAnimationDuration,
  };
});
```

### PreferencesDialog.vue

新規コンポーネントとして `src/components/common/PreferencesDialog.vue` を作成。

### SettingsButton.vue

新規コンポーネントとして `src/components/common/SettingsButton.vue` を作成。
各画面で使用可能な共通ボタン。

### アニメーション速度の適用

```typescript
// useRenjuBoardAnimation.ts
import { usePreferencesStore } from "@/stores/preferencesStore";

export function useRenjuBoardAnimation(layout: LayoutType) {
  const prefs = usePreferencesStore();

  const animateStone = (position: Position): Promise<void> => {
    const duration = prefs.stoneAnimationDuration;
    if (duration === 0) {
      // アニメーション無効時は即時配置
      return Promise.resolve();
    }
    // ... 既存のTween処理（durationを動的に）
  };
}
```

### テキストサイズの適用

```css
/* style.css */
:root {
  --text-size-multiplier: 1;
}

:root[data-text-size="small"] {
  --text-size-multiplier: 0.85;
}

:root[data-text-size="large"] {
  --text-size-multiplier: 1.15;
}
```

```typescript
// App.vue または MainView.vue
watch(
  () => prefs.textSize,
  (size) => {
    document.documentElement.dataset.textSize = size;
  },
  { immediate: true },
);
```

## ファイル変更一覧

| ファイル                                                               | 変更内容                            |
| ---------------------------------------------------------------------- | ----------------------------------- |
| `src/stores/preferencesStore.ts`                                       | 新規作成                            |
| `src/components/common/SettingsControl.vue`                            | 新規作成（統合コンポーネント）      |
| `src/components/common/SettingsButton.vue`                             | 新規作成                            |
| `src/components/common/PreferencesDialog.vue`                          | 新規作成                            |
| `src/components/common/PageHeader.vue`                                 | SettingsControl組み込み             |
| `src/components/pages/ScenarioListPage.vue`                            | ページ表示を右下に移動              |
| `src/components/scenarios/ScenarioPlayer/ScenarioPlayer.vue`           | control-headerにSettingsControl追加 |
| `src/components/game/RenjuBoard/composables/useRenjuBoardAnimation.ts` | 速度設定を参照                      |
| `src/style.css`                                                        | テキストサイズ用CSS変数追加         |
| `src/App.vue`                                                          | テキストサイズのDOM反映             |

## 将来の拡張候補

以下は現時点では実装しないが、将来追加可能な設定項目：

- **BGM/SE**: 音声機能実装時に追加
- **キーボードショートカット**: カスタムキーバインド
- **盤面カラー**: 背景色・線色のカスタマイズ
- **ヒント表示**: 着手候補の表示有無
