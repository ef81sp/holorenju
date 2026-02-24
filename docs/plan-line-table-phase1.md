# Phase 1: LineTable 基盤

> 既存コードに一切影響しない。新規モジュールのみ。

## 新規ファイル

### `src/logic/cpu/lineTable/lineTable.ts`

データ構造とCRUD操作。SoA (Structure of Arrays) レイアウトで `Uint16Array` を使用し、キャッシュ効率を確保する。

```typescript
/**
 * 72本のラインをビットマスクで管理するテーブル
 * SoA レイアウト: 各配列は72要素、連続メモリに配置される
 * - blacks: Uint16Array(72) = 144 bytes（2キャッシュラインに収まる）
 * - whites: Uint16Array(72) = 144 bytes
 */
interface LineTable {
  blacks: Uint16Array; // 各ラインの黒石ビットマスク
  whites: Uint16Array; // 各ラインの白石ビットマスク
}
```

※ ライン長（5~15）は盤面幾何で静的に決まるため、`lineMapping.ts` の `LINE_LENGTHS` 定数で管理する。`LineTable` のフィールドには含めない。

#### 関数

| 関数                               | 説明                          | 計算量 |
| ---------------------------------- | ----------------------------- | ------ |
| `createEmptyLineTable()`           | `Uint16Array(72)` ×2 を初期化 | O(1)   |
| `buildLineTable(board)`            | BoardState から全ラインを構築 | O(225) |
| `placeStone(lt, row, col, color)`  | 4ラインの該当ビットを OR      | O(1)×4 |
| `removeStone(lt, row, col, color)` | 4ラインの該当ビットを AND NOT | O(1)×4 |

#### ビット演算の例

```typescript
// placeStone: ビットを立てる
lt.blacks[lineId] |= 1 << bitPos;

// removeStone: ビットを下ろす
lt.blacks[lineId] &= ~(1 << bitPos);
```

### `src/logic/cpu/lineTable/lineMapping.ts`

セル座標 → ライン情報のマッピング。モジュール初期化時に1度だけ生成する静的テーブル。

```typescript
interface LineMappingEntry {
  lineId: number; // 0~71
  bitPos: number; // 0~14（ライン内でのビット位置）
  dirIndex: number; // 0~3 (横/縦/↘/↗)
}
```

#### 定数・関数

| 名前                     | 説明                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| `LINE_LENGTHS`           | `Uint8Array(72)` — 各ラインの長さ（5~15）。盤面幾何から静的に決定 |
| `CELL_TO_LINES`          | 225セル×最大4方向のマッピング配列（モジュール初期化時に生成）     |
| `getCellLines(row, col)` | 指定セルが属するラインのエントリ配列を返す（2~4エントリ）         |

※ `getCellLines` は事前に計算された配列への参照を返す（呼び出しごとに新規配列を生成しない）。

#### ホットパス向けフラット化テーブル（オプション）

Phase 2 で `evaluateStonePatternsWithBreakdown` のホットパスに組み込む際、関数呼び出しオーバーヘッドを排除するため、フラット化テーブルも用意する:

```typescript
// CELL_LINES_FLAT: Uint16Array(225 * 4)
// packed = CELL_LINES_FLAT[(row * 15 + col) * 4 + dirIndex]
// lineId = packed >> 8
// bitPos = packed & 0xFF
const CELL_LINES_FLAT: Uint16Array;
```

#### lineId 番号体系

```
lineId  方向    インデックス          ライン長
0~14    横      row = 0~14           常に15
15~29   縦      col = 0~14           常に15
30~50   斜め↘   row-col = -10..+10   5~15（中央が最長）
51~71   斜め↗   row+col = 4..24      5~15（中央が最長）
```

#### マッピング例

| セル    | 横lineId      | 縦lineId      | ↘lineId       | ↗lineId             |
| ------- | ------------- | ------------- | ------------- | ------------------- |
| (0,0)   | 0, bitPos=0   | 15, bitPos=0  | 40, bitPos=0  | — (row+col=0 < 4)   |
| (7,7)   | 7, bitPos=7   | 22, bitPos=7  | 40, bitPos=7  | 65, bitPos=7        |
| (14,14) | 14, bitPos=14 | 29, bitPos=14 | 40, bitPos=14 | — (row+col=28 > 24) |

※ 斜めラインの長さが5未満のものは五連不可のため除外

## テスト

### `src/logic/cpu/lineTable/lineTable.test.ts`

| テストケース       | 内容                                                             |
| ------------------ | ---------------------------------------------------------------- |
| 空盤初期化         | `createEmptyLineTable()` → 全72ラインの blacks/whites が 0       |
| 1石配置            | `placeStone(lt, 7, 7, "black")` → 4ラインの対応ビットが 1        |
| 配置→除去          | `placeStone` → `removeStone` → ビットマスクが元通り              |
| buildLineTable一致 | `buildLineTable(board)` と手動 `placeStone` 積み上げの結果が一致 |
| 白黒混在           | 黒ビットと白ビットが独立に管理されること                         |
| 盤端               | (0,0), (0,14), (14,0), (14,14) での正しいビット設定              |

### `src/logic/cpu/lineTable/lineMapping.test.ts`

| テストケース           | 内容                                                     |
| ---------------------- | -------------------------------------------------------- |
| LINE_LENGTHS           | 横/縦ラインは15、斜めラインは幾何に一致                  |
| 中央セル               | (7,7) で 4エントリ、各 lineId/bitPos が正しい            |
| 角セル                 | (0,0) で 2~3エントリ（斜め↗がない）                      |
| 全セル検証             | 225セルすべてのエントリ数が 2~4                          |
| lineId重複なし         | 同一セルのエントリ内で lineId が重複しない               |
| dirIndex網羅           | 中央付近のセルで dirIndex が 0,1,2,3 すべて存在          |
| フラット化テーブル一致 | `CELL_LINES_FLAT` と `getCellLines` の結果が全セルで一致 |

## 検証

```bash
pnpm vitest run src/logic/cpu/lineTable/
```
