# キャラクター表情管理システム設計

## 概要

キャラクターの顔画像スプライトシート（1枚8表情×5画像=40表情/キャラクター）を管理・使用するシステムの設計ドキュメント。

## 仕様

### スプライトシート構造

- **画像サイズ**: 576×288px
- **レイアウト**: 4列×2行（各セルは144×144px）
- **表情数**: 1画像あたり8表情
- **画像枚数**: キャラクターあたり5枚
- **合計表情数**: 40個（8表情 × 5画像）

### キャラクター

- **フブキ先生** (`fubuki`): `Holoface01-shirakamifubuki-01.png` ～ `05.png`
- **みこ** (`miko`): `Holoface00-sakramiko-01.png` ～ `05.png`

## データ設計

### 型定義

```typescript
// src/types/character.ts

// 表情ID: 0-39の連番
// 画像セット1の表情 0-7、画像セット2の表情 8-15、...、画像セット5の表情 32-39
type EmotionId =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22
  | 23
  | 24
  | 25
  | 26
  | 27
  | 28
  | 29
  | 30
  | 31
  | 32
  | 33
  | 34
  | 35
  | 36
  | 37
  | 38
  | 39;

type CharacterType = "fubuki" | "miko";

// 表情座標情報（事前計算した定数）
interface EmotionCoord {
  imageSet: 1 | 2 | 3 | 4 | 5;
  spriteIndex: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  x: string; // background-position x座標
  y: string; // background-position y座標
}

// 40個全表情の座標定数テーブル
const EMOTION_COORDS = {
  0: { imageSet: 1, spriteIndex: 0, x: "0px", y: "0px" },
  1: { imageSet: 1, spriteIndex: 1, x: "-144px", y: "0px" },
  2: { imageSet: 1, spriteIndex: 2, x: "-288px", y: "0px" },
  3: { imageSet: 1, spriteIndex: 3, x: "-432px", y: "0px" },
  4: { imageSet: 1, spriteIndex: 4, x: "0px", y: "-144px" },
  5: { imageSet: 1, spriteIndex: 5, x: "-144px", y: "-144px" },
  6: { imageSet: 1, spriteIndex: 6, x: "-288px", y: "-144px" },
  7: { imageSet: 1, spriteIndex: 7, x: "-432px", y: "-144px" },
  // セット2: ID 8-15
  8: { imageSet: 2, spriteIndex: 0, x: "0px", y: "0px" },
  9: { imageSet: 2, spriteIndex: 1, x: "-144px", y: "0px" },
  // ... (以下同様に16-39まで定義)
  // セット3: ID 16-23
  // セット4: ID 24-31
  // セット5: ID 32-39
} as const satisfies Record<EmotionId, EmotionCoord>;
```

### シナリオデータ

```typescript
// src/types/scenario.ts

interface DemoDialogue {
  id: string;
  character: CharacterType;
  text: string;
  emotion: number; // EmotionId (0-39)
  boardAction?: BoardAction;
}

interface DialogueLine {
  character: CharacterType;
  text: string;
  emotion: number; // EmotionId (0-39)
}
```

**デフォルト値**: `emotion: 0`（すべてのキャラクターの最初の表情）

## 実装詳細

### 1. 定数テーブルと画像URL生成 (`src/types/character.ts` / `src/logic/characterSprites.ts`)

**EMOTION_COORDS テーブル:**

- 40個全表情について、事前計算した座標情報を定数として定義
- 各表情に対して、画像セット番号・スプライトインデックス・background-position座標を保有
- コンポーネントでは単純なルックアップのみ実行

**画像URL生成関数（メモ化）:**

```typescript
// src/logic/characterSprites.ts

// IIFE（即座実行関数式）でクロージャを作成し、キャッシュを管理
export const getCharacterSpriteUrl = (() => {
  const cache: Record<string, string> = {};

  return (character: CharacterType, imageSet: 1 | 2 | 3 | 4 | 5): string => {
    const key = `${character}-${imageSet}`;

    // キャッシュに存在しない場合のみURLを生成
    if (!cache[key]) {
      const charName = character === "fubuki" ? "shirakamifubuki" : "sakramiko";
      const charId = character === "fubuki" ? "01" : "00";
      const filename = `Holoface${charId}-${charName}-${String(imageSet).padStart(2, "0")}.png`;

      cache[key] = new URL(
        `../assets/characters/${filename}`,
        import.meta.url,
      ).href;
    }

    return cache[key];
  };
})();
```

**特徴:**

- 初回呼び出し時に URL 文字列を生成してキャッシュに保存
- 以降の呼び出しはキャッシュから即座に返却（文字列生成処理なし）
- 2キャラ × 5セット = 最大10回の URL 生成処理のみ
- コード量少なく、パフォーマンスと可読性のバランスが取れている

### 2. キャラクタースプライトコンポーネント (`src/components/character/CharacterSprite.vue`)

Vue 3 Composition API + TypeScript

```vue
<script setup lang="ts">
import type { CharacterType, EmotionId } from "@/types/character";
import { EMOTION_COORDS } from "@/types/character";
import { getCharacterSpriteUrl } from "@/logic/characterSprites";

interface Props {
  character: CharacterType;
  emotionId: EmotionId; // 0-39
  width?: number; // デフォルト: 144
  height?: number; // デフォルト: 144
}

const props = withDefaults(defineProps<Props>(), {
  width: 144,
  height: 144,
});

const coords = computed(() => EMOTION_COORDS[props.emotionId]);
const spriteUrl = computed(() =>
  getCharacterSpriteUrl(props.character, coords.value.imageSet),
);
</script>

<template>
  <div
    class="character-sprite"
    :style="{
      width: `${width}px`,
      height: `${height}px`,
      backgroundImage: `url('${spriteUrl}')`,
      backgroundPosition: `${coords.x} ${coords.y}`,
      backgroundRepeat: 'no-repeat',
    }"
  />
</template>

<style scoped>
.character-sprite {
  display: inline-block;
  background-size: 576px 288px;
}
</style>
```

**処理フロー:**

1. `emotionId`（0-39）を受け取る
2. `EMOTION_COORDS[emotionId]` で座標情報を定数テーブルからルックアップ
3. `imageSet` から画像URLを生成
4. `x`, `y` をそのまま `background-position` に指定

### 3. 表情ピッカーダイアログ (`src/editor/components/EmotionPickerDialog.vue`)

Vue 3 + TypeScript

**実装方法:** `<dialog>` 要素を使用し、`showModal()` をexposeする設計。既存の `ConfirmDialog.vue` と同じパターンを踏襲。

**構造:**

```vue
<script setup lang="ts">
import type { CharacterType, EmotionId } from "@/types/character";
import { ref } from "vue";

interface Props {
  character: CharacterType;
}

interface Emits {
  (e: "select", emotionId: EmotionId): void;
}

defineProps<Props>();
defineEmits<Emits>();

const dialogRef = ref<HTMLDialogElement>();

// showModalをexposeする
const showModal = () => {
  dialogRef.value?.showModal();
};

defineExpose({ showModal });

const selectEmotion = (emotionId: EmotionId) => {
  emit("select", emotionId);
  dialogRef.value?.close();
};
</script>

<template>
  <dialog
    ref="dialogRef"
    class="emotion-picker-dialog"
  >
    <!-- ダイアログコンテンツ -->
    <!-- セット1-5のタブ切り替え、4×2グリッド表示など -->
  </dialog>
</template>
```

**使用方法（DemoSectionEditor内）:**

```typescript
const emotionPickerRef = ref<InstanceType<typeof EmotionPickerDialog>>();

const openEmotionPicker = () => {
  emotionPickerRef.value?.showModal();
};
```

**機能:**

- `<dialog>` 要素でモーダル表示（backdrop自動）
- セット1-5のタブ切り替え
- 各セットで4×2グリッド（8表情）を表示
- 各セルに表情プレビュー（144×144px）を表示（`CharacterSprite` コンポーネント使用）
- 画像クリックで表情ID選択
- ダイアログを自動クローズ

**Props:**

- `character: CharacterType` - 表示対象キャラクター

**Emits:**

- `select` - ID選択時、選択した EmotionId を返却

**Expose:**

- `showModal()` - ダイアログを開く

### 4. DemoSectionEditorの表情選択UI (`src/editor/components/DemoSectionEditor.vue`)

**追加機能:**

- セクション詳細内に「表情選択」ボタンを追加
  - 選択中の表情プレビュー（144×144px）を表示
  - ボタンクリックで `EmotionPickerDialog` を開く
  - 現在のキャラクター（`dialogue.character`）を指定して開く
  - 選択結果を `dialogue.emotion` に反映

### 5. CharacterDialogコンポーネント更新 (`src/components/character/CharacterDialog.vue`)

**変更:**

- 現在の絵文字アバター（`🦊`/`🌸`）を削除
- `CharacterSprite` コンポーネントを使用
- Props: `character`, `emotionId`

### 6. プレビューパネル (`src/editor/components/PreviewPanel.vue`)

**変更:**

- 会話表示時にキャラクター画像を表示
- 現在の表情ID対応の正確な画像を表示

## マイグレーション

既存シナリオファイル（テストデータ）の `emotion` フィールドを新仕様に更新：

**変更対象ファイル:**

- `src/data/scenarios/beginner/scenario_mjviwg6m_jv8xm.json`
- その他すべてのシナリオファイル

**変換方法:** 既存文字列値→ID への手動指定

- 新しく指定する際は `emotion: 0`（デフォルト）から始めて、必要に応じてピッカーで選択

## ファイル構成

```
src/
  types/
    character.ts          (型定義拡張)
    scenario.ts           (Emotion型変更)
  logic/
    characterSprites.ts   (新規作成)
  components/
    character/
      CharacterSprite.vue (新規作成)
      CharacterDialog.vue (更新)
  editor/
    components/
      EmotionPickerDialog.vue (新規作成)
      DemoSectionEditor.vue   (更新)
      PreviewPanel.vue        (更新)
```

## 実装優先度

1. 型定義と座標計算ロジック (`types/character.ts`, `logic/characterSprites.ts`)
2. キャラクタースプライトコンポーネント (`components/character/CharacterSprite.vue`)
3. 表情ピッカーダイアログ (`editor/components/EmotionPickerDialog.vue`)
4. エディタUI統合 (`editor/components/DemoSectionEditor.vue`)
5. プレイヤー表示更新 (`components/character/CharacterDialog.vue`, `editor/components/PreviewPanel.vue`)
6. シナリオデータマイグレーション

## 備考

- 画像ファイルは既に `src/assets/characters/` に配置済み
- Viteの動的import対応で柔軟な画像URL生成が可能
- 40個の表情すべてに対応可能で将来の拡張性が高い
- UIはビジュアルピッカー方式で直感的な選択が可能
