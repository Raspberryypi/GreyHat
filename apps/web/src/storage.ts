import type { SaveData, StorageAdapter } from '@greyhat/core';

const KEY = 'greyhat.save.v1';

/** Browser persistence. Swap for a backend-backed adapter later without touching the UI. */
export const localStorageAdapter: StorageAdapter = {
  async load(): Promise<SaveData | null> {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as SaveData) : null;
    } catch {
      return null;
    }
  },
  async save(data: SaveData): Promise<void> {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* storage unavailable or full; progress simply will not persist */
    }
  },
};
