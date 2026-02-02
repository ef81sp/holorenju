#!/bin/bash
# ベンチマーク結果分析スクリプト
# Usage: ./scripts/analyze-bench.sh [結果ファイル.json]

FILE="${1:-$(ls -t bench-results/*.json 2>/dev/null | head -1)}"

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Usage: $0 <bench-result.json>"
  echo "  or place results in bench-results/"
  exit 1
fi

echo "=== ベンチマーク分析: $(basename "$FILE") ==="
echo ""

# 基本情報
echo "【基本情報】"
jq -r '
  "  日時: \(.timestamp)",
  "  総ゲーム数: \(.games | length)",
  "  プレイヤー: \(.options.players | join(", "))",
  "  各マッチアップ: \(.options.gamesPerMatchup)ゲーム"
' "$FILE"
echo ""

# レーティング
echo "【レーティング結果】"
jq -r '
  .ratings | to_entries | sort_by(-.value.rating) | .[] |
  "  \(.key): \(.value.rating | floor) (\(.value.wins)W-\(.value.losses)L-\(.value.draws)D, \(.value.wins * 100 / .value.games | floor)%)"
' "$FILE"
echo ""

# マッチアップ
echo "【マッチアップ結果】"
jq -r '
  .matchups[] |
  "  \(.playerA) vs \(.playerB): \(.winsA)-\(.winsB)-\(.draws)"
' "$FILE"
echo ""

# 先手/後手勝率
echo "【先手(黒)/後手(白)勝率】"
jq -r '
  {
    black: [.games[] | select((.isABlack and .winner == "A") or ((.isABlack | not) and .winner == "B"))] | length,
    white: [.games[] | select((.isABlack and .winner == "B") or ((.isABlack | not) and .winner == "A"))] | length,
    draw: [.games[] | select(.winner == "draw")] | length
  } |
  "  黒勝利: \(.black) (\(.black * 100 / (.black + .white + .draw) | floor)%)",
  "  白勝利: \(.white) (\(.white * 100 / (.black + .white + .draw) | floor)%)",
  "  引分け: \(.draw)"
' "$FILE"
echo ""

# 勝利理由
echo "【勝利理由】"
jq -r '
  .games | group_by(.reason) | .[] |
  "  \(.[0].reason): \(length)"
' "$FILE"
echo ""

# 難易度別探索統計
echo "【難易度別探索統計】"
for player in $(jq -r '.options.players[]' "$FILE"); do
  echo "  --- $player ---"
  jq -r --arg p "$player" '
    [.games[] |
      . as $g |
      range(0; .moveHistory | length) as $i |
      .moveHistory[$i] |
      select(.stats) |
      select(
        (if ($i % 2 == 0) == $g.isABlack then $g.playerA else $g.playerB end) == $p
      )
    ] |
    if length > 0 then
      "    着手数: \(length)",
      "    平均ノード: \([.[].stats.nodes] | add / length | floor)",
      "    最大ノード: \([.[].stats.nodes] | max)",
      "    平均到達深度: \([.[].stats.completedDepth] | add / length * 10 | floor / 10)",
      "    設定深度: \(.[0].stats.maxDepth)",
      "    中断率: \([.[].stats | select(.interrupted)] | length * 100 / length | floor)%"
    else
      "    (データなし)"
    end
  ' "$FILE" 2>/dev/null || echo "    (データなし)"
done
echo ""

# 深度分布
echo "【深度分布】"
for player in $(jq -r '.options.players[]' "$FILE"); do
  echo -n "  $player: "
  jq -r --arg p "$player" '
    [.games[] |
      . as $g |
      range(0; .moveHistory | length) as $i |
      .moveHistory[$i] |
      select(.stats) |
      select(
        (if ($i % 2 == 0) == $g.isABlack then $g.playerA else $g.playerB end) == $p
      ) |
      .stats.completedDepth
    ] |
    if length > 0 then
      group_by(.) | map("d\(.[0]):\(length)") | join(", ")
    else
      "(データなし)"
    end
  ' "$FILE" 2>/dev/null || echo "(データなし)"
done
echo ""

echo "=== 分析完了 ==="
