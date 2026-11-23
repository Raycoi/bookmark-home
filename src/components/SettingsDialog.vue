<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseDialog from './BaseDialog.vue';
import {
  DEFAULT_APPEARANCE,
  type AppearanceSettings,
} from '../types/appearance';
import { isHttpUrl } from '../utils/httpUrl';
import { useI18n, type LanguageSetting } from '../i18n';

const props = defineProps<{
  appearance: AppearanceSettings;
}>();

const emit = defineEmits<{
  close: [];
  update: [appearance: AppearanceSettings];
}>();

const draft = ref<AppearanceSettings>({ ...props.appearance });
const { language, setLanguage, t } = useI18n();
const error = ref<string | null>(null);
const localLoading = ref(false);
const tabIconLoading = ref(false);
const version = getVersion();

const tabIconPreview = computed(
  () => draft.value.tabIcon || chrome.runtime.getURL('icon/32.png'),
);

const previewUrl = computed(() => {
  if (draft.value.backgroundKind === 'local') {
    return draft.value.localDataUrl;
  }
  if (
    draft.value.backgroundKind === 'remote' &&
    isHttpUrl(draft.value.remoteUrl)
  ) {
    return draft.value.remoteUrl;
  }
  return '';
});

const previewOverlay = computed(() => ({
  opacity: String(draft.value.overlay / 100),
}));

function getVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return '0.1.0';
  }
}

function apply(): void {
  error.value = null;
  if (
    draft.value.backgroundKind === 'remote' &&
    !isHttpUrl(draft.value.remoteUrl)
  ) {
    error.value = t('settings.invalidUrl');
    return;
  }
  if (
    draft.value.backgroundKind === 'local' &&
    !draft.value.localDataUrl
  ) {
    error.value = t('settings.invalidImage');
    return;
  }

  emit('update', {
    ...DEFAULT_APPEARANCE,
    ...draft.value,
    remoteUrl:
      draft.value.backgroundKind === 'remote'
        ? draft.value.remoteUrl.trim()
        : '',
    localDataUrl:
      draft.value.backgroundKind === 'local' ? draft.value.localDataUrl : '',
  });
  emit('close');
}

function onLanguageChange(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) {
    return;
  }
  void setLanguage(target.value as LanguageSetting);
}

function onBackgroundKindChange(): void {
  error.value = null;
}

function onTabIconChange(event: Event): void {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }
  const file = input.files?.[0];
  input.value = '';
  if (!file) {
    return;
  }
  if (!file.type.startsWith('image/')) {
    error.value = t('settings.invalidFile');
    return;
  }
  tabIconLoading.value = true;
  error.value = null;
  void compressTabIcon(file)
    .then((dataUrl) => {
      draft.value.tabIcon = dataUrl;
    })
    .catch((caught: unknown) => {
      error.value = caught instanceof Error ? caught.message : t('settings.readFailed');
    })
    .finally(() => {
      tabIconLoading.value = false;
    });
}

function compressTabIcon(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t('settings.readFailed')));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(t('settings.readFailed')));
        return;
      }
      const image = new Image();
      image.onerror = () => reject(new Error(t('settings.parseFailed')));
      image.onload = () => {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error(t('settings.processFailed')));
          return;
        }
        const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        context.clearRect(0, 0, size, size);
        context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl.length > 300_000) {
          reject(new Error(t('settings.tooLarge')));
          return;
        }
        resolve(dataUrl);
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }
  const file = input.files?.[0];
  input.value = '';
  if (!file) {
    return;
  }
  if (!file.type.startsWith('image/')) {
    error.value = t('settings.invalidFile');
    return;
  }

  localLoading.value = true;
  error.value = null;
  try {
    const dataUrl = await compressImage(file);
    draft.value.localDataUrl = dataUrl;
    draft.value.backgroundKind = 'local';
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : t('settings.readFailed');
  } finally {
    localLoading.value = false;
  }
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t('settings.readFailed')));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(t('settings.readFailed')));
        return;
      }
      const image = new Image();
      image.onerror = () => reject(new Error(t('settings.parseFailed')));
      image.onload = () => {
        const maxWidth = 1920;
        const maxHeight = 1080;
        const scale = Math.min(
          1,
          maxWidth / image.naturalWidth,
          maxHeight / image.naturalHeight,
        );
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error(t('settings.processFailed')));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL('image/webp', 0.82);
        if (compressed.length > 2_500_000) {
          reject(new Error(t('settings.tooLarge')));
          return;
        }
        resolve(compressed);
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
</script>

<template>
  <BaseDialog
    :title="t('settings.title')"
    :description="t('settings.description')"
    @close="$emit('close')"
  >
    <div class="settings-sections">
      <section class="settings-section">
        <h3 class="settings-section__title">{{ t('settings.background') }}</h3>

        <label class="settings-field">
          <span class="settings-field__label">{{ t('settings.source') }}</span>
          <select
            v-model="draft.backgroundKind"
            class="bh-select"
            :aria-label="t('settings.source')"
            @change="onBackgroundKindChange"
          >
            <option value="default">{{ t('settings.default') }}</option>
            <option value="remote">{{ t('settings.remote') }}</option>
            <option value="local">{{ t('settings.local') }}</option>
          </select>
        </label>

        <label v-if="draft.backgroundKind === 'remote'" class="settings-field">
          <span class="settings-field__label">{{ t('settings.url') }}</span>
          <input
            v-model="draft.remoteUrl"
            class="bh-input"
            type="url"
            inputmode="url"
            placeholder="https://example.com/background.jpg"
            @input="error = null"
          />
        </label>

        <label v-if="draft.backgroundKind === 'local'" class="settings-field">
          <span class="settings-field__label">{{ t('settings.file') }}</span>
          <input
            class="settings-file"
            type="file"
            accept="image/*"
            :disabled="localLoading"
            @change="onFileChange"
          />
          <span class="settings-field__hint">
            {{ localLoading ? t('settings.processing') : t('settings.fileHint') }}
          </span>
        </label>

        <div v-if="previewUrl" class="settings-preview" :aria-label="t('settings.previewAria')">
          <img :src="previewUrl" alt="" referrerpolicy="no-referrer" />
          <span class="settings-preview__overlay" :style="previewOverlay"></span>
          <span class="settings-preview__label">{{ t('settings.preview') }}</span>
        </div>

        <label v-if="draft.backgroundKind !== 'default'" class="settings-field">
          <span class="settings-field__label">{{ t('settings.transparency') }} {{ draft.overlay }}%</span>
          <input
            v-model.number="draft.overlay"
            class="settings-range"
            type="range"
            min="0"
            max="70"
            step="1"
          />
          <span class="settings-field__hint">{{ t('settings.transparencyHint') }}</span>
        </label>

        <p v-if="error" class="bh-dialog-error" role="alert">{{ error }}</p>
        <p class="settings-section__hint">
          {{ t('settings.networkNote') }}
        </p>
      </section>

      <section class="settings-section">
        <h3 class="settings-section__title">{{ t('settings.tab') }}</h3>

        <div class="settings-tab-preview">
          <img class="settings-tab-preview__icon" :src="tabIconPreview" alt="" />
          <span class="settings-tab-preview__title">
            {{ draft.tabTitle || t('settings.tabTitlePlaceholder') }}
          </span>
        </div>

        <label class="settings-field">
          <span class="settings-field__label">{{ t('settings.tabTitle') }}</span>
          <input
            v-model="draft.tabTitle"
            class="bh-input"
            type="text"
            maxlength="40"
            :placeholder="t('settings.tabTitlePlaceholder')"
            @input="error = null"
          />
        </label>

        <label class="settings-field">
          <span class="settings-field__label">{{ t('settings.tabIcon') }}</span>
          <input
            class="settings-file"
            type="file"
            accept="image/*"
            :disabled="tabIconLoading"
            @change="onTabIconChange"
          />
          <span class="settings-field__hint">
            {{ tabIconLoading ? t('settings.processing') : t('settings.tabIconHint') }}
          </span>
        </label>

        <button
          v-if="draft.tabIcon"
          class="settings-link-button"
          type="button"
          @click="draft.tabIcon = ''"
        >
          {{ t('settings.removeTabIcon') }}
        </button>
      </section>

      <section class="settings-section">
        <h3 class="settings-section__title">{{ t('settings.language') }}</h3>
        <label class="settings-field">
          <span class="settings-field__label">{{ t('settings.language') }}</span>
          <select
            class="bh-select"
            :value="language"
            :aria-label="t('settings.language')"
            @change="onLanguageChange"
          >
            <option value="auto">{{ t('settings.languageAuto') }}</option>
            <option value="zh-CN">{{ t('settings.languageZh') }}</option>
            <option value="en">{{ t('settings.languageEn') }}</option>
          </select>
        </label>
      </section>

      <section class="settings-section">
        <h3 class="settings-section__title">{{ t('settings.about') }}</h3>
        <p class="settings-about">
          Bookmark Home {{ version }}
          <span class="settings-about__dot">·</span>
          <a href="https://github.com/Raycoi/bookmark-home" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <span class="settings-about__dot">·</span>
          <a
            href="https://github.com/Raycoi/bookmark-home/blob/main/PRIVACY.md"
            target="_blank"
            rel="noreferrer"
          >
            {{ t('settings.privacy') }}
          </a>
        </p>
      </section>
    </div>

    <template #footer>
      <div class="bh-actions">
        <button class="bh-button bh-button--secondary" type="button" @click="$emit('close')">
          {{ t('settings.cancel') }}
        </button>
        <button class="bh-button bh-button--primary" type="button" @click="apply">
          {{ t('settings.apply') }}
        </button>
      </div>
    </template>
  </BaseDialog>
</template>

<style scoped>
.settings-sections {
  display: grid;
  gap: 24px;
}

.settings-section {
  display: grid;
  gap: 12px;
}

.settings-section + .settings-section {
  padding-top: 18px;
  border-top: 1px solid var(--bh-color-border);
}

.settings-section__title {
  margin: 0;
  color: var(--bh-color-text);
  font-size: 13px;
  font-weight: 650;
}

.settings-section__hint {
  margin: 0;
  color: var(--bh-color-text-faint);
  font-size: 11.5px;
  line-height: 1.5;
}

.settings-field {
  display: grid;
  gap: 6px;
}

.settings-field__label {
  color: var(--bh-color-text-soft);
  font-size: 12px;
  font-weight: 620;
}

.settings-field__hint {
  color: var(--bh-color-text-faint);
  font-size: 11px;
}

.settings-tab-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 7px 10px;
  border: 1px solid var(--bh-color-border);
  border-radius: 10px;
  background: rgba(35, 40, 50, 0.025);
}

.settings-tab-preview__icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  border-radius: 4px;
  object-fit: contain;
}

.settings-tab-preview__title {
  overflow: hidden;
  color: var(--bh-color-text);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-link-button {
  justify-self: start;
  padding: 0;
  border: 0;
  color: var(--bh-color-text-faint);
  background: transparent;
  font-size: 11.5px;
  text-decoration: underline;
  cursor: pointer;
}

.settings-link-button:hover {
  color: var(--bh-color-text-soft);
}

.settings-file {
  width: 100%;
  color: var(--bh-color-text-soft);
  font-size: 12px;
}

.settings-file::file-selector-button {
  height: 32px;
  margin-right: 9px;
  padding: 0 10px;
  border: 1px solid var(--bh-color-border-strong);
  border-radius: 7px;
  color: var(--bh-color-text-soft);
  background: var(--bh-color-surface);
  font-size: 12px;
  cursor: pointer;
}

.settings-range {
  width: 100%;
  accent-color: var(--bh-color-accent);
}

.settings-preview {
  position: relative;
  height: 112px;
  overflow: hidden;
  border: 1px solid var(--bh-color-border);
  border-radius: 10px;
  background: var(--bh-color-bg);
}

.settings-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.settings-preview__overlay {
  position: absolute;
  inset: 0;
  background: var(--bh-color-bg);
}

.settings-preview__label {
  position: absolute;
  right: 8px;
  bottom: 7px;
  color: var(--bh-color-text-soft);
  font-size: 10px;
  font-weight: 600;
}

.settings-about {
  margin: 0;
  color: var(--bh-color-text-faint);
  font-size: 12px;
  line-height: 1.6;
}

.settings-about a {
  color: var(--bh-color-text-soft);
  text-underline-offset: 2px;
}

.settings-about a:hover {
  color: var(--bh-color-accent);
}

.settings-about__dot {
  padding: 0 4px;
  color: var(--bh-color-border-strong);
}
</style>
