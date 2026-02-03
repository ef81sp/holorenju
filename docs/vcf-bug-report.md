# VCF バグレポート

## ステータス: 修正済み

## 概要

VCF（Victory by Continuous Fours）の判定で、白番の跳び四チェックが誤動作していた。`checkJumpFour` 関数が常に黒の石でチェックしていたため、白番でVCFが誤検出されていた。

## 修正日

2026-02-01

## 修正内容

### 1. `checkJumpFour` に色パラメータを追加（必須）

**ファイル**: `src/logic/renjuRules.ts:729-831`

```typescript
export function checkJumpFour(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
  color: StoneColor, // 必須パラメータ（デフォルト値なし）
): boolean {
  // ...
  testRow[col] = color; // 修正: "black" → color
  // ...
  lineStones.push(color); // 修正: "black" → color
  // ...
  // パターンマッチングも color を使用
}
```

### 2. 全ての呼び出し箇所に色を追加

| ファイル            | 箇所                      | 色        |
| ------------------- | ------------------------- | --------- |
| `renjuRules.ts:856` | 禁手チェック              | `"black"` |
| `vcf.ts:275`        | createsFour               | `color`   |
| `vcf.ts:394`        | getFourDefensePosition    | `color`   |
| `evaluation.ts:428` | analyzeJumpPatterns       | `color`   |
| `evaluation.ts:503` | countThreatDirections     | `color`   |
| `evaluation.ts:584` | checkWhiteWinningPattern  | `"white"` |
| `vct.ts:226`        | createsFour               | `color`   |
| `vct.ts:398`        | getThreatDefensePositions | `color`   |

## 修正結果

修正前:

```
白のVCF: { row: 10, col: 4 }  // 誤検出
AIの選択: { row: 10, col: 4 }  // VCFを優先
```

修正後:

```
白のVCF: null  // 正しくnull
AIの選択: { row: 9, col: 5 }  // 正しく活三を防御
```

## 関連ファイル

- `src/logic/renjuRules.ts` - `checkJumpFour` 関数
- `src/logic/cpu/vcf.ts` - VCF探索
- `src/logic/cpu/vct.ts` - VCT探索
- `src/logic/cpu/evaluation.ts` - 評価関数

## テスト

- すべての既存テストがパス
- 禁手チェックは影響なし（明示的に `"black"` を渡すように修正）
