import type { HomepageBookmark, HomepageFolder } from './bookmark';
import type { FolderOption } from '../utils/folders';
import type { DropPosition } from '../utils/dragMove';

export type ManagedNode =
  | { kind: 'bookmark'; node: HomepageBookmark }
  | { kind: 'folder'; node: HomepageFolder };

export type BookmarkEditorState =
  | { mode: 'create'; defaultParentId: string }
  | { mode: 'edit'; bookmark: HomepageBookmark };

export type FolderEditorState =
  | { mode: 'create'; defaultParentId: string }
  | { mode: 'rename'; folder: HomepageFolder };

export interface ConfirmDialogState {
  target: ManagedNode;
  title: string;
  message: string;
  warning: string | null;
  confirmLabel: string;
  bulkIds?: string[];
}

export interface MoveDialogState {
  target: ManagedNode;
  tree: FolderOption[];
  currentParentId: string;
  bulkIds?: string[];
}

export interface ContextMenuItem {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
  target: ManagedNode | null;
}

export type DropTarget =
  | {
      kind: 'bookmark';
      id: string;
      parentId: string;
      position: DropPosition;
    }
  | {
      kind: 'folder';
      id: string;
      parentId: string;
      position: 'inside';
    };

export interface DragState {
  node: ManagedNode;
  drop: DropTarget | null;
}

export interface ToastState {
  id: number;
  tone: 'success' | 'error';
  message: string;
  actionLabel?: string;
}

export interface BookmarkFormPayload {
  title: string;
  url: string;
  parentId: string;
}

export interface FolderFormPayload {
  title: string;
  parentId: string;
}
