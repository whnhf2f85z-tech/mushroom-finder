/** Ask the browser not to clear this site's data (pins, find log) under storage pressure. */
export async function requestPersist(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function isPersisted(): Promise<boolean | null> {
  try {
    return navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  } catch {
    return null;
  }
}

/** The "Install app" prompt (Chrome/Edge/Android), kept until the viewer asks for it. */
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let installPrompt: InstallPrompt | null = null;
const listeners = new Set<() => void>();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e as InstallPrompt;
  listeners.forEach((f) => f());
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  void requestPersist();
  listeners.forEach((f) => f());
});

export const canInstall = (): boolean => installPrompt !== null;
export const onInstallChange = (f: () => void): void => void listeners.add(f);
export async function install(): Promise<void> {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  listeners.forEach((f) => f());
}

export const isStandalone = (): boolean =>
  matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
