<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { getFaviconUrl } from '../utils/favicon';

const props = withDefaults(
  defineProps<{
    url: string;
    size?: number;
    eager?: boolean;
  }>(),
  {
    size: 42,
    eager: false,
  },
);

const failed = ref(false);
const loaded = ref(false);

const faviconUrl = computed(() => {
  if (failed.value) {
    return null;
  }
  return getFaviconUrl(props.url, 64);
});

const wrapperStyle = computed(() => ({
  '--favicon-size': `${props.size}px`,
}));

watch(
  () => props.url,
  () => {
    failed.value = false;
    loaded.value = false;
  },
);

function onLoad(): void {
  loaded.value = true;
}

function onError(): void {
  failed.value = true;
  loaded.value = false;
}
</script>

<template>
  <span class="favicon" :style="wrapperStyle" aria-hidden="true">
    <svg
      v-if="!loaded"
      class="favicon-fallback"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="M7 4.75h10a1.25 1.25 0 0 1 1.25 1.25v13.1a.55.55 0 0 1-.87.45L12 15.8l-5.38 3.75a.55.55 0 0 1-.87-.45V6A1.25 1.25 0 0 1 7 4.75Z"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
    </svg>

    <img
      v-if="faviconUrl"
      class="favicon-image"
      :class="{ 'is-loaded': loaded }"
      :src="faviconUrl"
      alt=""
      width="64"
      height="64"
      :loading="eager ? 'eager' : 'lazy'"
      decoding="async"
      draggable="false"
      @load="onLoad"
      @error="onError"
    />
  </span>
</template>

<style scoped>
.favicon {
  position: relative;
  display: inline-grid;
  flex: 0 0 auto;
  width: var(--favicon-size);
  height: var(--favicon-size);
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--bh-color-border);
  border-radius: calc(var(--favicon-size) * 0.27);
  color: var(--bh-color-text-faint);
  background: var(--bh-color-surface);
  box-shadow: var(--bh-shadow-favicon);
}

.favicon-image {
  position: absolute;
  width: 66%;
  height: 66%;
  object-fit: contain;
  opacity: 0;
  transition: opacity var(--bh-duration-fast) ease;
}

.favicon-image.is-loaded {
  opacity: 1;
}

.favicon-fallback {
  width: 48%;
  height: 48%;
  opacity: 0.58;
}
</style>
