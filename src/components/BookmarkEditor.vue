<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import BaseDialog from './BaseDialog.vue';
import { useI18n } from '../i18n';
import type { BookmarkEditorState, BookmarkFormPayload } from '../types/management';
import {
  formatFolderOption,
  type FlatFolderOption,
} from '../utils/folders';
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

const { t } = useI18n();

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
    const normalizedTitle = title.value.trim();
    if (!normalizedTitle) {
      throw new Error(t('bookmarkEditor.nameRequired'));
    }

    const trimmedUrl = url.value.trim();

    if (!trimmedUrl) {
      throw new Error(t('bookmarkEditor.urlRequired'));
    }

    if (props.state.mode === 'create' && !parentId.value) {
      throw new Error(t('bookmarkEditor.locationRequired'));
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
    :title="isEdit ? t('bookmarkEditor.titleEdit') : t('bookmarkEditor.titleCreate')"
    :description="isEdit ? t('bookmarkEditor.descEdit') : t('bookmarkEditor.descCreate')"
    :busy="busy"
    @close="emit('cancel')"
  >
    <form :id="formId" class="bh-form" @submit.prevent="submit">
      <div class="bh-field">
        <label class="bh-label" :for="`${formId}-title`">{{ t('bookmarkEditor.name') }}</label>
        <input
          :id="`${formId}-title`"
          v-model="title"
          class="bh-input"
          type="text"
          autocomplete="off"
          data-autofocus
          :placeholder="t('bookmarkEditor.namePlaceholder')"
          :disabled="busy"
        />
      </div>

      <div class="bh-field">
        <label class="bh-label" :for="`${formId}-url`">{{ t('bookmarkEditor.url') }}</label>
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
        <p class="bh-hint">{{ t('bookmarkEditor.urlHint') }}</p>
      </div>

      <div v-if="!isEdit" class="bh-field">
        <label class="bh-label" :for="`${formId}-parent`">{{ t('bookmarkEditor.location') }}</label>
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
          {{ t('common.cancel') }}
        </button>
        <button
          class="bh-button bh-button--primary"
          type="submit"
          :form="formId"
          :disabled="busy"
        >
          {{
            busy
              ? t('common.saving')
              : isEdit
                ? t('bookmarkEditor.saveChanges')
                : t('bookmarkEditor.titleCreate')
          }}
        </button>
      </div>
    </template>
  </BaseDialog>
</template>
