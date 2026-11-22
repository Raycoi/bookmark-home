<script setup lang="ts">
import BaseDialog from './BaseDialog.vue';
import { useI18n } from '../i18n';
import type { ConfirmDialogState } from '../types/management';

defineProps<{
  state: ConfirmDialogState;
  busy: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const { t } = useI18n();
</script>

<template>
  <BaseDialog
    :title="state.title"
    :description="t('confirm.description')"
    :busy="busy"
    @close="emit('cancel')"
  >
    <div class="bh-form">
      <p class="bh-copy">{{ state.message }}</p>

      <p v-if="state.warning" class="bh-warning">
        {{ state.warning }}
      </p>

      <p v-if="error" class="bh-dialog-error" role="alert">{{ error }}</p>
    </div>

    <template #footer>
      <div class="bh-actions">
        <button
          class="bh-button bh-button--secondary"
          type="button"
          data-autofocus
          :disabled="busy"
          @click="emit('cancel')"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          class="bh-button bh-button--danger"
          type="button"
          :disabled="busy"
          @click="emit('confirm')"
        >
          {{ busy ? t('confirm.processing') : state.confirmLabel }}
        </button>
      </div>
    </template>
  </BaseDialog>
</template>
