<script setup lang="ts">
import { ref } from "vue";
import CloseIcon from "@/assets/icons/close.svg?component";

const dialogRef = ref<HTMLDialogElement | null>(null);

defineExpose({
  showModal: () => dialogRef.value?.showModal(),
  close: () => dialogRef.value?.close(),
});
</script>

<template>
  <dialog
    ref="dialogRef"
    class="info-dialog"
  >
    <div class="dialog-content">
      <div class="dialog-header">
        <h2 class="dialog-title">アプリ情報</h2>
        <button
          type="button"
          class="close-button"
          aria-label="閉じる"
          @click="dialogRef?.close()"
        >
          <CloseIcon />
        </button>
      </div>

      <div class="dialog-body">
        <!-- アプリ紹介 -->
        <section class="info-section">
          <h3 class="section-title">このゲームについて</h3>
          <div class="section-content">
            <p>
              ホロライブ VTuber
              の白上フブキ・さくらみこと一緒に連珠（五目並べ）を学習できるゲームです。
            </p>
            <ul>
              <li>
                <strong>デモモード</strong>
                ：対話形式で戦略を説明
              </li>
              <li>
                <strong>問題モード</strong>
                ：実践練習でスキルを磨く
              </li>
            </ul>
          </div>
        </section>

        <!-- 画像出典 -->
        <section class="info-section">
          <h3 class="section-title">画像出典</h3>
          <div class="section-content">
            <p>
              <a
                href="https://booth.pm/ja/items/2693901"
                target="_blank"
                rel="noopener noreferrer"
              >
                【非公式】RPGツクールMV・MZ素材【ホロライブ】 - ときりすショップ
                - BOOTH
              </a>
            </p>
            <p>
              作者: ときりす様 (
              <a
                href="https://x.com/toki_p_happi"
                target="_blank"
                rel="noopener noreferrer"
              >
                @toki_p_happi
              </a>
              )
            </p>
          </div>
        </section>

        <!-- 利用規約 -->
        <section class="info-section">
          <h3 class="section-title">ご利用にあたって</h3>
          <div class="section-content">
            <ul>
              <li>
                このゲームは
                <a
                  href="https://hololivepro.com/terms/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  二次創作ガイドライン | ホロライブプロダクション
                </a>
                に基づく二次創作です。
              </li>
              <li>無料でご利用いただけます。</li>
              <li>配信等で、公序良俗を守った上でご自由にお使いください。</li>
              <li>記述内容は予告なく変更される可能性があります。</li>
              <li>このゲームの使用によるいかなる損害も責任を負いません。</li>
            </ul>
            <p class="disclaimer"></p>
          </div>
        </section>

        <!-- 作者連絡先 -->
        <section class="info-section">
          <h3 class="section-title">作者</h3>
          <div class="section-content">
            <p>
              かみくず(
              <a
                href="https://x.com/p_craft"
                target="_blank"
                rel="noopener noreferrer"
              >
                @p_craft
              </a>
              )
            </p>
          </div>
        </section>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.info-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border: none;
  border-radius: var(--size-12);
  padding: 0;
  box-shadow: 0 var(--size-10) var(--size-32) rgba(0, 0, 0, 0.2);
  width: var(--size-500);
  max-height: 80%;
  overflow: hidden;

  transition:
    opacity 0.15s ease-out,
    transform 0.15s ease-out,
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

.dialog-content {
  display: flex;
  flex-direction: column;
  max-height: 80vh;
  overflow-y: scroll;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--size-16) var(--size-24);
  border-bottom: 1px solid var(--color-border);
}

.dialog-title {
  margin: 0;
  font-size: var(--size-20);
  font-weight: 500;
  color: var(--color-text-primary);
}

.close-button {
  width: var(--size-32);
  height: var(--size-32);
  padding: var(--size-6);
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

.dialog-body {
  padding: var(--size-24);
  overflow-y: auto;
}

.info-section {
  &:not(:last-child) {
    margin-bottom: var(--size-32);
  }
}

.section-title {
  margin: 0 0 var(--size-12) 0;
  font-size: var(--size-14);
  font-weight: 500;
  color: var(--color-text-secondary);
}

.section-content {
  p {
    margin: 0;
    font-size: var(--size-12);
    color: var(--color-text-primary);
    line-height: 1.6;

    &:not(:last-child) {
      margin-bottom: var(--size-8);
    }
  }

  ul {
    margin: 0;
    padding-left: var(--size-20);
    font-size: var(--size-12);
    color: var(--color-text-primary);
    line-height: 1.6;
    list-style-type: disc;

    li {
      display: list-item;

      &:not(:last-child) {
        margin-bottom: var(--size-4);
      }
    }
  }

  a {
    color: var(--color-holo-blue);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
}
</style>
