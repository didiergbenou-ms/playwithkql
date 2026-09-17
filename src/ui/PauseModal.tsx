export function PauseModal({ onResume }: { onResume: () => void }) {
  return (
    <div className="modal pause-modal">
      <header className="modal-head">
        <div>
          <span className="tag tag-cyan">TAKE A BREATHER</span>
          <h2>Game paused</h2>
        </div>
      </header>
      <p>Movement and the case timer are paused. Your investigation stays exactly where you left it.</p>
      <footer className="modal-foot">
        <button className="primary big" onClick={onResume}>Resume game</button>
        <span className="muted"><kbd>P</kbd> or <kbd>Esc</kbd> to resume</span>
      </footer>
    </div>
  );
}
