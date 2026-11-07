import type { GameSnapshot } from '@greyhat/core';

const ROLE_LABEL: Record<GameSnapshot['role'], string> = {
  fundamentals: 'Fundamentals',
  offense: 'Red team',
  defense: 'Blue team',
};

interface Props {
  snap: GameSnapshot;
  onRestart: () => void;
}

export function MissionPanel({ snap, onRestart }: Props) {
  const done = snap.objectives.filter((o) => o.done).length;
  return (
    <section className="card">
      <header className="card-head">
        <div>
          <h2>{snap.title}</h2>
          <div className="badges">
            <span className={`badge role-${snap.role}`}>{ROLE_LABEL[snap.role]}</span>
            <span className="badge">Difficulty {snap.difficulty}/5</span>
            <span className="badge">{snap.potentialXp} XP</span>
          </div>
        </div>
        <button className="btn" onClick={onRestart} title="Restart with a freshly generated scenario">
          Restart
        </button>
      </header>

      <p className="briefing">{snap.briefing.join(' ')}</p>

      <h3>
        Objectives <span className="muted">{done}/{snap.objectives.length}</span>
      </h3>
      <ul className="objectives">
        {snap.objectives.map((o) => (
          <li key={o.id} className={o.done ? 'done' : ''}>
            <span className="check">{o.done ? '✔' : '○'}</span>
            {o.text}
          </li>
        ))}
      </ul>

      <p className="muted small">
        Hints used: {snap.hintsUsed}/{snap.hintsTotal}. Type <code>hint</code> in the terminal.
      </p>

      {snap.completed && (
        <div className="debrief">
          <h3>Mission complete: +{snap.xp} XP</h3>
          {snap.debrief.map((line, i) => (
            <p key={i}>{line || '\u00a0'}</p>
          ))}
        </div>
      )}
    </section>
  );
}
