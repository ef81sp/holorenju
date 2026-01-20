# JSON変更時の自動読込

## 概要

シナリオJSONファイルが外部で変更された場合（テキストエディタでの直接編集など）、エディタが自動的に変更を検知して再読込する機能を追加する。

## 現状の実装

### File System Access API の制約

File System Access API には変更監視用のイベント（`watch` や `onchange`）が存在しない。ファイルの変更を検知するには、アプリケーション側でポーリングを実装する必要がある。

### useScenarioFileOperations.ts

現状は手動でファイルを選択して読み込む機能のみ:

```typescript
const handleFileSelectFromDialog = async (
  path: string,
  scenarioDir: FileSystemDirectoryHandle,
): Promise<void> => {
  // ファイルを読み込んでパース
  // ...
};
```

## 修正方針

1. **ポーリングベースの変更検知**: 定期的にファイルの変更をチェック
2. **表示状態の保持**: 再読込時にセクションインデックス、ダイアログインデックス等を維持
3. **ユーザー確認**: 変更検知時に確認ダイアログを表示（オプション）

## 実装詳細

### 1. useFileWatcher.ts の新規作成

```typescript
import { ref, onUnmounted, type Ref } from "vue";
import type { Scenario } from "@/types/scenario";

interface UseFileWatcherReturn {
  isWatching: Ref<boolean>;
  lastModified: Ref<Date | null>;
  startWatching: (
    fileHandle: FileSystemFileHandle,
    onChanged: (content: string) => void,
  ) => void;
  stopWatching: () => void;
}

export function useFileWatcher(): UseFileWatcherReturn {
  const isWatching = ref(false);
  const lastModified = ref<Date | null>(null);
  let watchIntervalId: number | null = null;
  let currentFileHandle: FileSystemFileHandle | null = null;
  let changeCallback: ((content: string) => void) | null = null;

  const checkForChanges = async (): Promise<void> => {
    if (!currentFileHandle) {
      return;
    }

    try {
      const file = await currentFileHandle.getFile();
      const newModified = new Date(file.lastModified);

      // 初回チェック時は lastModified を設定するだけ
      if (lastModified.value === null) {
        lastModified.value = newModified;
        return;
      }

      // 変更があった場合
      if (newModified.getTime() !== lastModified.value.getTime()) {
        lastModified.value = newModified;
        const content = await file.text();
        changeCallback?.(content);
      }
    } catch (error) {
      // ファイルが削除された等のエラー
      console.warn("ファイル監視エラー:", error);
      stopWatching();
    }
  };

  const startWatching = (
    fileHandle: FileSystemFileHandle,
    onChanged: (content: string) => void,
  ): void => {
    stopWatching(); // 既存の監視を停止

    currentFileHandle = fileHandle;
    changeCallback = onChanged;
    lastModified.value = null;
    isWatching.value = true;

    // 初回チェック
    checkForChanges();

    // 3秒ごとにポーリング
    watchIntervalId = window.setInterval(checkForChanges, 3000);
  };

  const stopWatching = (): void => {
    if (watchIntervalId !== null) {
      window.clearInterval(watchIntervalId);
      watchIntervalId = null;
    }
    currentFileHandle = null;
    changeCallback = null;
    isWatching.value = false;
    lastModified.value = null;
  };

  onUnmounted(() => {
    stopWatching();
  });

  return {
    isWatching,
    lastModified,
    startWatching,
    stopWatching,
  };
}
```

### 2. useScenarioFileOperations.ts の修正

```typescript
import { useFileWatcher } from "./useFileWatcher";

export function useScenarioFileOperations(): UseScenarioFileOperationsReturn {
  const editorStore = useEditorStore();
  const fileWatcher = useFileWatcher();

  // 現在編集中のファイルハンドル
  const currentFileHandle = ref<FileSystemFileHandle | null>(null);

  // 変更検知時のコールバック
  const handleFileChanged = (content: string): void => {
    try {
      const data = JSON.parse(content);
      const result = validateScenarioCompletely(data);

      if (result.isValid) {
        // 現在の表示状態を保存
        const currentSectionIndex = editorStore.currentSectionIndex;
        const currentDialogueIndex = editorStore.previewDialogueIndex;

        // シナリオを再読込
        const scenario = parseScenario(data);
        editorStore.loadScenario(scenario);
        editorStore.clearValidationErrors();

        // 表示状態を復元（可能な範囲で）
        editorStore.setCurrentSectionIndex(
          Math.min(currentSectionIndex, scenario.sections.length - 1),
        );
        editorStore.goToDialogueIndex(currentDialogueIndex);

        console.info("📄 ファイルが変更されました。自動的に再読込しました。");
      } else {
        console.warn("❌ 外部変更されたJSONにエラーがあります");
        editorStore.setValidationErrors(
          result.errors.map((e) => ({ path: e.path, message: e.message })),
        );
      }
    } catch (error) {
      console.error("❌ JSON パースエラー:", error);
    }
  };

  const handleFileSelectFromDialog = async (
    path: string,
    scenarioDir: FileSystemDirectoryHandle,
  ): Promise<void> => {
    // ... 既存の処理 ...

    // ファイルハンドルを保存して監視開始
    currentFileHandle.value = fileHandle;
    fileWatcher.startWatching(fileHandle, handleFileChanged);
  };

  // 監視状態のエクスポート
  return {
    // ... 既存のexport ...
    isWatching: fileWatcher.isWatching,
    stopWatching: fileWatcher.stopWatching,
  };
}
```

### 3. ScenarioEditor.vue の修正

監視状態のインジケータを追加:

```vue
<template>
  <header class="editor-header">
    <!-- ... 既存のUI ... -->
    <div class="header-controls">
      <!-- 監視状態インジケータ -->
      <span
        v-if="fileOps.isWatching.value"
        class="watch-indicator"
        title="ファイル変更を監視中"
      >
        👁️ 監視中
      </span>
      <!-- ... 既存のボタン ... -->
    </div>
  </header>
</template>

<style scoped>
.watch-indicator {
  font-size: var(--size-10);
  color: var(--color-text-secondary);
  background-color: var(--color-bg-gray);
  padding: var(--size-2) var(--size-4);
  border-radius: 3px;
  display: flex;
  align-items: center;
  gap: var(--size-2);
}
</style>
```

### 4. 確認ダイアログ付きの実装（オプション）

未保存の変更がある場合に確認ダイアログを表示:

```typescript
const handleFileChanged = (content: string): void => {
  // 未保存の変更がある場合は確認
  if (editorStore.isDirty) {
    // 確認ダイアログ表示（toast や dialog で実装）
    if (
      !confirm(
        "外部でファイルが変更されました。再読込しますか？\n（未保存の変更は失われます）",
      )
    ) {
      return;
    }
  }

  // ... 再読込処理 ...
};
```

## 影響範囲

- `src/editor/components/composables/useFileWatcher.ts`（新規作成）
- `src/editor/components/composables/useScenarioFileOperations.ts`
- `src/editor/stores/editorStore.ts`（表示状態の管理追加）
- `src/editor/components/ScenarioEditor.vue`

## テスト計画

1. **変更検知テスト**
   - エディタでファイルを開いた状態で、外部テキストエディタでJSONを編集
   - 保存後3秒以内に変更が検知され、再読込されることを確認

2. **表示状態保持テスト**
   - 特定のセクション・ダイアログを表示中に外部変更
   - 再読込後、可能な範囲で同じ位置を表示していることを確認

3. **エラー処理テスト**
   - 外部で不正なJSONに変更した場合、エラーが適切に表示されることを確認
   - ファイル削除時に監視が正常に停止することを確認

4. **パフォーマンステスト**
   - ポーリングがブラウザのパフォーマンスに影響を与えていないことを確認
   - 長時間の監視でメモリリークがないことを確認

5. **未保存変更テスト**
   - 未保存の変更がある状態で外部変更があった場合の動作確認

## 備考

- ポーリング間隔（3秒）は設定可能にすることも検討
- 将来的に `FileSystemObserver` API が標準化されれば、ポーリングから移行可能
- バッテリー消費を考慮し、タブが非アクティブ時はポーリングを停止する実装も検討
- 大きなファイルの場合、ハッシュ比較による変更検知も検討の余地あり

## 代替案

### IndexedDB でのファイルハッシュ保存

```typescript
// ファイル読込時にハッシュを計算して保存
const hash = await computeFileHash(content);
await saveToIndexedDB(fileId, hash);

// ポーリング時はハッシュ比較のみ
const newHash = await computeFileHash(await file.text());
if (newHash !== savedHash) {
  // 変更あり
}
```

この方法はファイルサイズが大きい場合に有効だが、本プロジェクトのシナリオJSONは比較的小さいため、単純な `lastModified` 比較で十分と判断。
