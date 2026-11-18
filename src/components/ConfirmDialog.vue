<script setup lang="ts">
import BaseDialog from './BaseDialog.vue';
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
</script>

<template>
  <BaseDialog
    :title="state.title"
    description="请确认这次对 Chrome 原生书签的修改。"
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
          取消
        </button>
        <button
          class="bh-button bh-button--danger"
          type="button"
          :disabled="busy"
          @click="emit('confirm')"
        >
          {{ busy ? '处理中…' : state.confirmLabel }}
        </button>
      </div>
    </template>
  </BaseDialog>
</template>
