---
name: profile-cpu
description: CPU探索エンジン（Zig/WASM）の関数別プロファイルを取得・分析
allowed-tools:
  - Bash(node:*)
  - Bash(ls:*)
  - Bash(tail:*)
  - Bash(mv:*)
  - Read
  - Glob
---

# CPU探索プロファイリング

## 概要

Zig/WASM の CPU 探索エンジンの関数別 CPU 使用率を計測し、ボトルネックを特定する。

## 使用方法

```
/profile-cpu              # 2局でプロファイル取得・分析
/profile-cpu --games=5    # 5局でプロファイル取得
```

## 実行手順

### 1. profile-bench.ts でプロファイル取得

```bash
node --cpu-prof --cpu-prof-dir=bench-results \
  --experimental-strip-types --import ./scripts/register-loader.mjs \
  scripts/profile-bench.ts --games=2
```

- `--cpu-prof`: V8 サンプリングプロファイラを有効化
- 2局で十分（プロファイラのオーバーヘッドで通常の5-10倍遅くなる）
- `.cpuprofile` ファイルが `bench-results/` に生成される

### 2. プロファイル結果の解析

生成された `.cpuprofile` を Node.js で解析:

```javascript
node -e "
const fs = require('fs');
const profile = JSON.parse(fs.readFileSync('bench-results/CPU.*.cpuprofile', 'utf8'));
const nodes = profile.nodes || [];
const selfTimes = {};
for (const node of nodes) {
  const name = node.callFrame?.functionName || '(unknown)';
  const url = node.callFrame?.url || '';
  const key = name + (url.includes('wasm') ? ' [wasm]' : '');
  if (!selfTimes[key]) selfTimes[key] = { hitCount: 0, name: key };
  selfTimes[key].hitCount += node.hitCount || 0;
}
const sorted = Object.values(selfTimes).sort((a, b) => b.hitCount - a.hitCount);
const total = sorted.reduce((s, x) => s + x.hitCount, 0);
console.log('Top 15 functions by sample count:');
for (const item of sorted.slice(0, 15)) {
  const pct = (item.hitCount / total * 100).toFixed(1);
  console.log('  ' + pct + '%  ' + item.name);
}
"
```

最新の `.cpuprofile` ファイルを glob で見つけてから解析すること。

### 3. 結果の報告

関数名（`[wasm]` 付き）と CPU 比率を表形式で報告する。

## 注意事項

- `--cpu-prof` は V8 サンプリングプロファイラ。WASM 関数名は Zig ビルド時に name section が残っていれば表示される（`strip = false`、デフォルト）
- プロファイラのオーバーヘッドで実行時間は5-10倍に膨れる。絶対時間ではなく**相対比率**を見ること
- `.cpuprofile` は Chrome DevTools の Performance タブでも開ける（Flame chart 表示）
- WASM内部でのタイミング計測は WASM→JS 境界のオーバーヘッドが大きく不正確。`node --cpu-prof` の方が信頼性が高い

## 過去のプロファイル結果（参考）

### 2026-04-07 最適化後

| 関数                    | CPU比率 |
| ----------------------- | ------- |
| checkJumpFour           | 37.1%   |
| isNearExistingStone     | 13.5%   |
| analyzeDirectionOnCells | 11.9%   |
| checkJumpThree          | 9.7%    |
| checkFive               | 7.5%    |
| createsFour             | 4.3%    |

### 2026-04-07 最適化前

| 関数                    | CPU比率   |
| ----------------------- | --------- |
| **getLine**             | **34.5%** |
| checkJumpFour           | 18.0%     |
| isNearExistingStone     | 10.6%     |
| analyzeDirectionOnCells | 10.0%     |
| checkFive               | 5.7%      |

## 関連ファイル

- `scripts/profile-bench.ts` — ベンチマーク対局スクリプト
- `zig/src/profiler.zig` — WASM内タイミング計測（参考、現在未統合）
