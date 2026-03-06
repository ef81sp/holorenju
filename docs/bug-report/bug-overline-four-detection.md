# Bug: 長連筋の四を有効な四として誤検出

## 概要

黒番で四追い（VCF）を行う際、五を作ると長連（6連以上）になる筋の四を有効な四として検出し、無効な四追いを実行してしまう。

## 再現対局

- 手動対局（CPU黒、hard）

```
H8 H9 I8 G8 I9 I10 J11 G7 G9 H10 F10 I7 F7 H7 F9 F8 E11 D12 E9 D9 E8 E10 G11 H12 C6 D7 F11 D11 F12 F13 H11 D10 D8 D13
```

31手目 H11 が問題の手。

## 盤面（30手目後、H11着手前）

```
15: ・・・・・・・・・・・・・・・
14: ・・・・・・・・・・・・・・・
13: ・・・・・○・・・・・・・・・
12: ・・・○・●・○・・・・・・・
11: ・・・○●●●・・●・・・・・
10: ・・・・○●・○○・・・・・・
 9: ・・・○●●●○●・・・・・・
 8: ・・・・●○○●●・・・・・・
 7: ・・・○・●○○○・・・・・・
 6: ・・●・・・・・・・・・・・・
    A B C D E F G H I J K L M N O
```

## 症状

- CPUが H11(4,7) を四追い手として選択
- H11 を打つと横方向に E11-F11-G11-H11 の4連ができ、I11(4,8)が空なので「止め四」と判定
- しかし J11(4,9) に既に黒石があるため、I11 に打って五を作ると E11-F11-G11-H11-I11-J11 = **6連 = 長連（禁手）**
- この四は**長連筋**であり、五を完成できないため四として成立しない

## 想定される原因

`src/logic/cpu/search/threatMoves.ts` の `createsFour()` / `classifyThreat()`:

```typescript
const count = countLine(board, row, col, dr, dc, color);
if (count === 4) {
  const { end1Open, end2Open } = checkEnds(...);
  if (end1Open || end2Open) {
    return true;  // ← 端が空いていれば四と判定
  }
}
```

- `countLine` は連続石のみカウント（J11は間が空いてカウントされず `4` を返す）
- `checkEnds` は端の1マスが空かどうかだけ確認し、**さらにその先に自石があって長連になるかを検証しない**
- 黒番でのみ発生する問題（白には長連禁手がない）

### 影響範囲

- `createsFour()` — VCF/VCT探索の四検出
- `classifyThreat()` — 同上（1パス版）
- 評価関数のパターン検出にも同様の問題がある可能性

## 修正方針

黒番の四判定で、開いている端の先にさらに自石があるかチェックする:

```typescript
if (count === 4 && color === "black") {
  // 開いている端に打つと長連になるか確認
  // end1Open の先に自石がある → end1 は無効
  // end2Open の先に自石がある → end2 は無効
  // 両方無効なら四として成立しない
}
```

## 修正状況

- [x] 原因特定
- [x] 修正実装
  - `checkEndsForFour`: 黒番で開き端の先に黒石がある場合その端を closed にする
  - `isJumpFourOverline`: 跳び四のギャップを埋めると長連になるかチェック
  - 全5箇所（threatMoves.ts×2, techniques.ts×2, threatPatterns.ts×1）修正
- [x] テスト追加
  - `lineAnalysis.test.ts`: checkEndsForFour 5ケース
  - `threatMoves.test.ts`: 長連筋の四判定 8ケース
