<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AppearanceSettings } from '../types/appearance';
import { isHttpUrl } from '../utils/httpUrl';

const props = defineProps<{
  appearance: AppearanceSettings;
}>();

const failed = ref(false);

const imageUrl = computed(() => {
  if (failed.value) {
    return '';
  }
  if (props.appearance.backgroundKind === 'local') {
    return props.appearance.localDataUrl;
  }
  if (props.appearance.backgroundKind === 'remote') {
    return isHttpUrl(props.appearance.remoteUrl) ? props.appearance.remoteUrl : '';
  }
  return '';
});

const overlayStyle = computed(() => ({
  opacity: String(props.appearance.overlay / 100),
}));

watch(imageUrl, () => {
  failed.value = false;
});
</script>

<template>
  <div v-if="imageUrl" class="background-layer" aria-hidden="true">
    <img
      class="background-layer__image"
      :src="imageUrl"
      alt=""
      referrerpolicy="no-referrer"
      decoding="async"
      @error="failed = true"
    />
    <div class="background-layer__overlay" :style="overlayStyle"></div>
  </div>
</template>

<style scoped>
.background-layer {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

.background-layer__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}

.background-layer__overlay {
  position: absolute;
  inset: 0;
  background: var(--bh-color-bg);
}
</style>
