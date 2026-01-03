# RenjuBoardコンポーネントのリファクタリング計画

## 進捗状況

### フェーズ1: Composablesへのロジック切り出し

- [ ] `useRenjuBoardLayout.ts` を作成（サイズ・座標計算）
- [ ] `useRenjuBoardInteraction.ts` を作成（マウス操作処理）
- [ ] `useRenjuBoardAnimation.ts` を作成（アニメーション処理）
- [ ] 動作確認

### フェーズ2: 描画ロジックの整理

- [ ] `boardRenderUtils.ts` を作成（グリッド線・星の生成）
- [ ] `RenjuBoard.vue` から描画計算関数を移動
- [ ] 動作確認

### フェーズ3: コンポーネント分割（オプション）

- [ ] 必要に応じて子コンポーネントの作成を検討
- [ ] 動作確認とバグ修正

---

## 概要

RenjuBoard.vue（567行）は連珠盤の描画と操作を担当するコンポーネントだが、
複数の責務（レイアウト計算、描画、マウス操作、アニメーション）が混在している。
Composablesへの切り出しにより、テスタビリティと保守性を向上させる。

## 対象ファイル

### RenjuBoard.vue (567行)

**現在の責務:**

- Props/Emitsの定義
- レイアウト計算（stageSize、CELL_SIZE、PADDING等）
- 描画データの生成（グリッド線、星、カーソルコーナー）
- 座標変換（positionToPixels、pixelsToPosition）
- マウスイベント処理（クリック、ホバー、リーブ）
- プレビュー石の状態管理
- アニメーション処理（石の配置アニメーション）
- BoardStoreとの連携
- Konva.jsを使ったテンプレート描画

## 問題点

1. **計算ロジックとビジネスロジックの混在**
   - レイアウト計算がコンポーネント内に分散
   - テストが困難

2. **状態管理の複雑さ**
   - previewStone、hoveredPosition、stoneRefsなど複数の状態
   - マウスイベントハンドラーが長い

3. **アニメーション処理の密結合**
   - アニメーションロジックがコンポーネントに直接記述
   - 再利用やテストが困難

4. **描画計算の可読性**
   - generateGridLines、generateCursorCornersなどが長大
   - ビジネスロジックが理解しにくい

## リファクタリング方針

### 基本戦略

1. **レイアウト計算をComposableに集約**
   - サイズ、パディング、座標変換などを一箇所に
   - テスト可能な形に

2. **マウス操作処理の分離**
   - イベントハンドラーをComposableに移動
   - プレビュー石の状態管理も含む

3. **アニメーション処理の独立化**
   - アニメーションロジックを分離
   - BoardStoreとの連携も整理

4. **描画ユーティリティの作成**
   - グリッド線や星の計算をユーティリティ関数に

## 具体的な分割計画

### A. Composablesの作成

#### 1. useRenjuBoardLayout.ts (100-150行想定)

**責務:** レイアウト計算と座標変換

```typescript
export function useRenjuBoardLayout(stageSize: ComputedRef<number>) {
  // 定数
  const BOARD_SIZE = 15;
  const STONE_RADIUS_RATIO = 0.45;

  // 計算されたプロパティ
  const STAGE_WIDTH = computed(() => stageSize.value);
  const STAGE_HEIGHT = computed(() => stageSize.value);
  const CELL_SIZE = computed(() => STAGE_WIDTH.value / 16);
  const PADDING = computed(() => {
    const width = STAGE_WIDTH.value;
    const cellSize = CELL_SIZE.value;
    return (width - (BOARD_SIZE - 1) * cellSize) / 2;
  });
  const STONE_RADIUS = computed(() => CELL_SIZE.value * STONE_RADIUS_RATIO);

  // 座標変換
  const positionToPixels = (row: number, col: number) => ({
    x: PADDING.value + col * CELL_SIZE.value,
    y: PADDING.value + row * CELL_SIZE.value,
  });

  const pixelsToPosition = (x: number, y: number): Position | null => {
    const col = Math.round((x - PADDING.value) / CELL_SIZE.value);
    const row = Math.round((y - PADDING.value) / CELL_SIZE.value);

    if (row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE) {
      return { col, row };
    }
    return null;
  };

  return {
    BOARD_SIZE,
    STAGE_WIDTH,
    STAGE_HEIGHT,
    CELL_SIZE,
    PADDING,
    STONE_RADIUS,
    positionToPixels,
    pixelsToPosition,
  };
}
```

#### 2. useRenjuBoardInteraction.ts (150-200行想定)

**責務:** マウス操作とプレビュー石の管理

```typescript
export function useRenjuBoardInteraction(
  props: {
    disabled: boolean;
    allowOverwrite: boolean;
    boardState: BoardState;
  },
  layout: ReturnType<typeof useRenjuBoardLayout>,
  emit: (event: string, ...args: any[]) => void,
) {
  // 状態
  const previewStone = ref<PreviewStone | null>(null);
  const hoveredPosition = ref<Position | null>(null);

  // クリックハンドラー
  const handleStageClick = (e: any): void => {
    if (props.disabled) return;

    const stage = e.target.getStage();
    const pointerPosition = stage.getPointerPosition();
    if (!pointerPosition) return;

    const position = layout.pixelsToPosition(
      pointerPosition.x,
      pointerPosition.y,
    );
    if (!position) return;

    // すでに石が置かれている場所はクリック不可
    if (
      !props.allowOverwrite &&
      props.boardState[position.row]?.[position.col]
    ) {
      return;
    }

    if (props.allowOverwrite) {
      emit("placeStone", position);
      return;
    }

    // 仮指定中の石と同じ位置をクリックした場合は確定
    if (
      previewStone.value &&
      previewStone.value.position.row === position.row &&
      previewStone.value.position.col === position.col
    ) {
      emit("placeStone", position);
      previewStone.value = null;
    } else {
      // 新しい位置を仮指定
      previewStone.value = {
        color: "black",
        position,
      };
    }
  };

  // マウスムーブハンドラー
  const handleStageMouseMove = (e: any): void => {
    if (props.disabled) return;

    const stage = e.target.getStage();
    const pointerPosition = stage.getPointerPosition();

    if (!pointerPosition) {
      hoveredPosition.value = null;
      return;
    }

    const position = layout.pixelsToPosition(
      pointerPosition.x,
      pointerPosition.y,
    );

    if (
      position &&
      (props.allowOverwrite || !props.boardState[position.row]?.[position.col])
    ) {
      hoveredPosition.value = position;
      emit("hoverCell", position);
    } else {
      hoveredPosition.value = null;
      emit("hoverCell", null);
    }
  };

  // マウスリーブハンドラー
  const handleStageMouseLeave = (): void => {
    hoveredPosition.value = null;
    emit("hoverCell", null);
  };

  return {
    previewStone,
    hoveredPosition,
    handleStageClick,
    handleStageMouseMove,
    handleStageMouseLeave,
  };
}
```

#### 3. useRenjuBoardAnimation.ts (100-150行想定)

**責務:** 石配置のアニメーション処理

```typescript
export function useRenjuBoardAnimation(
  layout: ReturnType<typeof useRenjuBoardLayout>,
) {
  const stoneRefs: Record<string, unknown> = {};

  const animateLastPlacedStone = (
    stoneKey: string,
    position?: Position,
  ): Promise<void> =>
    new Promise((resolve) => {
      nextTick(() => {
        const nodeRef = stoneRefs[stoneKey];
        if (!nodeRef) {
          resolve();
          return;
        }

        // @ts-expect-error: Vue template ref methods
        const konvaNode = nodeRef.getNode?.();
        if (!konvaNode || !position) {
          resolve();
          return;
        }

        // 現在のy位置を取得
        const targetY = layout.positionToPixels(position.row, position.col).y;
        const startY = targetY - layout.CELL_SIZE.value * 0.25;

        // 初期状態を設定
        konvaNode.y(startY);
        konvaNode.opacity(0.5);
        konvaNode.scaleX(0.8);
        konvaNode.scaleY(0.8);

        // アニメーション実行
        const tween = new Konva.Tween({
          node: konvaNode,
          duration: 0.2,
          y: targetY,
          opacity: 1,
          scaleX: 1,
          scaleY: 1,
          easing: Konva.Easings.EaseOut,
          onFinish: () => {
            resolve();
          },
        });

        tween.play();
      });
    });

  return {
    stoneRefs,
    animateLastPlacedStone,
  };
}
```

### B. ユーティリティ関数の作成

#### boardRenderUtils.ts (80-100行想定)

**責務:** 描画データの生成

```typescript
// グリッド線の生成
export function generateGridLines(
  BOARD_SIZE: number,
  CELL_SIZE: number,
  PADDING: number,
  GRID_STROKE_WIDTH: number,
): { points: number[]; stroke: string; strokeWidth: number }[] {
  const lines: { points: number[]; stroke: string; strokeWidth: number }[] = [];

  for (let i = 0; i < BOARD_SIZE; i += 1) {
    // 横線
    lines.push({
      points: [
        PADDING,
        PADDING + i * CELL_SIZE,
        PADDING + (BOARD_SIZE - 1) * CELL_SIZE,
        PADDING + i * CELL_SIZE,
      ],
      stroke: "#000",
      strokeWidth: GRID_STROKE_WIDTH,
    });

    // 縦線
    lines.push({
      points: [
        PADDING + i * CELL_SIZE,
        PADDING,
        PADDING + i * CELL_SIZE,
        PADDING + (BOARD_SIZE - 1) * CELL_SIZE,
      ],
      stroke: "#000",
      strokeWidth: GRID_STROKE_WIDTH,
    });
  }

  return lines;
}

// 星（天元・小目）の位置
export const STAR_POINTS = [
  { col: 3, row: 3 },
  { col: 11, row: 3 },
  { col: 7, row: 7 },
  { col: 3, row: 11 },
  { col: 11, row: 11 },
];

// カーソルの四隅を描画
export function generateCursorCorners(
  cursorPosition: Position | undefined,
  positionToPixels: (row: number, col: number) => { x: number; y: number },
  CELL_SIZE: number,
  STONE_RADIUS: number,
): { points: number[]; stroke: string; strokeWidth: number }[] {
  if (!cursorPosition) {
    return [];
  }

  const { row, col } = cursorPosition;
  const { x, y } = positionToPixels(row, col);
  const cornerLength = CELL_SIZE * 0.25;
  const cornerWidth = 2;
  const color = "#FF6B6B";

  // 8本の線を生成（4つのコーナー × 2本ずつ）
  // ... 実装は現在のコードと同じ

  return [
    /* コーナーライン配列 */
  ];
}
```

### C. リファクタリング後のRenjuBoard.vue (250-300行想定)

```vue
<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from "vue";
import { useBoardStore } from "@/stores/boardStore";
import { useRenjuBoardLayout } from "@/composables/useRenjuBoardLayout";
import { useRenjuBoardInteraction } from "@/composables/useRenjuBoardInteraction";
import { useRenjuBoardAnimation } from "@/composables/useRenjuBoardAnimation";
import {
  generateGridLines,
  generateCursorCorners,
  STAR_POINTS,
} from "@/logic/boardRenderUtils";

// Props & Emits
interface Props {
  boardState?: BoardState;
  disabled?: boolean;
  stageSize?: number;
  allowOverwrite?: boolean;
  cursorPosition?: Position;
}

const props = withDefaults(defineProps<Props>(), {
  boardState: () =>
    new Array(15).fill(null).map(() => new Array(15).fill(null)),
  disabled: false,
  stageSize: 640,
  allowOverwrite: false,
  cursorPosition: undefined,
});

const emit = defineEmits<{
  placeStone: [position: Position];
  hoverCell: [position: Position | null];
}>();

// ストア
const boardStore = useBoardStore();

// Composables
const stageSize = computed(() => props.stageSize || 640);
const layout = useRenjuBoardLayout(stageSize);
const interaction = useRenjuBoardInteraction(props, layout, emit);
const animation = useRenjuBoardAnimation(layout);

// 配置済みの石を計算
const placedStones = computed(() => {
  const stones: { row: number; col: number; color: StoneColor }[] = [];
  // ... 既存のロジック
  return stones;
});

// Stage configuration
const stageConfig = computed(() => ({
  width: layout.STAGE_WIDTH.value,
  height: layout.STAGE_HEIGHT.value,
}));

// 描画データ
const gridLines = computed(() =>
  generateGridLines(
    layout.BOARD_SIZE,
    layout.CELL_SIZE.value,
    layout.PADDING.value,
    1, // GRID_STROKE_WIDTH
  ),
);

const cursorCorners = computed(() =>
  generateCursorCorners(
    props.cursorPosition,
    layout.positionToPixels,
    layout.CELL_SIZE.value,
    layout.STONE_RADIUS.value,
  ),
);

// ライフサイクル
onMounted(() => {
  boardStore.setOnStonePlacedCallback(async (position: Position) => {
    const stoneKey = `${position.row}-${position.col}`;
    await animation.animateLastPlacedStone(stoneKey, position);
  });
});

onBeforeUnmount(() => {
  boardStore.setOnStonePlacedCallback(null);
});
</script>

<template>
  <div class="renju-board">
    <v-stage
      :config="stageConfig"
      @mousedown="interaction.handleStageClick"
      @mousemove="interaction.handleStageMouseMove"
      @mouseleave="interaction.handleStageMouseLeave"
    >
      <v-layer>
        <!-- 背景 -->
        <v-rect
          :config="{
            x: 0,
            y: 0,
            width: layout.STAGE_WIDTH,
            height: layout.STAGE_HEIGHT,
            fill: '#DEB887',
          }"
        />

        <!-- グリッド線 -->
        <v-line
          v-for="(line, index) in gridLines"
          :key="`line-${index}`"
          :config="line"
        />

        <!-- 星 -->
        <v-circle
          v-for="(star, index) in STAR_POINTS"
          :key="`star-${index}`"
          :config="{
            x: layout.positionToPixels(star.row, star.col).x,
            y: layout.positionToPixels(star.row, star.col).y,
            radius: 4,
            fill: '#000',
          }"
        />

        <!-- 配置済みの石 -->
        <v-circle
          v-for="stone in placedStones"
          :key="`stone-${stone.row}-${stone.col}`"
          :ref="
            (el: unknown) => {
              const stoneKey = `${stone.row}-${stone.col}`;
              if (el) animation.stoneRefs[stoneKey] = el;
            }
          "
          :config="{
            x: layout.positionToPixels(stone.row, stone.col).x,
            y: layout.positionToPixels(stone.row, stone.col).y,
            radius: layout.STONE_RADIUS,
            fill: stone.color === 'black' ? '#000' : '#fff',
            stroke: stone.color === 'white' ? '#000' : undefined,
            strokeWidth: stone.color === 'white' ? 1 : 0,
          }"
        />

        <!-- ホバー中の位置表示 -->
        <v-circle
          v-if="
            interaction.hoveredPosition.value && !interaction.previewStone.value
          "
          :config="{
            x: layout.positionToPixels(
              interaction.hoveredPosition.value.row,
              interaction.hoveredPosition.value.col,
            ).x,
            y: layout.positionToPixels(
              interaction.hoveredPosition.value.row,
              interaction.hoveredPosition.value.col,
            ).y,
            radius: layout.STONE_RADIUS,
            fill: '#000',
            opacity: 0.2,
          }"
        />

        <!-- 仮指定中の石 -->
        <v-circle
          v-if="interaction.previewStone.value"
          :config="{
            x: layout.positionToPixels(
              interaction.previewStone.value.position.row,
              interaction.previewStone.value.position.col,
            ).x,
            y: layout.positionToPixels(
              interaction.previewStone.value.position.row,
              interaction.previewStone.value.position.col,
            ).y,
            radius: layout.STONE_RADIUS,
            fill:
              interaction.previewStone.value.color === 'black'
                ? '#000'
                : '#fff',
            stroke: '#FFD700',
            strokeWidth: 3,
            opacity: 0.7,
          }"
        />

        <!-- キーボードカーソル表示 -->
        <v-line
          v-for="(line, index) in cursorCorners"
          :key="`cursor-corner-${index}`"
          :config="line"
        />
      </v-layer>
    </v-stage>
  </div>
</template>

<style scoped>
.renju-board {
  display: flex;
  justify-content: end;
  aspect-ratio: 1;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  cursor: pointer;
  max-width: 100%;
  max-height: 100%;
  width: 100%;
  height: 100%;
}

.renju-board.disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
```

### 分割後の構成（RenjuBoard）

```
src/
├── components/
│   └── game/
│       └── RenjuBoard.vue (250-300行) ← メイン
├── composables/
│   ├── useRenjuBoardLayout.ts (100-150行)
│   ├── useRenjuBoardInteraction.ts (150-200行)
│   └── useRenjuBoardAnimation.ts (100-150行)
└── logic/
    └── boardRenderUtils.ts (80-100行)
```

## リファクタリングの優先順位と手順

### フェーズ1: Composablesへのロジック切り出し

1. `useRenjuBoardLayout.ts` を作成
   - レイアウト計算と座標変換を移動
   - RenjuBoard.vueで使用してテスト
2. `useRenjuBoardInteraction.ts` を作成
   - マウスイベントハンドラーを移動
   - プレビュー石の状態管理を含む
3. `useRenjuBoardAnimation.ts` を作成
   - アニメーション処理を移動
   - BoardStoreとの連携を整理
4. 動作確認

### フェーズ2: 描画ロジックの整理

1. `boardRenderUtils.ts` を作成
   - generateGridLines関数を移動
   - generateCursorCorners関数を移動
   - STAR_POINTS定数を移動
2. RenjuBoard.vueから描画計算関数を削除
3. 動作確認

### フェーズ3: コンポーネント分割（オプション）

- RenjuBoard.vueは主にテンプレート（描画）が中心なので、
  これ以上のコンポーネント分割は不要と判断
- 必要であれば将来的に検討

## 期待される効果

### 定量的効果

- **RenjuBoard.vue**: 567行 → 約250-300行（約50%削減）
- 各ファイルが400行以下に収まる
- ロジックが3つのComposableに整理される

### 定性的効果

1. **可読性の向上**
   - レイアウト計算、操作、アニメーションが明確に分離
   - テンプレート部分が見やすくなる

2. **テスタビリティの向上**
   - Composableは独立してテスト可能
   - 座標変換などの計算ロジックが検証しやすい

3. **保守性の向上**
   - 変更の影響範囲が限定的
   - バグ修正が容易

4. **再利用性の向上**
   - レイアウト計算は他のボードコンポーネントでも利用可能
   - 座標変換ロジックを共通化できる

## 注意点

1. **Konva.jsとの統合**
   - テンプレートrefの扱いに注意
   - アニメーション処理でのNode取得

2. **パフォーマンスの確認**
   - 計算処理の分離によるオーバーヘッドを監視
   - computedの依存関係を適切に管理

3. **型安全性の維持**
   - Konva.jsの型定義を活用
   - Position型などの整合性を保つ

4. **既存機能の保持**
   - キーボードカーソル表示
   - 石配置のアニメーション
   - プレビュー機能

## まとめ

RenjuBoard.vue（567行）を、関心の分離により約250-300行に削減。
3つのComposablesと1つのユーティリティファイルに機能を分離することで、
テスタビリティ・保守性・可読性を大幅に向上させる。

特に座標変換やレイアウト計算のロジックが独立することで、
将来的に盤面サイズの変更や新しいボードコンポーネントの追加が容易になる。
