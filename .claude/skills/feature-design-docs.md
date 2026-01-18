# 機能設計ドキュメントの書き方

## 概要

新機能の設計ドキュメントを `docs/` 配下に作成する際のフォーマット。

## ディレクトリ構成

```
docs/{feature-name}/
├── 00-overview.md      # 全体概要
├── 01-phase1-xxx.md    # Phase 1
├── 02-phase2-xxx.md    # Phase 2
└── ...
```

## 00-overview.md の構成

1. **目的** - 機能の目的を1-2文で
2. **構造/レイヤー** - 表形式で階層や構成要素を説明
3. **重要な設計判断** - ID体系、保存先、参照方式など
4. **実装フェーズ一覧** - 各フェーズの概要を箇条書き

## 各フェーズドキュメントの構成

1. **目標** - そのフェーズで達成すること
2. **タスク詳細** - 番号付きセクション（2.1, 2.2...）
   - 追加するAPI/型を箇条書きで列挙
   - 動作・仕様を言葉で説明
3. **変更対象ファイル** - 新規/変更を明記
4. **単体テスト** - テストファイル名とテストケースを箇条書き

## 記述スタイル

- **コード例は最小限** - 型名・関数名・引数を箇条書きで示す
- **仕様は言葉で説明** - 動作・制約・エッジケースを散文で記述
- **表を活用** - 構造や選択肢の比較には表を使う

## 例：API記述

悪い例（コード例が長い）:

```typescript
function addEnvelope(
  name: string,
  displayName: string,
  settings: EnvelopeSettings,
): string {
  const id = createCustomId("envelope");
  // ...
}
```

良い例（箇条書き）:

- `addEnvelope(name, displayName, settings)` - カスタムプリセット追加、IDを返す

## 例：仕様記述

悪い例（実装詳細）:

```typescript
const deletedIds = ref<Set<string>>(new Set());
```

良い例（言葉で説明）:

> 削除された組み込みプリセットIDを `Set` で追跡。復元時は該当IDをSetから削除するだけ。
