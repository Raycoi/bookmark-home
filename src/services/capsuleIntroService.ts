const KEY = 'bookmarkHome.capsuleIntroCompleted';
export async function shouldShowCapsuleIntro(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return false;
  try { return (await chrome.storage.local.get(KEY))[KEY] !== true; } catch { return false; }
}
export async function completeCapsuleIntro(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  try { await chrome.storage.local.set({ [KEY]: true }); } catch { /* 不阻断主页 */ }
}
