/**
 * Persistence is behind an adapter so the browser (localStorage / IndexedDB)
 * and a future backend (accounts, leaderboards) are interchangeable.
 */
export interface SaveData {
  version: 1;
  completed: Record<string, { xp: number; hintsUsed: number; at: number }>;
}

export interface StorageAdapter {
  load(): Promise<SaveData | null>;
  save(data: SaveData): Promise<void>;
}

export const emptySave = (): SaveData => ({ version: 1, completed: {} });

export function recordCompletion(
  save: SaveData,
  missionId: string,
  xp: number,
  hintsUsed: number,
  at: number = Date.now(),
): SaveData {
  const prev = save.completed[missionId];
  if (prev && prev.xp >= xp) return save;
  return { ...save, completed: { ...save.completed, [missionId]: { xp, hintsUsed, at } } };
}

export const totalXp = (save: SaveData): number =>
  Object.values(save.completed).reduce((sum, c) => sum + c.xp, 0);
