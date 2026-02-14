<template>
  <svg
    class="title-logo"
    viewBox="0 0 280 70"
    aria-label="ホロ連珠"
  >
    <defs>
      <radialGradient id="circle-light">
        <stop
          offset="0%"
          stop-color="rgba(255,255,255,0.95)"
        />
        <stop
          offset="70%"
          stop-color="rgba(255,255,255,0.7)"
        />
        <stop
          offset="100%"
          stop-color="rgba(255,255,255,0)"
        />
      </radialGradient>
      <radialGradient id="circle-dark">
        <stop
          offset="0%"
          stop-color="rgba(0,0,0,0.4)"
        />
        <stop
          offset="70%"
          stop-color="rgba(0,0,0,0.25)"
        />
        <stop
          offset="100%"
          stop-color="rgba(0,0,0,0)"
        />
      </radialGradient>
      <linearGradient
        id="title-stroke-gradient"
        x1="0%"
        y1="0%"
        x2="100%"
        y2="100%"
      >
        <stop
          offset="0%"
          stop-color="var(--color-fubuki-500)"
        />
        <stop
          offset="50%"
          stop-color="var(--color-blue-500)"
        />
        <stop
          offset="100%"
          stop-color="var(--color-miko-500)"
        />
      </linearGradient>
    </defs>
    <!-- ホロ: 白丸 + 黒文字 -->
    <circle
      cx="35"
      cy="35"
      r="35"
      fill="url(#circle-light)"
    />
    <circle
      cx="105"
      cy="35"
      r="35"
      fill="url(#circle-light)"
    />
    <!-- 連珠: 黒丸 + 白文字 -->
    <circle
      cx="175"
      cy="35"
      r="35"
      fill="url(#circle-dark)"
    />
    <circle
      cx="245"
      cy="35"
      r="35"
      fill="url(#circle-dark)"
    />
    <text
      x="35"
      y="35"
      class="title-char title-char--dark"
    >
      ホ
    </text>
    <text
      x="105"
      y="35"
      class="title-char title-char--dark"
    >
      ロ
    </text>
    <text
      x="175"
      y="35"
      class="title-char title-char--light"
    >
      連
    </text>
    <text
      x="245"
      y="35"
      class="title-char title-char--light"
    >
      珠
    </text>
  </svg>
</template>

<style scoped>
.title-logo {
  height: var(--font-size-48);
  filter: drop-shadow(0 0 2px hsl(199, 72%, 35%, 0.3));
}

.title-char {
  font-size: 48px;
  font-weight: var(--font-weight-bold);
  text-anchor: middle;
  dominant-baseline: central;
  stroke: url(#title-stroke-gradient);
  stroke-width: 2;
  paint-order: stroke;
}

.title-char--dark {
  fill: var(--color-text-primary);
}

.title-char--light {
  fill: white;
}
</style>
