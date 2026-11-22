<script setup lang="ts">
import { locale, useI18n } from '../../i18n';
import type { HealthBookmarkView } from '../../composables/useWebsiteHealth';

const props = defineProps<{
  view: HealthBookmarkView;
  locating: boolean;
  manageable: boolean;
  busy: boolean;
  scanRunning: boolean;
}>();

const emit = defineEmits<{
  recheck: [];
  ignore: [];
  locate: [];
  edit: [];
  delete: [];
}>();

const { t } = useI18n();

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(locale.value, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function canRecheck(view: HealthBookmarkView): boolean {
  return (
    Boolean(view.normalizedUrl) &&
    view.status !== 'checking' &&
    view.status !== 'private' &&
    view.status !== 'unsupported' &&
    !props.busy &&
    !props.scanRunning
  );
}

function canIgnore(view: HealthBookmarkView): boolean {
  return Boolean(view.normalizedUrl) && !props.busy && !props.scanRunning;
}

function requestRecheck(): void {
  if (!canRecheck(props.view)) {
    return;
  }
  emit('recheck');
}

function requestIgnore(): void {
  if (!canIgnore(props.view)) {
    return;
  }
  emit('ignore');
}
</script>

<template>
  <li class="health-row" :class="`health-row--${view.tone}`">
    <span class="health-row__dot" aria-hidden="true"></span>

    <div class="health-row__body">
      <div class="health-row__title-line">
        <strong class="health-row__title">{{ view.entry.title }}</strong>
        <span v-if="view.entry.bookmarkCount > 1" class="health-row__count">
          {{ t('health.row.bookmarkCount', { count: view.entry.bookmarkCount }) }}
        </span>
        <span
          v-if="!view.entry.isHomepageVisible"
          class="health-row__unlisted"
          :title="t('health.row.unlistedTitle', { section: view.entry.sectionTitle })"
        >
          {{ view.entry.sectionTitle }} · {{ t('health.row.notShown') }}
        </span>
      </div>
      <p class="health-row__path">{{ view.entry.folderPath }}</p>
      <p class="health-row__url">{{ view.entry.normalizedUrl ?? view.entry.rawUrl }}</p>
      <div class="health-row__meta">
        <span class="health-row__status">{{ t(`health.status.${view.status}`) }}</span>
        <span v-if="view.record?.httpStatus !== undefined">
          HTTP {{ view.record.httpStatus }}
        </span>
        <span v-if="view.record">{{ formatTime(view.record.checkedAt) }}</span>
        <span v-if="view.stale" class="health-row__stale">{{ t('health.row.staleCache') }}</span>
      </div>
      <p
        v-if="view.record?.errorMessage && view.status === 'unknown'"
        class="health-row__error"
      >
        {{ view.record.errorMessage }}
      </p>
    </div>

    <div class="health-row__actions">
      <button
        v-if="manageable"
        class="health-row__edit"
        type="button"
        :title="t('health.row.editTitle')"
        @click="emit('edit')"
      >
        {{ t('health.row.edit') }}
      </button>
      <button
        v-if="manageable"
        class="health-row__delete"
        type="button"
        :title="t('health.row.deleteTitle')"
        @click="emit('delete')"
      >
        {{ t('health.row.delete') }}
      </button>
      <button
        v-if="!view.entry.isHomepageVisible"
        class="health-row__locate"
        type="button"
        :disabled="locating"
        :title="t('health.row.locateTitle')"
        @click="emit('locate')"
      >
        {{ locating ? t('health.row.locating') : t('health.row.locate') }}
      </button>
      <button
        v-if="canIgnore(view)"
        class="health-row__ignore"
        type="button"
        :title="t('health.row.ignoreTitle')"
        @click="requestIgnore"
      >
        {{ t('health.row.ignore') }}
      </button>
      <button
        class="health-row__recheck"
        type="button"
        :disabled="!canRecheck(view)"
        @click="requestRecheck"
      >
        {{
          view.status === 'checking'
            ? t('health.row.checking')
            : view.status === 'private' || view.status === 'unsupported'
              ? t('health.row.notChecked')
              : view.record
                ? t('health.row.recheck')
                : t('health.row.startCheck')
        }}
      </button>
    </div>
  </li>
</template>

<style scoped>
.health-row {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 11px 2px;
  border-bottom: 1px solid var(--bh-color-border);
}

.health-row:last-child {
  border-bottom: 0;
}

.health-row__dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--bh-health-neutral);
}

.health-row--ok .health-row__dot {
  background: var(--bh-health-ok);
}

.health-row--info .health-row__dot {
  background: var(--bh-health-info);
}

.health-row--warn .health-row__dot {
  background: var(--bh-health-warn);
}

.health-row--error .health-row__dot {
  background: var(--bh-health-error);
  box-shadow: 0 0 0 3px rgba(182, 74, 74, 0.1);
}

.health-row__body {
  flex: 1 1 auto;
  min-width: 0;
}

.health-row__title-line {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.health-row__title {
  overflow: hidden;
  color: var(--bh-color-text);
  font-size: 12.5px;
  font-weight: 620;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.health-row__count {
  flex: 0 0 auto;
  color: var(--bh-color-text-faint);
  font-size: 10.5px;
}

.health-row__unlisted {
  flex: 0 0 auto;
  max-width: 150px;
  overflow: hidden;
  padding: 1px 5px;
  border: 1px solid var(--bh-color-warning-border);
  border-radius: 4px;
  color: var(--bh-color-warning);
  background: var(--bh-color-warning-soft);
  font-size: 9.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.health-row__actions {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  min-width: 54px;
}

.health-row__locate {
  padding: 3px 6px;
  border: 1px solid var(--bh-color-warning-border);
  border-radius: 6px;
  color: var(--bh-color-warning);
  background: var(--bh-color-warning-soft);
  font-size: 10.5px;
  cursor: pointer;
}

.health-row__locate:hover:not(:disabled) {
  background: #f7edda;
}

.health-row__locate:focus-visible {
  outline: 2px solid var(--bh-color-accent);
  outline-offset: 1px;
}

.health-row__locate:disabled {
  cursor: default;
  opacity: 0.5;
}

.health-row__edit,
.health-row__delete,
.health-row__ignore {
  padding: 3px 6px;
  border: 1px solid var(--bh-color-border);
  border-radius: 6px;
  color: var(--bh-color-text-faint);
  background: transparent;
  font-size: 10.5px;
  opacity: 0;
  pointer-events: none;
  cursor: pointer;
  transition: opacity var(--bh-duration-fast) ease;
}

.health-row:hover .health-row__edit,
.health-row:hover .health-row__delete,
.health-row:hover .health-row__ignore,
.health-row:focus-within .health-row__edit,
.health-row:focus-within .health-row__delete,
.health-row:focus-within .health-row__ignore {
  opacity: 1;
  pointer-events: auto;
}

@media (hover: none) {
  .health-row__edit,
  .health-row__delete,
  .health-row__ignore {
    opacity: 0.86;
    pointer-events: auto;
  }
}

.health-row__edit:hover {
  color: var(--bh-color-text-soft);
  background: #f7f7f5;
}

.health-row__ignore:hover {
  color: var(--bh-color-text);
  background: #f7f7f5;
}

.health-row__delete:hover {
  color: var(--bh-color-danger);
  border-color: var(--bh-color-danger-border);
  background: var(--bh-color-danger-soft);
}

.health-row__edit:focus-visible,
.health-row__delete:focus-visible,
.health-row__ignore:focus-visible {
  outline: 2px solid var(--bh-color-accent);
  outline-offset: 1px;
}

.health-row__path,
.health-row__url {
  margin: 3px 0 0;
  overflow: hidden;
  color: var(--bh-color-text-faint);
  font-size: 10.5px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.health-row__url {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.health-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 3px 9px;
  margin-top: 4px;
  color: var(--bh-color-text-faint);
  font-size: 10.5px;
}

.health-row__status {
  color: var(--bh-color-text-soft);
  font-weight: 560;
}

.health-row--ok .health-row__status {
  color: var(--bh-health-ok);
}

.health-row--warn .health-row__status {
  color: var(--bh-health-warn);
}

.health-row--error .health-row__status {
  color: var(--bh-health-error);
}

.health-row__stale {
  color: var(--bh-health-warn);
}

.health-row__error {
  margin: 4px 0 0;
  color: var(--bh-health-error);
  font-size: 10.5px;
  line-height: 1.4;
}

.health-row__recheck {
  flex: 0 0 auto;
  padding: 3px 6px;
  border: 1px solid var(--bh-color-border-strong);
  border-radius: 6px;
  color: var(--bh-color-text-soft);
  background: var(--bh-color-surface);
  font-size: 10.5px;
  cursor: pointer;
}

.health-row__recheck:hover:not(:disabled) {
  color: var(--bh-color-text);
  background: #f7f7f5;
}

.health-row__recheck:focus-visible {
  outline: 2px solid var(--bh-color-accent);
  outline-offset: 1px;
}

.health-row__recheck:disabled {
  cursor: default;
  opacity: 0.46;
}
</style>
