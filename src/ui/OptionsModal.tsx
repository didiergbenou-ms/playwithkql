import { useState } from 'react';
import { audio, type AudioSettings } from '../game/audio';
import { TRACKS } from '../game/music';
import { ContentSources } from './ContentSources';

export function OptionsModal({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<AudioSettings>(() => audio.getSettings());

  const apply = (patch: Partial<AudioSettings>) => {
    audio.update(patch);
    setS(audio.getSettings());
  };

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  return (
    <div className="modal options-modal">
      <header className="modal-head">
        <div>
          <span className="tag tag-cyan">SETTINGS</span>
          <h2>Options</h2>
        </div>
        <button className="ghost" onClick={onClose}>
          Close (Esc)
        </button>
      </header>

      <section className="opt-group">
        <h3>Music</h3>
        <div className="opt-row">
          <button
            className={s.musicOn ? 'primary small' : 'ghost small'}
            onClick={() => apply({ musicOn: !s.musicOn })}
            aria-pressed={s.musicOn}
          >
            {s.musicOn ? 'On' : 'Off'}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(s.musicVolume * 100)}
            disabled={!s.musicOn}
            onChange={(e) => apply({ musicVolume: Number(e.target.value) / 100 })}
            aria-label="Music volume"
          />
          <span className="opt-value">{Math.round(s.musicVolume * 100)}%</span>
        </div>
        <p className="opt-note">
          Original chiptune written for this game. Volume is deliberately low by default so it sits
          under the sound effects.
        </p>
      </section>

      <section className="opt-group">
        <h3>Sound effects</h3>
        <div className="opt-row">
          <button
            className={s.sfxOn ? 'primary small' : 'ghost small'}
            onClick={() => apply({ sfxOn: !s.sfxOn })}
            aria-pressed={s.sfxOn}
          >
            {s.sfxOn ? 'On' : 'Off'}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(s.sfxVolume * 100)}
            disabled={!s.sfxOn}
            onChange={(e) => apply({ sfxVolume: Number(e.target.value) / 100 })}
            aria-label="Sound effects volume"
          />
          <span className="opt-value">{Math.round(s.sfxVolume * 100)}%</span>
        </div>
        <div className="opt-row">
          <button className="ghost small" onClick={() => audio.play('correctGood')}>
            Test effect
          </button>
          <span className="opt-note">Query-accepted cue</span>
        </div>
      </section>

      <section className="opt-group">
        <h3>Soundtrack</h3>
        <ul className="opt-tracks">
          {Object.values(TRACKS).map((t) => (
            <li key={t.id}>
              <strong>{t.title}</strong>
              <span>
                {t.bpm} BPM · {t.channels.length} channels
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="opt-group">
        <h3>Motion</h3>
        <p className="opt-note">
          {reducedMotion
            ? 'Your system asks for reduced motion, so screen shake, camera punch and flying confetti are already switched off.'
            : 'Screen shake and confetti follow your system “reduce motion” setting. Turn it on in your OS accessibility settings and the game will calm down automatically.'}
        </p>
      </section>

      <footer className="modal-foot">
        <span className="muted">Settings are saved on this machine.</span>
        <button className="primary" onClick={onClose}>
          Done
        </button>
      </footer>
      <ContentSources />
    </div>
  );
}
