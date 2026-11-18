<script setup lang="ts">
import { computed, ref } from 'vue';
import type { FolderOption } from '../utils/folders';

const props = defineProps<{
  option: FolderOption;
  modelValue: string;
  currentId: string;
  groupName: string;
}>();

const emit = defineEmits<{
  select: [id: string];
}>();

const expanded = ref(true);
const radioId = computed(() => `${props.groupName}-${props.option.id}`);
const selected = computed(() => props.modelValue === props.option.id);
const isCurrent = computed(() => props.currentId === props.option.id);
</script>

<template>
  <li class="folder-node">
    <div class="folder-node__row" :class="{ 'is-selected': selected }">
      <button
        v-if="option.children.length > 0"
        class="folder-node__toggle"
        type="button"
        :aria-label="expanded ? '收起子文件夹' : '展开子文件夹'"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          :class="{ 'is-expanded': expanded }"
        >
          <path
            d="m6 4 4 4-4 4"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <span v-else class="folder-node__toggle-spacer" aria-hidden="true"></span>

      <label class="folder-node__select" :for="radioId">
        <input
          :id="radioId"
          class="folder-node__radio"
          type="radio"
          :name="groupName"
          :value="option.id"
          :checked="selected"
          :data-autofocus="selected ? '' : undefined"
          @change="emit('select', option.id)"
        />
        <svg
          class="folder-node__icon"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3.75 7.25A1.75 1.75 0 0 1 5.5 5.5h4.1l1.7 2h7.2a1.75 1.75 0 0 1 1.75 1.75v7.5a1.75 1.75 0 0 1-1.75 1.75h-13a1.75 1.75 0 0 1-1.75-1.75v-9.5Z"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linejoin="round"
          />
        </svg>
        <span class="folder-node__name">{{ option.title }}</span>
        <span v-if="isCurrent" class="folder-node__badge">当前位置</span>
      </label>
    </div>

    <ul v-if="expanded && option.children.length > 0" class="folder-node__children">
      <FolderPickerNode
        v-for="child in option.children"
        :key="child.id"
        :option="child"
        :model-value="modelValue"
        :current-id="currentId"
        :group-name="groupName"
        @select="emit('select', $event)"
      />
    </ul>
  </li>
</template>

<style scoped>
.folder-node {
  list-style: none;
}

.folder-node__row {
  display: flex;
  align-items: center;
  min-width: 0;
  border-radius: 8px;
  transition: background-color var(--bh-duration-fast) ease;
}

.folder-node__row:hover {
  background: rgba(35, 40, 50, 0.045);
}

.folder-node__row.is-selected {
  background: var(--bh-color-accent-soft);
}

.folder-node__toggle,
.folder-node__toggle-spacer {
  display: grid;
  flex: 0 0 auto;
  width: 24px;
  height: 30px;
  place-items: center;
}

.folder-node__toggle {
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: var(--bh-color-text-faint);
  background: transparent;
  cursor: pointer;
}

.folder-node__toggle:hover {
  color: var(--bh-color-text);
}

.folder-node__toggle:focus-visible {
  outline: 2px solid var(--bh-color-accent);
  outline-offset: -1px;
}

.folder-node__toggle svg {
  transition: transform var(--bh-duration-fast) var(--bh-ease-out);
}

.folder-node__toggle svg.is-expanded {
  transform: rotate(90deg);
}

.folder-node__select {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 7px;
  min-width: 0;
  height: 34px;
  padding-right: 8px;
  cursor: pointer;
}

.folder-node__radio {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--bh-color-accent);
}

.folder-node__icon {
  flex: 0 0 auto;
  color: var(--bh-color-text-faint);
}

.folder-node__name {
  overflow: hidden;
  color: var(--bh-color-text-soft);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-node__row.is-selected .folder-node__name {
  color: var(--bh-color-text);
  font-weight: 560;
}

.folder-node__badge {
  flex: 0 0 auto;
  margin-left: auto;
  padding: 1px 6px;
  border-radius: 999px;
  color: var(--bh-color-text-faint);
  background: rgba(35, 40, 50, 0.055);
  font-size: 10px;
}

.folder-node__children {
  margin: 0 0 0 13px;
  padding: 0 0 0 10px;
  border-left: 1px solid var(--bh-color-border);
}
</style>
