import { ref } from 'vue';
import { vi } from 'vitest';
import { transformBookmarkTree } from '../../src/adapters/bookmarkAdapter';
import { useBookmarkManager } from '../../src/composables/useBookmarkManager';
import type {
  BookmarkService,
  CreateBookmarkInput,
  CreateFolderInput,
  MoveDestination,
  UpdateBookmarkInput,
} from '../../src/services/bookmarkService';
import type { HomepageData, NativeBookmarkNode } from '../../src/types/bookmark';
import { makeStandardTree, nativeBookmark } from './bookmarkTree';

export const createdNode = nativeBookmark(
  'created',
  '1',
  0,
  'created',
  'https://created.example/',
);

export function createManagerService() {
  return {
    getTree: vi.fn(async (): Promise<NativeBookmarkNode[]> => []),
    getSubTree: vi.fn(async (): Promise<NativeBookmarkNode | null> => null),
    subscribe: vi.fn((_listener: () => void) => () => undefined),
    createBookmark: vi.fn(
      async (_input: CreateBookmarkInput): Promise<NativeBookmarkNode> =>
        createdNode,
    ),
    createFolder: vi.fn(
      async (_input: CreateFolderInput): Promise<NativeBookmarkNode> =>
        createdNode,
    ),
    updateBookmark: vi.fn(
      async (
        _id: string,
        _changes: UpdateBookmarkInput,
      ): Promise<NativeBookmarkNode> => createdNode,
    ),
    renameFolder: vi.fn(
      async (_id: string, _title: string): Promise<NativeBookmarkNode> =>
        createdNode,
    ),
    moveBookmark: vi.fn(
      async (
        _id: string,
        _destination: MoveDestination,
      ): Promise<NativeBookmarkNode> => createdNode,
    ),
    moveFolder: vi.fn(
      async (
        _id: string,
        _destination: MoveDestination,
      ): Promise<NativeBookmarkNode> => createdNode,
    ),
    removeBookmark: vi.fn(async (_id: string): Promise<void> => undefined),
    removeFolder: vi.fn(async (_id: string): Promise<void> => undefined),
  } satisfies BookmarkService;
}

export function setupManager(
  data: HomepageData = transformBookmarkTree(makeStandardTree()),
) {
  const dataRef = ref<HomepageData | null>(data);
  const service = createManagerService();
  const refresh = vi.fn(async () => undefined);
  const manager = useBookmarkManager({
    data: dataRef,
    refresh,
    service,
  });

  return { data, dataRef, service, refresh, manager };
}
