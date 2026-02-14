<script setup lang="ts">
import { computed } from "vue";
import type { BrowseFilter, GameAnalysis, Tag } from "@scripts/types/analysis";

interface Props {
  games: GameAnalysis[];
  selectedIndex: number | null;
  filter: BrowseFilter;
  availableMatchups: string[];
  availableJushu: string[];
  availableTags: string[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  select: [index: number];
  "update:filter": [filter: BrowseFilter];
}>();

const updateFilter = (partial: Partial<BrowseFilter>): void => {
  emit("update:filter", { ...props.filter, ...partial });
};

const winnerLabel = (winner: "A" | "B" | "draw"): string => {
  switch (winner) {
    case "A":
      return "黒勝";
    case "B":
      return "白勝";
    case "draw":
      return "引分";
  }
};

const formatTags = (tags: Tag[]): string => tags.slice(0, 3).join(", ");

const selectedTagValue = computed(() => props.filter.tags?.[0] ?? "");
</script>

<template>
  <div class="game-list-panel">
    <div class="filters">
      <select
        :value="filter.matchup ?? ''"
        @change="
          updateFilter({
            matchup: ($event.target as HTMLSelectElement).value || undefined,
          })
        "
      >
        <option value="">全マッチアップ</option>
        <option
          v-for="m in availableMatchups"
          :key="m"
          :value="m"
        >
          {{ m }}
        </option>
      </select>

      <select
        :value="filter.winner ?? ''"
        @change="
          updateFilter({
            winner:
              (($event.target as HTMLSelectElement).value as
                | 'black'
                | 'white'
                | 'draw') || undefined,
          })
        "
      >
        <option value="">全勝者</option>
        <option value="black">黒勝</option>
        <option value="white">白勝</option>
        <option value="draw">引分</option>
      </select>

      <select
        :value="selectedTagValue"
        @change="
          updateFilter({
            tags: ($event.target as HTMLSelectElement).value
              ? ([($event.target as HTMLSelectElement).value] as Tag[])
              : undefined,
          })
        "
      >
        <option value="">全タグ</option>
        <option
          v-for="t in availableTags"
          :key="t"
          :value="t"
        >
          {{ t }}
        </option>
      </select>

      <select
        :value="filter.jushu ?? ''"
        @change="
          updateFilter({
            jushu: ($event.target as HTMLSelectElement).value || undefined,
          })
        "
      >
        <option value="">全珠型</option>
        <option
          v-for="j in availableJushu"
          :key="j"
          :value="j"
        >
          {{ j }}
        </option>
      </select>
    </div>

    <div class="game-count">{{ games.length }} 件</div>

    <div class="game-table-wrapper">
      <table class="game-table">
        <thead>
          <tr>
            <th>#</th>
            <th>マッチアップ</th>
            <th>結果</th>
            <th>手数</th>
            <th>タグ</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(game, i) in games"
            :key="game.gameId"
            :class="{ selected: i === selectedIndex }"
            @click="emit('select', i)"
          >
            <td>{{ i + 1 }}</td>
            <td>{{ game.matchup }}</td>
            <td>{{ winnerLabel(game.winner) }}</td>
            <td>{{ game.totalMoves }}</td>
            <td class="tags-cell">{{ formatTags(game.gameTags) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.game-list-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-width: 0;
}

.filters {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.filters select {
  font-size: 12px;
  padding: 2px 4px;
  border: 1px solid #ccc;
  border-radius: 3px;
  min-width: 0;
  flex: 1;
}

.game-count {
  font-size: 12px;
  color: #666;
}

.game-table-wrapper {
  flex: 1;
  overflow-y: auto;
  border: 1px solid #ddd;
  border-radius: 3px;
}

.game-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.game-table th {
  position: sticky;
  top: 0;
  background: #f5f5f5;
  border-bottom: 1px solid #ddd;
  padding: 4px 6px;
  text-align: left;
  font-weight: 500;
  white-space: nowrap;
}

.game-table td {
  padding: 3px 6px;
  border-bottom: 1px solid #eee;
  white-space: nowrap;
}

.game-table tbody tr {
  cursor: pointer;
}

.game-table tbody tr:hover {
  background: #f0f7ff;
}

.game-table tbody tr.selected {
  background: #d0e4ff;
}

.tags-cell {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
