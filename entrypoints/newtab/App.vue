<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import BackgroundLayer from '../../src/components/BackgroundLayer.vue';
import BookmarkEditor from '../../src/components/BookmarkEditor.vue';
import BookmarkGroups from '../../src/components/BookmarkGroups.vue';
import ConfirmDialog from '../../src/components/ConfirmDialog.vue';
import ContextMenu from '../../src/components/ContextMenu.vue';
import EmptyState from '../../src/components/EmptyState.vue';
import ErrorNotice from '../../src/components/ErrorNotice.vue';
import FolderEditor from '../../src/components/FolderEditor.vue';
import HealthCheckPanel from '../../src/components/health/HealthCheckPanel.vue';
import HealthEntryButton from '../../src/components/health/HealthEntryButton.vue';
import LoadingSkeleton from '../../src/components/LoadingSkeleton.vue';
import MoveDialog from '../../src/components/MoveDialog.vue';
import OperationToast from '../../src/components/OperationToast.vue';
import OtherBookmarks from '../../src/components/OtherBookmarks.vue';
import QuickLinks from '../../src/components/QuickLinks.vue';
import SearchBar from '../../src/components/SearchBar.vue';
import SettingsDialog from '../../src/components/SettingsDialog.vue';
import {
  BOOKMARK_MANAGER_KEY,
  useBookmarkManager,
} from '../../src/composables/useBookmarkManager';
import {
  WEBSITE_HEALTH_KEY,
  useWebsiteHealth,
} from '../../src/composables/useWebsiteHealth';
import { useBookmarks } from '../../src/composables/useBookmarks';
import { readAppearance, saveAppearance } from '../../src/services/appearanceService';
import { completeCapsuleIntro, shouldShowCapsuleIntro } from '../../src/services/capsuleIntroService';
import { initLanguage, useI18n } from '../../src/i18n';
import { DEFAULT_APPEARANCE, type AppearanceSettings } from '../../src/types/appearance';
import { collectSearchableBookmarks } from '../../src/utils/bookmarkSearch';
import { collectSelectableIds } from '../../src/utils/folders';

const { data, error, refresh, refreshSoon, stale, lastUpdatedAt } = useBookmarks();
const manager = useBookmarkManager({ data, refresh: refreshSoon });
provide(BOOKMARK_MANAGER_KEY, manager);

const {
  homepage,
  bookmarkEditor,
  folderEditor,
  confirmDialog,
  moveDialog,
  contextMenu,
  toast,
  busy,
  dialogError,
  folderOptions,
} = manager;

const health = useWebsiteHealth({ homepage });
provide(WEBSITE_HEALTH_KEY, health);
const { panelOpen: healthPanelOpen } = health;

const quickLinks = computed(() => homepage.value?.bookmarksBar.directBookmarks ?? []);
const groups = computed(() => homepage.value?.bookmarksBar.folders ?? []);
const otherBookmarks = computed(() => homepage.value?.otherBookmarks ?? null);
const searchableBookmarks = computed(() => collectSearchableBookmarks(homepage.value));

watch(
  searchableBookmarks,
  () => manager.setSelectionOrder(collectSelectableIds(homepage.value)),
  { immediate: true },
);

const hasQuickLinks = computed(() => quickLinks.value.length > 0);
const hasGroups = computed(() => groups.value.length > 0);
const hasBarContent = computed(() => hasQuickLinks.value || hasGroups.value);
const hasOtherBookmarks = computed(
  () => (otherBookmarks.value?.children.length ?? 0) > 0,
);
const showSkeleton = computed(() => !homepage.value && !error.value);
const settingsOpen = ref(false);
const coachOpen = ref(false);
const coachStep = ref(0);
const { t, locale } = useI18n();
const coachSteps = computed(() => [
  { title: t('coach.cursor'), body: t('coach.cursorBody') },
  { title: t('coach.health'), body: t('coach.healthBody') },
  { title: t('coach.select'), body: t('coach.selectBody') },
  { title: t('coach.add'), body: t('coach.addBody') },
  { title: t('coach.settings'), body: t('coach.settingsBody') },
]);
const coachCurrent = computed(() => coachSteps.value[coachStep.value]!);
const appearance = ref<AppearanceSettings>({ ...DEFAULT_APPEARANCE });
const actionsVisible = ref(false);
const actionsRef = ref<HTMLElement | null>(null);
let actionsHideTimer: ReturnType<typeof setTimeout> | null = null;

function clearActionsHideTimer(): void {
  if (actionsHideTimer) {
    clearTimeout(actionsHideTimer);
    actionsHideTimer = null;
  }
}

function showActions(): void {
  clearActionsHideTimer();
  actionsVisible.value = true;
}

function scheduleHideActions(delay = 420): void {
  clearActionsHideTimer();
  actionsHideTimer = setTimeout(() => {
    actionsHideTimer = null;
    if (actionsRef.value?.contains(document.activeElement)) {
      return;
    }
    actionsVisible.value = false;
  }, delay);
}

function onActionsPointerMove(event: PointerEvent): void {
  const nearCenter = Math.abs(event.clientX - window.innerWidth / 2) <= 260;
  const nearBottom = window.innerHeight - event.clientY <= 180;
  if (nearCenter && nearBottom) {
    showActions();
    return;
  }
  if (actionsVisible.value) {
    scheduleHideActions();
  }
}

function onActionsPointerLeave(): void {
  scheduleHideActions();
}

function onActionsFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget;
  if (next instanceof Node && actionsRef.value?.contains(next)) {
    return;
  }
  scheduleHideActions(180);
}

function updateAppearance(next: AppearanceSettings): void {
  appearance.value = next;
  void saveAppearance(next);
}

function applyTabAppearance(next: AppearanceSettings): void {
  document.title = next.tabTitle || 'Bookmark Home';
  let link = document.querySelector<HTMLLinkElement>('link[data-bookmark-home-icon]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.dataset.bookmarkHomeIcon = 'true';
    document.head.append(link);
  }
  link.href = next.tabIcon || chrome.runtime.getURL('icon/32.png');
}

watch(appearance, applyTabAppearance, { immediate: true, deep: true });

function closeCoach(): void {
  coachOpen.value = false;
  void completeCapsuleIntro();
}

function nextCoach(): void {
  if (coachStep.value >= 4) {
    closeCoach();
    return;
  }
  coachStep.value += 1;
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && coachOpen.value) {
    closeCoach();
    return;
  }
  if (event.key === 'Escape' && manager.selectionMode.value) {
    manager.exitSelection();
  }
}

onMounted(() => {
  document.addEventListener('pointermove', onActionsPointerMove, { passive: true });
  document.addEventListener('keydown', onDocumentKeydown);
  void initLanguage();
  void readAppearance().then((next) => {
    appearance.value = next;
  });
  void shouldShowCapsuleIntro().then((show) => {
    coachOpen.value = show;
    if (show) {
      showActions();
    }
  });
});

onUnmounted(() => {
  clearActionsHideTimer();
  document.removeEventListener('pointermove', onActionsPointerMove);
  document.removeEventListener('keydown', onDocumentKeydown);
});

const bookmarkFeedback = computed(() => {
  if (!error.value) {
    return '';
  }
  if (!stale.value || !lastUpdatedAt.value) {
    return error.value;
  }

  const time = new Intl.DateTimeFormat(locale.value, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(lastUpdatedAt.value));
  return `${error.value} ${t('app.staleData', { time })}`;
});
</script>

<template>
  <BackgroundLayer :appearance="appearance" />

  <main class="home" :class="{ 'home--ready': Boolean(homepage) }">
    <h1 class="visually-hidden">{{ t('app.title') }}</h1>

    <section class="home__hero" :aria-label="t('app.heroAria')">
      <SearchBar :bookmarks="searchableBookmarks" />

      <QuickLinks v-if="hasQuickLinks" :bookmarks="quickLinks" />

      <div v-if="error" class="home__feedback">
        <ErrorNotice
          :message="bookmarkFeedback"
          :tone="stale ? 'warning' : 'error'"
          @retry="refresh"
        />
      </div>

      <EmptyState
        v-if="homepage && !hasBarContent && !error"
        class="home__empty"
      />

      <div v-if="showSkeleton" class="home__loading">
        <p class="visually-hidden" role="status">{{ t('app.loading') }}</p>
        <LoadingSkeleton />
      </div>
    </section>

    <section v-if="hasGroups" class="home__browse" :aria-label="t('app.browseAria')">
      <BookmarkGroups :groups="groups" />
    </section>

    <OtherBookmarks
      v-if="hasOtherBookmarks && otherBookmarks"
      :section="otherBookmarks"
    />

    <div
      v-if="homepage && manager.selectionMode.value"
      class="selection-bar"
      :aria-label="t('selection.label')"
    >
      <span class="selection-bar__count">{{ t('selection.count', { count: manager.selectedCount.value }) }}</span>
      <button
        class="selection-bar__button"
        type="button"
        @click="manager.selectBookmarkIds(collectSelectableIds(homepage))"
      >
        {{ t('selection.selectAll') }}
      </button>
      <button
        class="selection-bar__button"
        type="button"
        :disabled="manager.selectedCount.value === 0 || busy"
        @click="manager.openBulkMoveDialog"
      >
        {{ t('selection.move') }}
      </button>
      <button
        class="selection-bar__button selection-bar__button--danger"
        type="button"
        :disabled="manager.selectedCount.value === 0 || busy"
        @click="manager.askBulkDelete"
      >
        {{ t('selection.delete') }}
      </button>
      <button
        class="selection-bar__button"
        type="button"
        @click="manager.exitSelection"
      >
        {{ t('selection.exit') }}
      </button>
    </div>

    <div
      v-if="homepage"
      ref="actionsRef"
      class="home-actions"
      :class="{ 'is-visible': actionsVisible || coachOpen }"
      :aria-label="t('app.actionsAria')"
      @pointerenter="showActions"
      @pointerleave="onActionsPointerLeave"
      @focusin="showActions"
      @focusout="onActionsFocusOut"
    >
      <HealthEntryButton :class="{ 'is-coach-target': coachOpen && coachStep === 1 }" />
      <button
        v-if="!manager.selectionMode.value"
        class="action-button select-button"
        :class="{ 'is-coach-target': coachOpen && coachStep === 2 }"
        type="button"
        :aria-label="t('app.selectAria')"
        :title="t('app.selectTitle')"
        :disabled="busy"
        @click="manager.enterSelection"
      >
        <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="3.2" y="3.2" width="13.6" height="13.6" rx="4" stroke="currentColor" stroke-width="1.4" />
          <path d="m6.6 10 2.2 2.2 4.6-4.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <button
        class="action-button add-button"
        :class="{ 'is-coach-target': coachOpen && coachStep === 3 }"
        type="button"
        :aria-label="t('app.add')"
        :title="t('app.add')"
        aria-haspopup="menu"
        :disabled="busy"
        @click="manager.openAddMenu"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M10 4.5v11M4.5 10h11"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </svg>
      </button>

      <button
        class="action-button settings-button"
        :class="{ 'is-coach-target': coachOpen && coachStep === 4 }"
        type="button"
        :aria-label="t('app.settingsAria')"
        :title="t('app.settingsTitle')"
        @click="settingsOpen = true"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M10 7.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z"
            stroke="currentColor"
            stroke-width="1.4"
          />
          <path
            d="M8.4 3.8h3.2l.4 1.7 1.5.9 1.6-.7 1.6 2.8-1.2 1.2v1.6l1.2 1.2-1.6 2.8-1.6-.7-1.5.9-.4 1.7H8.4l-.4-1.7-1.5-.9-1.6.7-1.6-2.8 1.2-1.2V9.7L3.3 8.5l1.6-2.8 1.6.7 1.5-.9.4-1.7Z"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
  </main>

  <div v-if="coachOpen" class="capsule-coach" role="dialog" :aria-label="t('app.coachAria')">
    <span class="capsule-coach__arrow" aria-hidden="true"></span>
    <strong class="capsule-coach__title">{{ coachCurrent.title }}</strong>
    <p class="capsule-coach__body">{{ coachCurrent.body }}</p>
    <div class="capsule-coach__footer">
      <button class="capsule-coach__skip" type="button" @click="closeCoach">{{ t('common.skip') }}</button>
      <button class="capsule-coach__next" type="button" @click="nextCoach">
        {{ coachStep === 4 ? t('common.done') : t('common.next') }}
      </button>
    </div>
  </div>

  <BookmarkEditor
    v-if="bookmarkEditor"
    :key="bookmarkEditor.mode === 'edit' ? `edit-${bookmarkEditor.bookmark.id}` : 'create-bookmark'"
    :state="bookmarkEditor"
    :folders="folderOptions"
    :busy="busy"
    :error="dialogError"
    @save="manager.saveBookmark"
    @cancel="manager.closeBookmarkEditor"
  />

  <FolderEditor
    v-if="folderEditor"
    :key="folderEditor.mode === 'rename' ? `rename-${folderEditor.folder.id}` : 'create-folder'"
    :state="folderEditor"
    :folders="folderOptions"
    :busy="busy"
    :error="dialogError"
    @save="manager.saveFolder"
    @cancel="manager.closeFolderEditor"
  />

  <ConfirmDialog
    v-if="confirmDialog"
    :state="confirmDialog"
    :busy="busy"
    :error="dialogError"
    @confirm="manager.confirmDelete"
    @cancel="manager.closeConfirmDialog"
  />

  <MoveDialog
    v-if="moveDialog"
    :key="moveDialog.target.node.id"
    :state="moveDialog"
    :busy="busy"
    :error="dialogError"
    @move="manager.confirmMove"
    @cancel="manager.closeMoveDialog"
  />

  <ContextMenu
    v-if="contextMenu"
    :state="contextMenu"
    @select="manager.handleContextAction"
    @close="manager.closeContextMenu"
  />

  <HealthCheckPanel v-if="healthPanelOpen" />

  <SettingsDialog
    v-if="settingsOpen"
    :appearance="appearance"
    @update="updateAppearance"
    @close="settingsOpen = false"
  />

  <OperationToast
    v-if="toast"
    :toast="toast"
    @action="manager.runToastAction"
    @close="manager.dismissToast"
  />
</template>
