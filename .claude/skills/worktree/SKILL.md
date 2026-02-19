---
name: worktree
description: Git ワークツリーを作成・管理
allowed-tools:
  - Bash(git worktree:*)
  - Bash(ln -s:*)
  - Bash(ls:*)
  - Bash(pwd:*)
  - Bash(mkdir:*)
---

# Git ワークツリー管理

## 概要

並行作業用の Git ワークツリーを作成する。node_modules は本体リポジトリからシンボリックリンクして共有する。

## 使用方法

```
/worktree <branch-name>           # 新規ブランチでワークツリー作成
/worktree <branch-name> --list    # 既存ワークツリー一覧
/worktree <branch-name> --remove  # ワークツリー削除
```

## 作成手順

### 1. メインリポジトリのパスを確認

```bash
git worktree list
```

メインリポジトリのパス（`/Users/.../holorenju`）を取得する。

### 2. ワークツリーを作成

ワークツリーは **メインリポジトリの親ディレクトリ** に `holorenju--<branch>` として作成する。

```bash
# 新規ブランチの場合
git worktree add ../holorenju--<branch> -b <branch>

# 既存ブランチの場合
git worktree add ../holorenju--<branch> <branch>
```

**命名規則**: `holorenju--<branch>`（ダブルハイフン区切り）

### 3. node_modules をシンボリックリンク

```bash
ln -s /Users/.../holorenju/node_modules ../holorenju--<branch>/node_modules
```

**重要**: 絶対パスでシンボリックリンクすること（相対パスだとワークツリー内での解決が不安定になる）。

### 4. 完了報告

以下の情報をユーザーに報告する:

- ワークツリーのパス
- ブランチ名
- node_modules のリンク状態

## 一覧表示

```bash
git worktree list
```

## 削除手順

```bash
git worktree remove ../holorenju--<branch>
```

削除時は node_modules シンボリックリンクも自動的に消える（ワークツリーディレクトリごと消えるため）。

## 注意事項

- 同じブランチを複数のワークツリーでチェックアウトすることはできない
- ワークツリー内で `pnpm install` は**実行しない**（シンボリックリンクが壊れる）
- 依存関係を更新した場合はメインリポジトリで `pnpm install` を実行すれば全ワークツリーに反映される
- `.claude/` ディレクトリはリポジトリに含まれるため、ワークツリーにも自動的にコピーされる
