---
name: download-icon
description: Material Symbols アイコンをダウンロードして配置
---

# Material Symbols アイコンのダウンロード

## 概要

Google Material Symbols Outlined (weight 400) のSVGアイコンを公式リポジトリからダウンロードし、プロジェクトに追加する。

## 手順

### 1. アイコン名を確認

[Material Symbols](https://fonts.google.com/icons?icon.set=Material+Symbols) で検索し、アイコン名を確認する（例: `info`, `settings`, `close`）。

### 2. ダウンロード

```bash
curl -sL "https://raw.githubusercontent.com/google/material-design-icons/master/symbols/web/{name}/materialsymbolsoutlined/{name}_24px.svg" -o "src/assets/icons/{name}.svg"
```

`{name}` をアイコン名に置換する。

### 3. `fill="currentColor"` を追加

ダウンロードしたSVGの `<svg` タグに `fill="currentColor"` を追加する。

変更前:

```xml
<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24">
```

変更後:

```xml
<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
```

### 4. コンポーネントで使用

```vue
<script setup lang="ts">
import InfoIcon from "@/assets/icons/info.svg?component";
</script>

<template>
  <InfoIcon />
</template>
```

SVGコンポーネントはVueコンポーネントとして振る舞うため、`v-html` は不要。CSSの `color` プロパティでアイコン色を制御できる。

## 既存アイコン一覧

| ファイル名         | Material Symbol名 | 用途             |
| ------------------ | ----------------- | ---------------- |
| `info.svg`         | info              | 情報ボタン       |
| `settings.svg`     | settings          | 設定ボタン       |
| `close.svg`        | close             | ダイアログ閉じる |
| `content_copy.svg` | content_copy      | コピー           |
| `check.svg`        | check             | チェックマーク   |
| `visibility.svg`   | visibility        | 表示切替         |
