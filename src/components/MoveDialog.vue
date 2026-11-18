<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseDialog from './BaseDialog.vue';
import FolderPicker from './FolderPicker.vue';
import type { MoveDialogState } from '../types/management';
import {
  flattenFolderOptions,
  getNodeTitle,
} from '../utils/folders';

const props = defineProps<{
  state: MoveDialogState;
  busy: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  move: [parentId: string];
  cancel: [];
}>();

const flatFolders = flattenFolderOptions(props.state.tree);
const initialId = flatFolders.some(
  (folder) => folder.id === props.state.currentParentId,
)
  ? props.state.currentParentId
  : (flatFolders[0]?.id ?? '');

const selectedId = ref(initialId);
const title = computed(() => getNodeTitle(props.state.target.node));
const sameAsCurrent = computed(
  () => selectedId.value === props.state.currentParentId,
);
const canMove = computed(
  () => Boolean(selectedId.value) && !sameAsCurrent.value && !props.busy,
);

function submit(): void {
  if (!canMove.value) {
    return;
  }
  emit('move', selectedId.value);
}
</script>

<template>
  <BaseDialog
    :title="`移动“${title}”`"
    :description="state.target.kind === 'bookmark' ? '选择一个文件夹作为书签的新位置。' : '文件夹及其全部内容会一起移动，不能移动到自身内部。'"
    :busy="busy"
    @close="emit('cancel')"
  >
    <div class="bh-form">
      <FolderPicker
        :tree="state.tree"
        :model-value="selectedId"
        :current-id="state.currentParentId"
        @select="selectedId = $event"
      />

      <p v-if="sameAsCurrent" class="bh-hint">
        当前已位于该文件夹，请选择其他目标位置。
      </p>

      <p v-if="error" class="bh-dialog-error" role="alert">{{ error }}</p>
    </div>

    <template #footer>
      <div class="bh-actions">
        <button
          class="bh-button bh-button--secondary"
          type="button"
          :disabled="busy"
          @click="emit('cancel')"
        >
          取消
        </button>
        <button
          class="bh-button bh-button--primary"
          type="button"
          :disabled="!canMove"
          @click="submit"
        >
          {{ busy ? '移动中…' : '移动到此处' }}
        </button>
      </div>
    </template>
  </BaseDialog>
</template>
