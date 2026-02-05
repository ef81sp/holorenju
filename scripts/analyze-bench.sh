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

# レーティング差
echo "【レーティング差（隣接難易度間）】"
jq -r '
  .ratings | to_entries | sort_by(-.value.rating) |
  . as $sorted |
  range(0; length - 1) |
  "\($sorted[.].key) - \($sorted[. + 1].key): \(($sorted[.].value.rating - $sorted[. + 1].value.rating) | floor)"
' "$FILE" | while read line; do echo "  $line"; done
echo ""

# マッチアップ（リスト形式）
echo "【マッチアップ結果】"
jq -r '
  .matchups[] |
  "  \(.playerA) vs \(.playerB): \(.winsA)-\(.winsB)-\(.draws)"
' "$FILE"
echo ""

# プレイヤーリスト取得
PLAYERS=$(jq -r '.options.players | join(" ")' "$FILE")

# 先手(黒)勝敗表
echo "【先手(黒)勝敗表】"
echo "  行=黒番、列=白番、値=黒勝-白勝-引分"
# ヘッダー行
printf "  %10s" ""
for col in $PLAYERS; do
  printf " %10s" "$col"
done
echo ""

for row in $PLAYERS; do
  printf "  %10s" "$row"
  for col in $PLAYERS; do
    result=$(jq -r --arg black "$row" --arg white "$col" '
      [.games[] |
        select(
          ((.isABlack and .playerA == $black and .playerB == $white) or
           ((.isABlack | not) and .playerB == $black and .playerA == $white))
        )
      ] |
      if length == 0 then "-"
      else
        {
          blackWins: [.[] | select((.isABlack and .winner == "A") or ((.isABlack | not) and .winner == "B"))] | length,
          whiteWins: [.[] | select((.isABlack and .winner == "B") or ((.isABlack | not) and .winner == "A"))] | length,
          draws: [.[] | select(.winner == "draw")] | length
        } |
        "\(.blackWins)-\(.whiteWins)-\(.draws)"
      end
    ' "$FILE")
    printf " %10s" "$result"
  done
  echo ""
done
echo ""

# 後手(白)勝敗表
echo "【後手(白)勝敗表】"
echo "  行=白番、列=黒番、値=白勝-黒勝-引分"
# ヘッダー行
printf "  %10s" ""
for col in $PLAYERS; do
  printf " %10s" "$col"
done
echo ""

for row in $PLAYERS; do
  printf "  %10s" "$row"
  for col in $PLAYERS; do
    result=$(jq -r --arg white "$row" --arg black "$col" '
      [.games[] |
        select(
          ((.isABlack and .playerA == $black and .playerB == $white) or
           ((.isABlack | not) and .playerB == $black and .playerA == $white))
        )
      ] |
      if length == 0 then "-"
      else
        {
          whiteWins: [.[] | select((.isABlack and .winner == "B") or ((.isABlack | not) and .winner == "A"))] | length,
          blackWins: [.[] | select((.isABlack and .winner == "A") or ((.isABlack | not) and .winner == "B"))] | length,
          draws: [.[] | select(.winner == "draw")] | length
        } |
        "\(.whiteWins)-\(.blackWins)-\(.draws)"
      end
    ' "$FILE")
    printf " %10s" "$result"
  done
  echo ""
done
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

# 同じ難易度同士の先手/後手バランス
SELF_PLAY_COUNT=$(jq '[.games[] | select(.playerA == .playerB)] | length' "$FILE")
if [ "$SELF_PLAY_COUNT" -gt 0 ]; then
  echo "【同難易度対戦の先手(黒)/後手(白)バランス】"
  jq -r '
    [.games[] | select(.playerA == .playerB)] |
    {
      black: [.[] | select((.isABlack and .winner == "A") or ((.isABlack | not) and .winner == "B"))] | length,
      white: [.[] | select((.isABlack and .winner == "B") or ((.isABlack | not) and .winner == "A"))] | length,
      draw: [.[] | select(.winner == "draw")] | length
    } |
    "  黒勝利: \(.black) (\(if (.black + .white + .draw) > 0 then .black * 100 / (.black + .white + .draw) | floor else 0 end)%)",
    "  白勝利: \(.white) (\(if (.black + .white + .draw) > 0 then .white * 100 / (.black + .white + .draw) | floor else 0 end)%)",
    "  引分け: \(.draw)"
  ' "$FILE"
  echo ""
  echo "  難易度別内訳:"
  for player in $(jq -r '.options.players[]' "$FILE"); do
    result=$(jq -r --arg p "$player" '
      [.games[] | select(.playerA == $p and .playerB == $p)] |
      if length > 0 then
        {
          black: [.[] | select((.isABlack and .winner == "A") or ((.isABlack | not) and .winner == "B"))] | length,
          white: [.[] | select((.isABlack and .winner == "B") or ((.isABlack | not) and .winner == "A"))] | length,
          draw: [.[] | select(.winner == "draw")] | length
        } |
        "\(.black)-\(.white)-\(.draw) (黒\(if (.black + .white + .draw) > 0 then .black * 100 / (.black + .white + .draw) | floor else 0 end)%)"
      else
        "(対戦なし)"
      end
    ' "$FILE")
    echo "    $player: $result"
  done
  echo ""
fi

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

# 難易度別探索効率
echo "【難易度別探索効率】"
for player in $(jq -r '.options.players[]' "$FILE"); do
  jq -r --arg p "$player" '
    [.games[] |
      . as $g |
      range(0; .moveHistory | length) as $i |
      .moveHistory[$i] |
      select(.stats and .stats.nodes > 0) |
      select(
        (if ($i % 2 == 0) == $g.isABlack then $g.playerA else $g.playerB end) == $p
      )
    ] |
    if length > 0 then
      "  \($p): TTヒット \(([.[].stats.ttHits] | add) * 100 / ([.[].stats.nodes] | add) | . * 10 | floor / 10)%, Beta cutoff \(([.[].stats.betaCutoffs] | add) * 100 / ([.[].stats.nodes] | add) | . * 10 | floor / 10)%"
    else
      "  \($p): (データなし)"
    end
  ' "$FILE"
done
echo ""

# 難易度別詳細プロファイリング
echo "【難易度別詳細プロファイリング】"
for player in $(jq -r '.options.players[]' "$FILE"); do
  echo "  --- $player ---"
  jq -r --arg p "$player" '
    [.games[] |
      . as $g |
      range(0; .moveHistory | length) as $i |
      .moveHistory[$i] |
      select(.stats and .stats.nodes > 0) |
      select(
        (if ($i % 2 == 0) == $g.isABlack then $g.playerA else $g.playerB end) == $p
      )
    ] |
    if length > 0 then
      (
        ([.[].stats.forbiddenCheckCalls // 0] | add) as $forbidden |
        ([.[].stats.boardCopies // 0] | add) as $copies |
        ([.[].stats.threatDetectionCalls // 0] | add) as $threats |
        ([.[].stats.evaluationCalls // 0] | add) as $evals |
        ([.[].stats.nodes] | add) as $nodes |
        "    禁手判定: \($forbidden) (ノード比: \(if $nodes > 0 then ($forbidden * 10 / $nodes | floor / 10) else 0 end))",
        "    盤面コピー: \($copies) (ノード比: \(if $nodes > 0 then ($copies * 10 / $nodes | floor / 10) else 0 end))",
        "    脅威検出: \($threats) (ノード比: \(if $nodes > 0 then ($threats * 10 / $nodes | floor / 10) else 0 end))",
        "    評価関数: \($evals) (ノード比: \(if $nodes > 0 then ($evals * 10 / $nodes | floor / 10) else 0 end))"
      )
    else
      "    (データなし)"
    end
  ' "$FILE" 2>/dev/null || echo "    (データなし)"
done
echo ""

# 難易度別選択順位分布
echo "【難易度別選択順位分布】"
for player in $(jq -r '.options.players[]' "$FILE"); do
  echo -n "  $player: "
  jq -r --arg p "$player" '
    [.games[] |
      . as $g |
      range(0; .moveHistory | length) as $i |
      .moveHistory[$i] |
      select(
        (if ($i % 2 == 0) == $g.isABlack then $g.playerA else $g.playerB end) == $p
      ) |
      select(.candidates) |
      {selectedRank: (.selectedRank // "out")}
    ] |
    if length > 0 then
      group_by(.selectedRank) |
      map(
        if .[0].selectedRank == "out" then "候補外:\(length)"
        else "R\(.[0].selectedRank):\(length)"
        end
      ) |
      join(", ")
    else
      "(データなし)"
    end
  ' "$FILE"
done
echo ""

# 難易度別ランダム選択による悪手
echo "【難易度別ランダム悪手（スコア差500以上）】"
for player in $(jq -r '.options.players[]' "$FILE"); do
  count=$(jq -r --arg p "$player" '
    [.games[] |
      . as $g |
      range(0; .moveHistory | length) as $i |
      .moveHistory[$i] |
      select(.randomSelection.wasRandom == true) |
      select(.candidates and (.candidates | length) > 1) |
      select((.candidates[0].searchScore - .score) > 500) |
      select(
        (if ($i % 2 == 0) == $g.isABlack then $g.playerA else $g.playerB end) == $p
      )
    ] | length
  ' "$FILE")
  echo "  $player: ${count}回"
done
echo ""

# 難易度別禁手負け
echo "【難易度別禁手負け】"
for player in $(jq -r '.options.players[]' "$FILE"); do
  count=$(jq -r --arg p "$player" '
    [.games[] |
      select(.reason == "forbidden") |
      select(
        (.isABlack and .playerA == $p and .winner == "B") or
        ((.isABlack | not) and .playerB == $p and .winner == "A")
      )
    ] | length
  ' "$FILE")
  echo "  $player: ${count}回"
done
echo ""

# 禁手負け詳細
FORBIDDEN_COUNT=$(jq '[.games[] | select(.reason == "forbidden")] | length' "$FILE")
if [ "$FORBIDDEN_COUNT" -gt 0 ]; then
  echo "【禁手負けの詳細】"
  jq -r '
    .games | to_entries | .[] |
    select(.value.reason == "forbidden") |
    .value as $g |
    # 黒番（禁手負け側）を特定
    (if $g.isABlack then $g.playerA else $g.playerB end) as $loser |
    # 白番（勝者）を特定
    (if $g.isABlack then $g.playerB else $g.playerA end) as $winner |
    # 最終手のforcedForbiddenをチェック
    ($g.moveHistory[-1].forcedForbidden // false) as $forced |
    (if $forced then "禁手追い込み" else "自滅" end) as $type |
    "  game \(.key): \($winner)が\($type)で勝利 (\($g.playerA) vs \($g.playerB), \($g.moves)手)"
  ' "$FILE"
  echo ""

  # 禁手追い込み成功数を表示
  jq -r '
    [.games[] | select(.reason == "forbidden")] as $forbidden |
    [$forbidden[] | select(.moveHistory[-1].forcedForbidden == true)] | length as $forced |
    $forbidden | length as $total |
    "  禁手追い込み成功: \($forced)/\($total)件"
  ' "$FILE"
  echo ""
fi

echo "=== 分析完了 ==="
