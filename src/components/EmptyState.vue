<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    hint?: string;
  }>(),
  {
    title: '',
    hint: '',
  },
);
</script>

<template>
  <div class="empty-state">
    <svg
      class="empty-state__icon"
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7 4.75h10a1.25 1.25 0 0 1 1.25 1.25v13.1a.55.55 0 0 1-.87.45L12 15.8l-5.38 3.75a.55.55 0 0 1-.87-.45V6A1.25 1.25 0 0 1 7 4.75Z"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linejoin="round"
      />
    </svg>
    <h2 class="empty-state__title">{{ title || $t('书签栏还是空的') }}</h2>
    <p class="empty-state__hint">{{ hint || $t('在 Chrome 书签栏添加网址或文件夹，主页会自动更新。') }}</p>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 64px 24px 72px;
  text-align: center;
}

.empty-state__icon {
  margin-bottom: 14px;
  color: var(--bh-color-text-faint);
  opacity: 0.55;
}

.empty-state__title {
  margin: 0;
  color: var(--bh-color-text);
  font-size: 17px;
  font-weight: 620;
  letter-spacing: -0.015em;
}

.empty-state__hint {
  max-width: 360px;
  margin: 7px 0 0;
  color: var(--bh-color-text-faint);
  font-size: 13px;
}
</style>
