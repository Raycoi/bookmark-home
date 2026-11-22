<script setup lang="ts">
import BookmarkItem from './BookmarkItem.vue';
import { useI18n } from '../i18n';
import type { HomepageBookmark } from '../types/bookmark';

defineProps<{
  bookmarks: HomepageBookmark[];
}>();

const { t } = useI18n();
</script>

<template>
  <section class="quick-links" aria-labelledby="quick-links-title">
    <h2 id="quick-links-title" class="visually-hidden">{{ t('quickLinks.title') }}</h2>
    <div class="quick-links__grid">
      <div
        v-for="bookmark in bookmarks"
        :key="bookmark.id"
        class="quick-links__item"
      >
        <BookmarkItem :bookmark="bookmark" eager />
      </div>
    </div>
  </section>
</template>

<style scoped>
.quick-links {
  width: 100%;
  margin-top: clamp(36px, 5vh, 52px);
}

.quick-links__grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 2px 6px;
  width: 100%;
  max-width: 900px;
  margin: 0 auto;
}

.quick-links__item {
  flex: 0 0 104px;
  width: 104px;
  min-width: 0;
}

@media (max-width: 560px) {
  .quick-links__grid {
    gap: 2px 2px;
  }

  .quick-links__item {
    flex-basis: 88px;
    width: 88px;
  }
}
</style>
