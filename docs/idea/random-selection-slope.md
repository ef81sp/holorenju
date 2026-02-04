# ランダム選択の傾斜付け

## 現状

ランダム選択時、`scoreThreshold` 以内の候補手から**一様分布**で選択。
1位も5位も同じ確率で選ばれる。

```typescript
const randomIndex = Math.floor(Math.random() * validMoves.length);
```

## 課題

- 「僅差の2位」も「大差の5位」も同確率で選ばれるのは不自然
- beginnerが強すぎる可能性がある

## 提案: スコア差ベースの重み付け

```typescript
// 確率 = (threshold - diff) / threshold
const weight = Math.max(0, scoreThreshold - (bestScore - m.score));
```

- 僅差の手 → 選ばれやすい（自然な「うっかり」）
- 大差の手 → 選ばれにくい（致命的ミスは減る）

## 懸念

スコア差ベースだと「良い手が選ばれやすくなる」ため、beginnerが強くなる。

## 解決案

### A. 難易度ごとに傾斜の有無を選択

| 難易度   | 傾斜             | 挙動                   |
| -------- | ---------------- | ---------------------- |
| beginner | なし（一様分布） | 現状維持               |
| easy     | なし or 弱い傾斜 | 調整次第               |
| medium   | あり             | 僅差の手が選ばれやすい |
| hard     | -                | ランダムなし           |

### B. 逆傾斜パラメータを追加

```typescript
slopeDirection: 1 | 0 | -1;
```

- 1: 上位有利（良い手が選ばれやすい）
- 0: 一様分布
- -1: 下位有利（悪手が選ばれやすい）← わざとらしい？

### C. 傾斜の強さをパラメータ化（推奨）

```typescript
interface DifficultyParams {
  // ...既存のパラメータ
  slopeStrength: number; // 0〜1
}
```

- 0 = 一様分布（現状と同じ）
- 1 = 完全なスコア差ベース

設定例:

- beginner: 0（現状維持）
- easy: 0.3
- medium: 0.8
- hard: -（ランダムなし）

## 実装時の注意

- 傾斜を入れるとbeginnerが強くなる可能性
- ベンチマークで効果を検証すること
- beginnerは一様分布のまま維持が無難かも
