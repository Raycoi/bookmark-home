<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseDialog from './BaseDialog.vue';
import FolderPicker from './FolderPicker.vue';
import { useI18n } from '../i18n';
import type { MoveDialogState } from '../types/management';
import { flattenFolderOptions } from '../utils/folders';

const props = defineProps<{
  state: MoveDialogState;
  busy: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  move: [parentId: string];
  cancel: [];
}>();

const { t } = useI18n();

const flatFolders = flattenFolderOptions(props.state.tree);
const initialId = flatFolders.some(
  (folder) => folder.id === props.state.currentParentId,
)
  ? props.state.currentParentId
  : (flatFolders[0]?.id ?? '');

const selectedId = ref(initialId);
const title = computed(() => {
  const node = props.state.target.node;
  const trimmed = node.title.trim();
  if (trimmed) {
    return trimmed;
  }
  return node.type === 'folder'
    ? t('common.unnamedFolder')
    : t('common.unnamedBookmark');
});
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
    :title="t('moveDialog.title', { name: title })"
    :description="state.target.kind === 'bookmark' ? t('moveDialog.descBookmark') : t('moveDialog.descFolder')"
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
        {{ t('moveDialog.sameAsCurrent') }}
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
          {{ t('common.cancel') }}
        </button>
        <button
          class="bh-button bh-button--primary"
          type="button"
          :disabled="!canMove"
          @click="submit"
        >
          {{ busy ? t('moveDialog.moving') : t('moveDialog.moveHere') }}
        </button>
      </div>
    </template>
  </BaseDialog>
</template>
