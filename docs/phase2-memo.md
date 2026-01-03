# Phase 2 実装時の指摘事項と対応メモ

## 概要

ProblemSectionEditorのリファクタリング（Phase 2）で発生した指摘事項をまとめたメモ。
これらの学習を Phase 3 以降に活かす。

---

## 指摘事項と対応

### 1. スコープ付きCSS（scoped style）での継承

**指摘内容**:
親コンポーネント（ProblemSectionEditor.vue）のスタイルを子コンポーネントが継承できない

**対応方法**:
各子コンポーネント内に、親から使用していたCSSクラスを完全に定義（コピー）

- SuccessConditionsEditor.vue
- FeedbackEditor.vue
- FeedbackLineItem.vue
- DialogueListEditor.vue

**学習点**:
Vue 3のscoped styleはコンポーネント境界を越えて継承されない。ユーティリティクラスが必要な場合はグローバルスタイル（style.css）に定義するか、各コンポーネント内で重複を許容する必要がある。

---

### 2. EmotionPickerDialog のメソッド名

**指摘内容**:
DialogueListEditorで `open()` メソッドを呼び出そうとしたが、EmotionPickerDialogで expose されているのは `showModal()` だった

**修正コード**:

```typescript
// 修正前
const pickerRef = emotionPickerRefs.value[index] as { open?: () => void };
pickerRef?.open?.();

// 修正後
const pickerRef = emotionPickerRefs.value[index] as { showModal?: () => void };
pickerRef?.showModal?.();
```

**学習点**:
コンポーネント参照の型定義時は、実際にexposeされているメソッド名を正確に指定する必要がある。テンプレートでrefを使用する際は、defineExpose で expose されたメソッドが何かを確認してから使用すること。

---

### 3. FeedbackEditorのUI統一

**指摘内容**:
FeedbackEditorのUIがDialogueListEditorと異なり、ユーザーの混乱を招く可能性

**対応方法**:

- FeedbackEditor.vueのsummaryレイアウトをDialogueListEditorと統一
- `.feedback-header` をsummaryに適用して、ヘッダーパターンを統一
- `.feedback-group-header` を新規追加して、各グループのヘッダーを統一

**学習点**:
エディタ内の複数セクションは統一されたUIパターンを使用すべき。トップレベルとグループレベルの階層構造を明確にするためにクラス名を分ける必要がある。

---

### 4. FeedbackLineItemのUI流用

**指摘内容**:
FeedbackLineItemがDialogueListEditorと異なるUIを持っており、表情選択方法も異なる（数値入力 vs ボタン）

**対応方法**:

- FeedbackLineItemを完全にDialogueListEditorのHTMLパターンに統一
- 感情の数値入力フィールドを廃止
- EmotionPickerDialog を FeedbackLineItem に統合
- `feedback-header` に表情選択ボタンを配置
- `feedback-actions-buttons` で削除ボタンを管理

**学習点**:
同じようなデータ構造（character + emotion + text）を持つコンポーネントは、UIパターンも統一してユーザー体験を統一すべき。

---

## Phase 3 への適用事項

### CSSの設計

- グローバルなフォームスタイル（.form-input, .form-textarea等）をstyle.cssに定義
- コンポーネント固有のレイアウトスタイル（.flex-row等）をコンポーネント内で定義
- セクション別スタイル（.xxxxx-section等）をコンポーネント内で定義

### コンポーネント参照の型定義

- exposed メソッドを正確に型定義
- オプショナルチェーン（?.）を活用して安全にメソッド呼び出し

### UI統一パターン

- トップレベル summary: flex layout with title and action button
- グループレベル header: flex layout with title and action button
- アイテム行: header row + content row パターン
