import { useEffect, useMemo, useState } from 'react';
import { CHARACTERS, characterPreviewUrl, type CharacterDef } from '../game/characters';
import { useStore } from '../state/store';

/** Animated sprite preview — cycles the idle/run frames as an <img>. */
function SpritePreview({ def, animate }: { def: CharacterDef; animate: boolean }) {
  const frames = useMemo(
    () =>
      (animate ? (['run0', 'run1', 'run2', 'run3'] as const) : (['idle0', 'idle1'] as const)).map(
        (f) => characterPreviewUrl(def, f, 6),
      ),
    [def, animate],
  );
  const [i, setI] = useState(0);

  useEffect(() => {
    setI(0);
    const t = setInterval(() => setI((n) => (n + 1) % frames.length), animate ? 110 : 380);
    return () => clearInterval(t);
  }, [frames, animate]);

  return <img className="sprite-preview" src={frames[i]} alt={def.name} />;
}

export function CharacterSelect({ onPick, onBack }: { onPick: () => void; onBack: () => void }) {
  const chosen = useStore((s) => s.profile.character);
  const setCharacter = useStore((s) => s.setCharacter);
  const [hovered, setHovered] = useState<string | null>(null);

  const active = CHARACTERS.find((c) => c.id === chosen) ?? CHARACTERS[0];

  return (
    <div className="screen select">
      <div className="select-head">
        <span className="tag tag-cyan">AZURE INVESTIGATION BUREAU</span>
        <h1>Choose your recruit</h1>
        <p className="muted">
          Four investigators, four ways to cross Heartbeat Hills. The queries are the same — how you
          survive the trip is not.
        </p>
      </div>

      <div className="roster">
        {CHARACTERS.map((c) => (
          <button
            key={c.id}
            className={`recruit ${c.id === chosen ? 'chosen' : ''}`}
            onClick={() => setCharacter(c.id)}
            onMouseEnter={() => setHovered(c.id)}
            onMouseLeave={() => setHovered(null)}
          >
            <div className="recruit-art">
              <SpritePreview def={c} animate={hovered === c.id || chosen === c.id} />
            </div>
            <strong>{c.name}</strong>
            <span className="recruit-title">{c.title}</span>
            <span className="recruit-hearts" aria-label={`${c.stats.maxHealth} hearts`}>
              {Array.from({ length: c.stats.maxHealth }, (_, i) => (
                <i key={i} className="heart on" />
              ))}
            </span>
          </button>
        ))}
      </div>

      <div className="panel recruit-detail">
        <h2>
          {active.name} <span className="muted">— {active.title}</span>
        </h2>
        <p>{active.blurb}</p>
        <p className="perk">{active.perk}</p>
        <p className="homage">“{active.homage}”</p>
        <div className="brief-actions">
          <button className="ghost" onClick={onBack}>
            Back
          </button>
          <button className="primary big" onClick={onPick}>
            Deploy {active.name}
          </button>
        </div>
      </div>
    </div>
  );
}
