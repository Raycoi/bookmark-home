<script setup lang="ts">
import BookmarkGroup from './BookmarkGroup.vue';
import type { HomepageFolder } from '../types/bookmark';

defineProps<{
  groups: HomepageFolder[];
}>();
</script>

<template>
  <div class="bookmark-groups">
    <BookmarkGroup v-for="group in groups" :key="group.id" :folder="group" />
  </div>
</template>

<style scoped>
.bookmark-groups {
  display: grid;
  gap: clamp(34px, 4vw, 50px);
  min-width: 0;
}
</style>
