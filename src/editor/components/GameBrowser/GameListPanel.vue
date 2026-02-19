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
  availableSourceFiles: string[];
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
    default:
      return "";
  }
};

const formatTags = (tags: Tag[]): string => tags.slice(0, 3).join(", ");

const selectedTags = computed(() => props.filter.tags ?? []);

const addTag = (tag: string): void => {
  if (!tag) {
    return;
  }
  const current = props.filter.tags ?? [];
  if (current.includes(tag as Tag)) {
    return;
  }
  updateFilter({ tags: [...current, tag as Tag] });
};

const removeTag = (tag: Tag): void => {
  const next = (props.filter.tags ?? []).filter((t) => t !== tag);
  updateFilter({ tags: next.length > 0 ? next : undefined });
};

const formatSourceFile = (name: string): string => {
  // "bench-2026-02-14T10-33-51-517Z.json" → "02/14 10:33"
  const m = name.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/);
  if (!m) {
    return name;
  }
  return `${m[2]}/${m[3]} ${m[4]}:${m[5]}`;
};
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
        value=""
        @change="
          addTag(($event.target as HTMLSelectElement).value);
          ($event.target as HTMLSelectElement).value = '';
        "
      >
        <option value="">タグ追加...</option>
        <option
          v-for="t in availableTags"
          :key="t"
          :value="t"
          :disabled="selectedTags.includes(t as Tag)"
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

      <select
        :value="filter.sourceFile ?? ''"
        @change="
          updateFilter({
            sourceFile: ($event.target as HTMLSelectElement).value || undefined,
          })
        "
      >
        <option value="">全ベンチマーク</option>
        <option
          v-for="sf in availableSourceFiles"
          :key="sf"
          :value="sf"
        >
          {{ formatSourceFile(sf) }}
        </option>
      </select>
    </div>

    <div
      v-if="selectedTags.length > 0"
      class="selected-tags"
    >
      <span
        v-for="tag in selectedTags"
        :key="tag"
        class="tag-chip"
        @click="removeTag(tag)"
      >
        {{ tag }} ✕
      </span>
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
  min-height: 0;
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

.selected-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.tag-chip {
  font-size: 11px;
  padding: 1px 6px;
  background: #d0e4ff;
  border-radius: 3px;
  cursor: pointer;
  white-space: nowrap;
}

.tag-chip:hover {
  background: #f0c0c0;
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
