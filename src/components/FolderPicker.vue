<script setup lang="ts">
import { useId } from 'vue';
import FolderPickerNode from './FolderPickerNode.vue';
import type { FolderOption } from '../utils/folders';

defineProps<{
  tree: FolderOption[];
  modelValue: string;
  currentId: string;
}>();

const emit = defineEmits<{
  select: [id: string];
}>();

const groupName = useId();
</script>

<template>
  <div class="folder-picker" role="radiogroup" aria-label="选择目标文件夹">
    <ul class="folder-picker__root">
      <FolderPickerNode
        v-for="option in tree"
        :key="option.id"
        :option="option"
        :model-value="modelValue"
        :current-id="currentId"
        :group-name="groupName"
        @select="emit('select', $event)"
      />
    </ul>
  </div>
</template>

<style scoped>
.folder-picker {
  max-height: 300px;
  overflow: auto;
  padding: 6px;
  border: 1px solid var(--bh-color-border);
  border-radius: 12px;
  background: #fcfcfa;
}

.folder-picker__root {
  margin: 0;
  padding: 0;
}
</style>
