<script setup lang="ts">
/**
 * 振り返り評価の読み方ヘルプダイアログ
 */

import { ref } from "vue";

const dialogRef = ref<HTMLDialogElement | null>(null);

defineExpose({
  showModal: () => dialogRef.value?.showModal(),
});
</script>

<template>
  <dialog
    ref="dialogRef"
    class="help-dialog"
  >
    <div class="help-content">
      <div class="help-header">
        <h2 class="help-title">評価の読み方</h2>
        <button
          type="button"
          class="close-button"
          aria-label="閉じる"
          @click="dialogRef?.close()"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line
              x1="18"
              y1="6"
              x2="6"
              y2="18"
            />
            <line
              x1="6"
              y1="6"
              x2="18"
              y2="18"
            />
          </svg>
        </button>
      </div>
      <div class="help-body">
        <section class="help-section">
          <h3>スコアと品質</h3>
          <p>
            CPUが数手先まで読み、各候補手を評価したスコアです。最善手とのスコア差に基づいて手の品質が決まります。
          </p>
          <ul>
            <li>
              <strong>最善手</strong>
              ：差50以内
            </li>
            <li>
              <strong>好手</strong>
              ：差200以内
            </li>
            <li>
              <strong>疑問手</strong>
              ：差500以内
            </li>
            <li>
              <strong>悪手</strong>
              ：差1500以内
            </li>
            <li>
              <strong>大悪手</strong>
              ：差1500超
            </li>
          </ul>
        </section>

        <section class="help-section">
          <h3>候補手</h3>
          <p>
            CPUが探索した候補手の上位5手をスコア順に表示します。実際に打った手が上位5手に含まれない場合は「ランク外」として末尾に追加されます。
          </p>
        </section>

        <section class="help-section">
          <h3>読み筋</h3>
          <p>
            CPUが予想する最善の手順です。
            <span class="help-inline-pv-self">自分の手</span>
            と
            <span class="help-inline-pv-opp">相手の手</span>
            が交互に表示されます。
          </p>
        </section>

        <section class="help-section">
          <h3>末端比較</h3>
          <p>
            最善手と実際の手それぞれについて、CPUが予想する数手先の盤面（読み筋の末端）でのパターンを比較します。差がある項目のみ表示されます。
          </p>
          <ul>
            <li>
              <strong>自分</strong>
              ：自分のパターン。高いほど有利
            </li>
            <li>
              <strong>相手</strong>
              ：相手のパターン。高いほど相手が有利（自分に不利）
            </li>
            <li>
              <strong>差引</strong>
              ：自分 − 相手。大きいほど有利
            </li>
          </ul>
        </section>

        <section class="help-section">
          <h3>パターンと基礎点</h3>
          <p>
            値はパターンの基礎点 x
            検出数です。例えば活三が3本あれば1000x3=3000になります。斜め方向には1.05倍のボーナスがつきます。
          </p>
          <ul>
            <li>五連: 100,000（勝ち）</li>
            <li>活四: 10,000（次に五連確定）</li>
            <li>四: 1,000</li>
            <li>活三: 1,000</li>
            <li>三: 30</li>
            <li>活二: 50</li>
            <li>二: 10</li>
          </ul>
        </section>

        <section class="help-section">
          <h3>スコアと末端比較の差異</h3>
          <p>
            スコア（探索評価）と末端比較の値は一致しないことがあります。スコアはミニマックス探索の結果で、途中で枝刈り（アルファベータ法）が行われるため、末端の静的評価とは異なる値になります。
          </p>
          <p>
            また、スコアには四三や禁手追い込みなどのボーナスが加算されますが、末端比較ではパターンの基礎点のみを比較しているため、その差も反映されません。末端比較はスコア差の主な原因を視覚的に把握するための参考情報です。
          </p>
        </section>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.help-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border: none;
  border-radius: var(--size-12);
  padding: 0;
  box-shadow: 0 var(--size-10) var(--size-32) rgba(0, 0, 0, 0.2);
  width: var(--size-500);
  height: var(--size-400, 400px);
  overflow: hidden;

  transition:
    opacity 0.15s ease-out,
    overlay 0.15s ease-out allow-discrete,
    display 0.15s ease-out allow-discrete;

  &[open] {
    opacity: 1;

    @starting-style {
      opacity: 0;
    }
  }

  &::backdrop {
    background: rgba(0, 0, 0, 0.5);
    transition:
      opacity 0.15s ease-out,
      overlay 0.15s ease-out allow-discrete,
      display 0.15s ease-out allow-discrete;
  }

  &[open]::backdrop {
    opacity: 1;

    @starting-style {
      opacity: 0;
    }
  }
}

.help-content {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.help-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--size-12) var(--size-16);
  border-bottom: 1px solid var(--color-border);
}

.help-title {
  margin: 0;
  font-size: var(--size-16);
  font-weight: 500;
  color: var(--color-text-primary);
}

.close-button {
  width: var(--size-28);
  height: var(--size-28);
  padding: var(--size-4);
  background: transparent;
  border: none;
  border-radius: var(--size-6);
  cursor: pointer;
  color: var(--color-text-secondary);
  transition: all 0.15s ease;

  &:hover {
    background: var(--color-bg-gray);
    color: var(--color-text-primary);
  }

  svg {
    width: 100%;
    height: 100%;
  }
}

.help-body {
  padding: var(--size-16);
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.help-section {
  &:not(:last-child) {
    margin-bottom: var(--size-16);
  }

  h3 {
    margin: 0 0 var(--size-6) 0;
    font-size: var(--size-12);
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  p {
    margin: 0;
    font-size: var(--size-11);
    color: var(--color-text-primary);
    line-height: 1.6;

    &:not(:last-child) {
      margin-bottom: var(--size-4);
    }
  }

  ul {
    margin: 0;
    padding-left: var(--size-16);
    font-size: var(--size-11);
    color: var(--color-text-primary);
    line-height: 1.6;
    list-style-type: disc;

    li {
      display: list-item;

      &:not(:last-child) {
        margin-bottom: var(--size-2);
      }
    }
  }
}

.help-inline-pv-self {
  background: rgba(95, 222, 236, 0.15);
  color: var(--color-primary);
  padding: var(--size-1) var(--size-4);
  border-radius: var(--size-4);
  font-family: monospace;
  font-size: var(--size-11);
}

.help-inline-pv-opp {
  background: rgba(0, 0, 0, 0.08);
  color: var(--color-text-secondary);
  padding: var(--size-1) var(--size-4);
  border-radius: var(--size-4);
  font-family: monospace;
  font-size: var(--size-11);
}
</style>
