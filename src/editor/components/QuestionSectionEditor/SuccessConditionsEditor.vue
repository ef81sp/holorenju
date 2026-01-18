<script setup lang="ts">
import type { SuccessCondition, QuestionSection } from "@/types/scenario";
import { useSuccessConditions } from "@/editor/composables/useSuccessConditions";
import PositionInput from "@/editor/components/common/PositionInput.vue";

const props = defineProps<{
  conditions: SuccessCondition[];
  operator: "or" | "and";
  getCurrentSection: () => QuestionSection | null;
  updateSection: (updates: Partial<QuestionSection>) => void;
  updateSuccessOperator: (operator: "or" | "and") => void;
}>();

const {
  isPositionCondition,
  isPatternCondition,
  isSequenceCondition,
  addSuccessCondition,
  removeSuccessCondition,
  changeConditionType,
  updatePositionCondition,
  addPositionToCondition,
  updatePositionField,
  removePositionFromCondition,
  updatePatternCondition,
  addSequenceMove,
  updateSequenceMove,
  removeSequenceMove,
  toggleSequenceStrict,
} = useSuccessConditions(props.getCurrentSection, props.updateSection);
</script>

<template>
  <details
    class="conditions-section"
    open
  >
    <summary class="conditions-header">
      <span>成功条件</span>
      <button
        class="btn-add-small"
        @click.stop="addSuccessCondition"
      >
        + 条件を追加
      </button>
    </summary>

    <div class="field-row">
      <label>
        判定方法
        <select
          :value="operator"
          class="form-input form-input-small"
          @change="
            (e) =>
              updateSuccessOperator(
                (e.target as HTMLSelectElement).value as 'or' | 'and',
              )
          "
        >
          <option value="or">OR (いずれかを満たせば正解)</option>
          <option value="and">AND (すべて満たしたら正解)</option>
        </select>
      </label>
    </div>

    <div
      v-if="conditions.length === 0"
      class="empty-state"
    >
      成功条件がありません
    </div>

    <div
      v-else
      class="conditions-list"
    >
      <div
        v-for="(condition, index) in conditions"
        :key="index"
        class="condition-item"
      >
        <div class="condition-header">
          <select
            :value="condition.type"
            class="form-input form-input-small"
            @change="
              (e) =>
                changeConditionType(
                  index,
                  (e.target as HTMLSelectElement)
                    .value as SuccessCondition['type'],
                )
            "
          >
            <option value="position">Position (位置指定)</option>
            <option value="pattern">Pattern (パターン)</option>
            <option value="sequence">Sequence (手順)</option>
          </select>
          <button
            class="btn-remove-small"
            @click="removeSuccessCondition(index)"
          >
            ✕
          </button>
        </div>

        <!-- Position条件 -->
        <div
          v-if="isPositionCondition(condition)"
          class="condition-body"
        >
          <div class="field-row">
            <label>
              色
              <select
                :value="condition.color"
                class="form-input form-input-small"
                @change="
                  (e) =>
                    updatePositionCondition(index, {
                      color: (e.target as HTMLSelectElement).value as
                        | 'black'
                        | 'white',
                    })
                "
              >
                <option value="black">黒</option>
                <option value="white">白</option>
              </select>
            </label>
          </div>
          <div class="positions-list">
            <div
              v-for="(pos, posIndex) in condition.positions"
              :key="`pos-${posIndex}`"
              class="position-row"
            >
              <label class="position-label">座標</label>
              <PositionInput
                :row="pos.row"
                :col="pos.col"
                @update-position="
                  (field, value) =>
                    updatePositionField(index, posIndex, field, value)
                "
              />
              <button
                class="btn-inline"
                @click="removePositionFromCondition(index, posIndex)"
              >
                座標削除
              </button>
            </div>
            <button
              class="btn-add-small btn-inline"
              @click="addPositionToCondition(index)"
            >
              + 座標を追加
            </button>
          </div>
        </div>

        <!-- Pattern条件 -->
        <div
          v-else-if="isPatternCondition(condition)"
          class="condition-body"
        >
          <div class="field-row">
            <label>
              色
              <select
                :value="condition.color"
                class="form-input form-input-small"
                @change="
                  (e) =>
                    updatePatternCondition(index, {
                      color: (e.target as HTMLSelectElement).value as
                        | 'black'
                        | 'white',
                    })
                "
              >
                <option value="black">黒</option>
                <option value="white">白</option>
              </select>
            </label>
          </div>
          <div class="field-row">
            <label>
              パターン
              <input
                type="text"
                :value="condition.pattern"
                class="form-input"
                placeholder="例: xxo..."
                @input="
                  (e) =>
                    updatePatternCondition(index, {
                      pattern: (e.target as HTMLInputElement).value,
                    })
                "
              />
            </label>
          </div>
        </div>

        <!-- Sequence条件 -->
        <div
          v-else-if="isSequenceCondition(condition)"
          class="condition-body"
        >
          <div class="field-row checkbox-row">
            <label>
              <input
                type="checkbox"
                :checked="condition.strict"
                @change="
                  (e) =>
                    toggleSequenceStrict(
                      index,
                      (e.target as HTMLInputElement).checked,
                    )
                "
              />
              strict（順序厳密）
            </label>
          </div>
          <div class="moves-list">
            <div
              v-for="(move, moveIndex) in condition.moves"
              :key="`move-${moveIndex}`"
              class="move-row"
            >
              <label class="position-label">座標</label>
              <PositionInput
                :row="move.row"
                :col="move.col"
                @update-position="
                  (field, value) =>
                    updateSequenceMove(index, moveIndex, field, value)
                "
              />
              <label>
                色
                <select
                  :value="move.color"
                  class="form-input form-input-small"
                  @change="
                    (e) =>
                      updateSequenceMove(
                        index,
                        moveIndex,
                        'color',
                        (e.target as HTMLSelectElement).value as
                          | 'black'
                          | 'white',
                      )
                  "
                >
                  <option value="black">黒</option>
                  <option value="white">白</option>
                </select>
              </label>
              <button
                class="btn-inline"
                @click="removeSequenceMove(index, moveIndex)"
              >
                手を削除
              </button>
            </div>
            <button
              class="btn-add-small btn-inline"
              @click="addSequenceMove(index)"
            >
              + 手を追加
            </button>
          </div>
        </div>
      </div>
    </div>
  </details>
</template>

<style scoped>
.conditions-section {
  padding: var(--size-6);
  background-color: var(--color-bg-gray);
  border-radius: 3px;
  border: 1px solid var(--color-border);
}

.conditions-section summary:hover {
  color: #4a90e2;
}

.conditions-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.conditions-header span {
  flex: 1;
}

.btn-add-small {
  padding: var(--size-2) var(--size-6);
  background-color: #4a90e2;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: var(--size-10);
  transition: opacity 0.2s;
}

.btn-add-small:hover {
  opacity: 0.9;
}

.empty-state {
  padding: var(--size-8);
  text-align: center;
  color: var(--color-text-secondary);
  background-color: white;
  border-radius: 3px;
  font-size: var(--size-12);
}

.conditions-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-6);
}

.condition-item {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
  padding: var(--size-6);
  background-color: white;
  border-radius: 3px;
  border: 1px solid var(--color-border);
}

.condition-header {
  display: flex;
  gap: var(--size-2);
  align-items: center;
}

.form-input-small {
  flex: 1;
  min-width: 80px;
  padding: var(--size-2);
  font-size: var(--size-10);
}

.btn-remove-small {
  padding: var(--size-2) var(--size-5);
  background-color: #ff6b6b;
  border: none;
  cursor: pointer;
  font-size: var(--size-10);
  border-radius: 3px;
  transition: opacity 0.2s;
}

.btn-remove-small:hover {
  opacity: 0.8;
}

.condition-body {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
  padding-top: var(--size-5);
}

.field-row {
  display: flex;
  gap: var(--size-5);
  flex-wrap: wrap;
  align-items: center;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--size-2);
}

.form-group label {
  font-weight: 600;
  font-size: var(--size-12);
}

.form-input,
.form-textarea {
  padding: var(--size-2);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-size: var(--size-12);
  font-family: inherit;
}

.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: #4a90e2;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.05);
}

.checkbox-row label {
  display: flex;
  gap: var(--size-2);
  align-items: center;
}

.positions-list,
.moves-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
}

.position-row,
.move-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-5);
  align-items: center;
}

.position-label {
  font-weight: var(--font-weight-bold);
  font-size: var(--size-11);
}

.btn-inline {
  padding: var(--size-2) var(--size-5);
  background-color: var(--color-bg-gray);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  cursor: pointer;
  font-size: var(--size-10);
}

.btn-inline:hover {
  background-color: #f0f0f0;
}
</style>
