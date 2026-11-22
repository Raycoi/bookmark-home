import { isHttpUrl } from '../utils/httpUrl';

export type BackgroundKind = 'default' | 'remote' | 'local';

export interface AppearanceSettings {
  backgroundKind: BackgroundKind;
  remoteUrl: string;
  localDataUrl: string;
  overlay: number;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  backgroundKind: 'default',
  remoteUrl: '',
  localDataUrl: '',
  overlay: 32,
};

const OVERLAY_MIN = 0;
const OVERLAY_MAX = 70;

export function normalizeAppearance(value: unknown): AppearanceSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_APPEARANCE };
  }

  const item = value as Partial<AppearanceSettings>;
  const kind: BackgroundKind =
    item.backgroundKind === 'remote' || item.backgroundKind === 'local'
      ? item.backgroundKind
      : 'default';
  const remoteUrl = typeof item.remoteUrl === 'string' ? item.remoteUrl.trim() : '';
  const localDataUrl =
    typeof item.localDataUrl === 'string' ? item.localDataUrl : '';
  const overlay =
    typeof item.overlay === 'number' && Number.isFinite(item.overlay)
      ? Math.min(OVERLAY_MAX, Math.max(OVERLAY_MIN, Math.round(item.overlay)))
      : DEFAULT_APPEARANCE.overlay;

  return {
    backgroundKind: kind,
    remoteUrl: isHttpUrl(remoteUrl) ? remoteUrl : '',
    localDataUrl: localDataUrl.startsWith('data:image/') ? localDataUrl : '',
    overlay,
  };
}
