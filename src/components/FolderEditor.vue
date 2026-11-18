<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import BaseDialog from './BaseDialog.vue';
import type { FolderEditorState, FolderFormPayload } from '../types/management';
import { formatFolderOption, type FlatFolderOption } from '../utils/folders';
import { normalizeBookmarkTitle } from '../utils/url';
import { getErrorMessage } from '../utils/errors';

const props = defineProps<{
  state: FolderEditorState;
  folders: FlatFolderOption[];
  busy: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  save: [payload: FolderFormPayload];
  cancel: [];
}>();

const title = ref(
  props.state.mode === 'rename' ? props.state.folder.title : '',
);
const parentId = ref(
  props.state.mode === 'create'
    ? props.state.defaultParentId
    : props.state.folder.parentId,
);
const localError = ref<string | null>(null);
const formId = useId();

const isRename = computed(() => props.state.mode === 'rename');
const displayError = computed(() => localError.value ?? props.error);

function submit(): void {
  if (props.busy) {
    return;
  }

  localError.value = null;

  try {
    const normalizedTitle = normalizeBookmarkTitle(title.value, '文件夹名称');
    if (props.state.mode === 'create' && !parentId.value) {
      throw new Error('请选择创建位置');
    }

    emit('save', {
      title: normalizedTitle,
      parentId: parentId.value,
    });
  } catch (error) {
    localError.value = getErrorMessage(error);
  }
}
</script>

<template>
  <BaseDialog
    :title="isRename ? '重命名文件夹' : '新建文件夹'"
    :description="isRename ? '保留文件夹内的全部书签与子文件夹。' : '可直接创建在书签栏、其他书签或现有文件夹中。'"
    :busy="busy"
    @close="emit('cancel')"
  >
    <form :id="formId" class="bh-form" @submit.prevent="submit">
      <div class="bh-field">
        <label class="bh-label" :for="`${formId}-title`">文件夹名称</label>
        <input
          :id="`${formId}-title`"
          v-model="title"
          class="bh-input"
          type="text"
          autocomplete="off"
          data-autofocus
          placeholder="例如：开发工具"
          :disabled="busy"
        />
      </div>

      <div v-if="!isRename" class="bh-field">
        <label class="bh-label" :for="`${formId}-parent`">创建位置</label>
        <select
          :id="`${formId}-parent`"
          v-model="parentId"
          class="bh-select"
          :disabled="busy"
        >
          <option v-for="folder in folders" :key="folder.id" :value="folder.id">
            {{ formatFolderOption(folder) }}
          </option>
        </select>
      </div>

      <p v-if="displayError" class="bh-dialog-error" role="alert">
        {{ displayError }}
      </p>
    </form>

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
          type="submit"
          :form="formId"
          :disabled="busy"
        >
          {{ busy ? '保存中…' : isRename ? '保存名称' : '新建文件夹' }}
        </button>
      </div>
    </template>
  </BaseDialog>
</template>
