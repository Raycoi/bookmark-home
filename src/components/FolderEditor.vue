<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import BaseDialog from './BaseDialog.vue';
import { useI18n } from '../i18n';
import type { FolderEditorState, FolderFormPayload } from '../types/management';
import { formatFolderOption, type FlatFolderOption } from '../utils/folders';
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

const { t } = useI18n();

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
    const normalizedTitle = title.value.trim();
    if (!normalizedTitle) {
      throw new Error(t('folderEditor.nameRequired'));
    }
    if (props.state.mode === 'create' && !parentId.value) {
      throw new Error(t('folderEditor.locationRequired'));
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
    :title="isRename ? t('folderEditor.titleRename') : t('folderEditor.titleCreate')"
    :description="isRename ? t('folderEditor.descRename') : t('folderEditor.descCreate')"
    :busy="busy"
    @close="emit('cancel')"
  >
    <form :id="formId" class="bh-form" @submit.prevent="submit">
      <div class="bh-field">
        <label class="bh-label" :for="`${formId}-title`">{{ t('folderEditor.name') }}</label>
        <input
          :id="`${formId}-title`"
          v-model="title"
          class="bh-input"
          type="text"
          autocomplete="off"
          data-autofocus
          :placeholder="t('folderEditor.namePlaceholder')"
          :disabled="busy"
        />
      </div>

      <div v-if="!isRename" class="bh-field">
        <label class="bh-label" :for="`${formId}-parent`">{{ t('folderEditor.location') }}</label>
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
              : isRename
                ? t('folderEditor.saveName')
                : t('folderEditor.titleCreate')
          }}
        </button>
      </div>
    </template>
  </BaseDialog>
</template>
