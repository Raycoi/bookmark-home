<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import BaseDialog from './BaseDialog.vue';
import type { BookmarkEditorState, BookmarkFormPayload } from '../types/management';
import {
  formatFolderOption,
  type FlatFolderOption,
} from '../utils/folders';
import {
  normalizeBookmarkTitle,
} from '../utils/url';
import { getErrorMessage } from '../utils/errors';

const props = defineProps<{
  state: BookmarkEditorState;
  folders: FlatFolderOption[];
  busy: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  save: [payload: BookmarkFormPayload];
  cancel: [];
}>();

const title = ref(
  props.state.mode === 'edit' ? props.state.bookmark.title : '',
);
const url = ref(
  props.state.mode === 'edit' ? props.state.bookmark.url : '',
);
const parentId = ref(
  props.state.mode === 'create'
    ? props.state.defaultParentId
    : props.state.bookmark.parentId,
);
const localError = ref<string | null>(null);
const formId = useId();

const isEdit = computed(() => props.state.mode === 'edit');
const displayError = computed(() => localError.value ?? props.error);

function submit(): void {
  if (props.busy) {
    return;
  }

  localError.value = null;

  try {
    const normalizedTitle = normalizeBookmarkTitle(title.value, '书签名称');
    const trimmedUrl = url.value.trim();

    if (!trimmedUrl) {
      throw new Error('网址不能为空');
    }

    if (props.state.mode === 'create' && !parentId.value) {
      throw new Error('请选择保存位置');
    }

    emit('save', {
      title: normalizedTitle,
      url: trimmedUrl,
      parentId: parentId.value,
    });
  } catch (error) {
    localError.value = getErrorMessage(error);
  }
}
</script>

<template>
  <BaseDialog
    :title="isEdit ? '编辑书签' : '新增书签'"
    :description="isEdit ? '只保存发生变化的字段，直接写入 Chrome 原生书签。' : '保存后会直接出现在 Chrome 原生书签中。'"
    :busy="busy"
    @close="emit('cancel')"
  >
    <form :id="formId" class="bh-form" @submit.prevent="submit">
      <div class="bh-field">
        <label class="bh-label" :for="`${formId}-title`">网站名称</label>
        <input
          :id="`${formId}-title`"
          v-model="title"
          class="bh-input"
          type="text"
          autocomplete="off"
          data-autofocus
          placeholder="例如：GitHub"
          :disabled="busy"
        />
      </div>

      <div class="bh-field">
        <label class="bh-label" :for="`${formId}-url`">网站 URL</label>
        <input
          :id="`${formId}-url`"
          v-model="url"
          class="bh-input"
          type="text"
          inputmode="url"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="https://example.com"
          :disabled="busy"
        />
        <p class="bh-hint">省略协议时会自动补全 https://。</p>
      </div>

      <div v-if="!isEdit" class="bh-field">
        <label class="bh-label" :for="`${formId}-parent`">保存位置</label>
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
          {{ busy ? '保存中…' : isEdit ? '保存修改' : '新增书签' }}
        </button>
      </div>
    </template>
  </BaseDialog>
</template>
