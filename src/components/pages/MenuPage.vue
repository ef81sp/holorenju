<script setup lang="ts">
import { useId } from "vue";
import { useAppStore } from "@/stores/appStore";
import PageHeader from "@/components/common/PageHeader.vue";
import FullscreenButton from "@/components/common/FullscreenButton.vue";
import InfoControl from "@/components/common/InfoControl.vue";
import TitleLogo from "@/components/common/TitleLogo.vue";
import miniFubuki from "@/assets/characters/mini-fubuki.png";
import miniMiko from "@/assets/characters/mini-miko.png";

const appStore = useAppStore();
const trainingDescId = useId();
const cpuDescId = useId();

const handleSelectTraining = (): void => {
  appStore.selectMode("training");
};

const handleSelectCPU = (): void => {
  appStore.selectMode("cpu");
};
</script>

<template>
  <div class="menu-page">
    <PageHeader>
      <template #title>
        <TitleLogo />
      </template>
      <template #right>
        <div class="right-controls">
          <FullscreenButton />
          <InfoControl />
        </div>
      </template>
    </PageHeader>
    <div class="content">
      <div class="menu-buttons">
        <div class="menu-button-group">
          <button
            class="menu-button menu-button--light"
            :aria-describedby="trainingDescId"
            @click="handleSelectTraining"
          >
            <div class="button-circle">
              <span class="button-circle-inner">
                <span class="button-text">学習</span>
                <img
                  :src="miniFubuki"
                  alt=""
                  class="button-mascot button-mascot--fubuki"
                />
              </span>
            </div>
          </button>
          <p
            :id="trainingDescId"
            class="button-description"
          >
            難易度別シナリオで
            <br />
            五目並べを学習
          </p>
        </div>
        <div class="menu-button-group">
          <button
            class="menu-button menu-button--dark"
            :aria-describedby="cpuDescId"
            @click="handleSelectCPU"
          >
            <div class="button-circle">
              <span class="button-circle-inner">
                <span class="button-text">ホロメン対戦</span>
                <img
                  :src="miniMiko"
                  alt=""
                  class="button-mascot button-mascot--miko"
                />
              </span>
            </div>
          </button>
          <p
            :id="cpuDescId"
            class="button-description"
          >
            ホロメン(CPU)と対局して
            <br />
            腕を磨こう
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.right-controls {
  display: flex;
  gap: var(--size-8);
  align-items: center;
}

.menu-page {
  position: relative;
  width: 100%;
  height: 100%;
  padding: var(--size-40) var(--size-20);
  overflow-y: auto;
  box-sizing: border-box;
}

.content {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.menu-buttons {
  display: flex;
  flex-direction: row;
  gap: var(--size-48);
  pointer-events: auto;
}

.menu-button-group {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.menu-button {
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;

  &:focus-visible {
    outline: none;
  }

  &:hover:not(:disabled),
  &:focus-visible {
    .button-circle::after {
      opacity: 1;
    }
  }

  &:active:not(:disabled) {
    .button-circle::after {
      opacity: 0.5;
      animation-play-state: paused;
    }
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.button-circle {
  position: relative;
  width: var(--size-180);
  height: var(--size-180);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;

  &::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 50%;
    opacity: 0;
    transition: opacity 0.4s ease-out;
    pointer-events: none;
    outline: var(--size-2) solid transparent;
    outline-offset: 0;
    animation:
      glow-pulse 1.5s ease-in-out infinite,
      ring-expand 1.5s ease-out infinite;
  }
}

@keyframes glow-pulse {
  0%,
  100% {
    box-shadow: 0 0 var(--size-20) hsl(199, 72%, 55%, 0.7);
  }
  50% {
    box-shadow: 0 0 var(--size-40) hsl(199, 72%, 55%, 1);
  }
}

@keyframes ring-expand {
  0% {
    outline-color: hsl(199, 72%, 55%, 1);
    outline-offset: 0;
  }
  100% {
    outline-color: hsl(199, 72%, 55%, 0);
    outline-offset: var(--size-16);
  }
}

.menu-button--light {
  .button-circle {
    background: radial-gradient(
      circle,
      rgba(255, 255, 255, 0.95) 0%,
      rgba(255, 255, 255, 0.7) 70%,
      rgba(255, 255, 255, 0) 100%
    );
  }

  .button-text {
    color: var(--color-text-primary);
  }
}

.menu-button--dark {
  .button-circle {
    background: radial-gradient(
      circle,
      rgba(0, 0, 0, 0.7) 0%,
      rgba(0, 0, 0, 0.5) 70%,
      rgba(0, 0, 0, 0) 100%
    );
  }

  .button-text {
    color: white;
  }
}

.button-circle-inner {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.button-text {
  font-size: var(--font-size-20);
  font-weight: var(--font-weight-bold);
}

.button-mascot {
  position: absolute;
  bottom: 0;
  left: 50%;
  width: var(--size-56);
  height: auto;
  image-rendering: pixelated;
  transition: transform 0.3s ease;
  pointer-events: none;
}

.button-mascot--fubuki {
  transform: translateX(-50%) translateY(48%);
}

.button-mascot--miko {
  transform: translateX(-50%) translateY(46%);
}

.menu-button:hover .button-mascot,
.menu-button:focus-visible .button-mascot {
  transform: translateX(-50%) translateY(15%);
}

.button-description {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: var(--size-200);
  margin: var(--size-12) 0 0;
  padding: 0;
  font-size: var(--font-size-12);
  color: var(--color-text-secondary);
  text-align: center;
  word-break: auto-phrase;
}

@media (prefers-reduced-motion: reduce) {
  .button-circle::after {
    animation: none;
  }

  .button-mascot {
    transition: none;
  }

  .menu-button {
    &:hover:not(:disabled),
    &:focus-visible {
      .button-circle::after {
        opacity: 1;
        box-shadow: 0 0 var(--size-20) hsl(199, 72%, 55%, 0.7);
        outline-color: hsl(199, 72%, 55%, 1);
        outline-offset: var(--size-4);
      }
    }
  }
}
</style>
