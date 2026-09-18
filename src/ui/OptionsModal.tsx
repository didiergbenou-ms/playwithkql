import { useEffect, useRef, useState } from 'react';
import { audio, type AudioSettings } from '../game/audio';
import { TRACKS } from '../game/music';
import { ContentSources } from './ContentSources';
import { setInputMode, useInputMode, useTouchControlsEnabled, type InputMode } from './inputMode';

export function OptionsModal({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<AudioSettings>(() => audio.getSettings());
  const inputMode = useInputMode();
  const touchEnabled = useTouchControlsEnabled();
  const [soundTest, setSoundTest] = useState<string | null>(null);
  const testRequest = useRef(0);
  useEffect(() => () => { testRequest.current++; }, []);

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
        <h3>Controls and layout</h3>
        <div className="input-mode-options" role="group" aria-label="Controls and layout">
          {(['auto', 'keyboard', 'touch'] as InputMode[]).map((value) => (
            <button key={value} className={inputMode === value ? 'primary small' : 'ghost small'}
              onClick={() => setInputMode(value)} aria-pressed={inputMode === value}>
              {value === 'auto' ? 'Auto' : value === 'keyboard' ? 'Keyboard & mouse' : 'Touch'}
            </button>
          ))}
        </div>
        <p className="opt-note">
          {touchEnabled ? 'Touch layout is active.' : 'Desktop controls are active.'}{' '}
          Auto follows your primary pointer, not whether a touchscreen is present.
          Overrides apply for this visit and do not restart your investigation.
        </p>
      </section>

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
          <button className="ghost small" onClick={async () => {
            const request = ++testRequest.current;
            if (!s.sfxOn || s.sfxVolume <= 0) {
              setSoundTest('Turn on sound effects and raise their volume first.');
              return;
            }
            const ready = await audio.unlock();
            if (request !== testRequest.current) return;
            if (ready) audio.play('correctGood');
            setSoundTest(ready
              ? 'Audio engine is running. If you hear nothing, check Silent Mode, media volume and Bluetooth output.'
              : 'The browser has not enabled audio yet. Tap Test effect again after returning to this page.');
          }}>
            Test effect
          </button>
          <span className="opt-note">Query-accepted cue</span>
        </div>
        {soundTest && <p className="opt-note" role="status">{soundTest}</p>}
        <p className="opt-note">On iPhone, Silent Mode or the selected Bluetooth output may silence browser audio.</p>
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
