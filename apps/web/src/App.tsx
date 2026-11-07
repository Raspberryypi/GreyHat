import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Game, emptySave, recordCompletion, totalXp, type SaveData } from '@greyhat/core';
import { missions } from '@greyhat/content';
import { TerminalView } from './components/TerminalView';
import { MissionPanel } from './components/MissionPanel';
import { localStorageAdapter } from './storage';

export default function App() {
  const [missionId, setMissionId] = useState(missions[0].id);
  const [runId, setRunId] = useState(0);
  const [save, setSave] = useState<SaveData>(emptySave());

  useEffect(() => {
    void localStorageAdapter.load().then((d) => {
      if (d) setSave(d);
    });
  }, []);

  const mission = missions.find((m) => m.id === missionId) ?? missions[0];

  // A fresh Game (and freshly seeded world) for every mission start / restart.
  const game = useMemo(
    () => new Game(mission, Math.floor(Math.random() * 2_000_000_000)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mission, runId],
  );

  const subscribe = useCallback((cb: () => void) => game.onChange.on(() => cb()), [game]);
  const snap = useSyncExternalStore(subscribe, () => game.getSnapshot());

  useEffect(() => {
    if (!snap.completed) return;
    const next = recordCompletion(save, snap.missionId, snap.xp, snap.hintsUsed);
    if (next !== save) {
      setSave(next);
      void localStorageAdapter.save(next);
    }
  }, [snap.completed, snap.missionId, snap.xp, snap.hintsUsed, save]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">GREYHAT</span>
          <span className="tag">simulated security training</span>
        </div>
        <div className="xp">Total XP: <strong>{totalXp(save)}</strong></div>
      </header>

      <main className="main">
        <div className="terminal-wrap">
          <TerminalView key={`${missionId}-${runId}`} game={game} />
        </div>

        <aside className="side">
          <MissionPanel snap={snap} onRestart={() => setRunId((n) => n + 1)} />

          <section className="card">
            <h3>Missions</h3>
            <ul className="mission-list">
              {missions.map((m) => {
                const c = save.completed[m.id];
                return (
                  <li key={m.id}>
                    <button
                      className={`mission-btn ${m.id === missionId ? 'active' : ''}`}
                      onClick={() => {
                        setMissionId(m.id);
                        setRunId((n) => n + 1);
                      }}
                    >
                      <span>
                        {m.id}: {m.title}
                      </span>
                      <span className="muted small">{c ? `✔ ${c.xp} XP` : m.track}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>
      </main>
    </div>
  );
}
