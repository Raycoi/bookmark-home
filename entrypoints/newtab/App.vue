<script setup lang="ts">
import { computed, provide } from 'vue';
import BookmarkEditor from '../../src/components/BookmarkEditor.vue';
import BookmarkGroups from '../../src/components/BookmarkGroups.vue';
import ConfirmDialog from '../../src/components/ConfirmDialog.vue';
import ContextMenu from '../../src/components/ContextMenu.vue';
import EmptyState from '../../src/components/EmptyState.vue';
import ErrorNotice from '../../src/components/ErrorNotice.vue';
import FolderEditor from '../../src/components/FolderEditor.vue';
import HealthCheckPanel from '../../src/components/health/HealthCheckPanel.vue';
import HealthDetailPopover from '../../src/components/health/HealthDetailPopover.vue';
import HealthEntryButton from '../../src/components/health/HealthEntryButton.vue';
import LoadingSkeleton from '../../src/components/LoadingSkeleton.vue';
import MoveDialog from '../../src/components/MoveDialog.vue';
import OperationToast from '../../src/components/OperationToast.vue';
import OtherBookmarks from '../../src/components/OtherBookmarks.vue';
import QuickLinks from '../../src/components/QuickLinks.vue';
import SearchBar from '../../src/components/SearchBar.vue';
import {
  BOOKMARK_MANAGER_KEY,
  useBookmarkManager,
} from '../../src/composables/useBookmarkManager';
import {
  WEBSITE_HEALTH_KEY,
  useWebsiteHealth,
} from '../../src/composables/useWebsiteHealth';
import { useBookmarks } from '../../src/composables/useBookmarks';

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
const {
  panelOpen: healthPanelOpen,
  detail: healthDetail,
} = health;

const quickLinks = computed(() => homepage.value?.bookmarksBar.directBookmarks ?? []);
const groups = computed(() => homepage.value?.bookmarksBar.folders ?? []);
const otherBookmarks = computed(() => homepage.value?.otherBookmarks ?? null);

const hasQuickLinks = computed(() => quickLinks.value.length > 0);
const hasGroups = computed(() => groups.value.length > 0);
const hasBarContent = computed(() => hasQuickLinks.value || hasGroups.value);
const hasOtherBookmarks = computed(
  () => (otherBookmarks.value?.children.length ?? 0) > 0,
);
const showSkeleton = computed(() => !homepage.value && !error.value);

const bookmarkFeedback = computed(() => {
  if (!error.value) {
    return '';
  }
  if (!stale.value || !lastUpdatedAt.value) {
    return error.value;
  }

  const time = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(lastUpdatedAt.value));
  return `${error.value} 当前显示的是上次成功读取的数据（${time}），不是离线书签副本。`;
});
</script>

<template>
  <main class="home" :class="{ 'home--ready': Boolean(homepage) }">
    <h1 class="visually-hidden">Bookmark Home 新标签页</h1>

    <section class="home__hero" aria-label="搜索与常用网站">
      <SearchBar />

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
        <p class="visually-hidden" role="status">正在读取书签</p>
        <LoadingSkeleton />
      </div>
    </section>

    <section v-if="hasGroups" class="home__browse" aria-label="书签分类">
      <BookmarkGroups :groups="groups" />
    </section>

    <OtherBookmarks
      v-if="hasOtherBookmarks && otherBookmarks"
      :section="otherBookmarks"
    />

    <HealthEntryButton v-if="homepage" />

    <button
      v-if="homepage"
      class="add-button"
      type="button"
      aria-label="添加书签或文件夹"
      title="添加书签或文件夹"
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
  </main>

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

  <HealthDetailPopover v-if="healthDetail" />

  <OperationToast v-if="toast" :toast="toast" @close="manager.dismissToast" />
</template>
