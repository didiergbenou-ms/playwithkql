import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { bus } from './bus';
import { GAME_HEIGHT, GAME_WIDTH } from './config';
import { DEFAULT_CASE_ID } from '../data/cases';
import { DEFAULT_DIFFICULTY, type Difficulty } from '../data/difficulties';

declare global {
  interface Window {
    __kql?: { game: Phaser.Game; bus: typeof bus };
  }
}

interface Props {
  solvedChallenges: string[];
  openGates: string[];
  characterId: string;
  caseId?: string;
  difficulty?: Difficulty;
}

export function PhaserGame({
  solvedChallenges,
  openGates,
  characterId,
  caseId = DEFAULT_CASE_ID,
  difficulty = DEFAULT_DIFFICULTY,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  // captured once — the scene is seeded on boot, then driven by the event bus
  const seed = useRef({ solvedChallenges, openGates, characterId, caseId, difficulty });

  useEffect(() => {
    if (!hostRef.current || gameRef.current) return;

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: hostRef.current,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      backgroundColor: '#0d0b1a',
      pixelArt: true,
      roundPixels: true,
      physics: {
        default: 'arcade',
        arcade: { gravity: { x: 0, y: 0 }, debug: false },
      },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      fps: { target: 60 },
      scene: [],
    });

    let fitFrame: number | undefined;
    const fitParent = () => {
      if (fitFrame !== undefined) return;
      fitFrame = requestAnimationFrame(() => {
        fitFrame = undefined;
        if (gameRef.current !== game || !game.isRunning || !hostRef.current?.isConnected) return;
        game.scale.getParentBounds();
        game.scale.refresh();
      });
    };
    // React layout and phone browser chrome can resize the host without a
    // window resize, including while Phaser's frame loop is sleeping.
    const resizeObserver = new ResizeObserver(fitParent);
    resizeObserver.observe(hostRef.current);
    const startScene = () => {
      game.scene.add('Game', GameScene, true, seed.current);
      fitParent();
    };
    if (game.isRunning) startScene();
    else game.events.once(Phaser.Core.Events.READY, startScene);
    gameRef.current = game;

    // debug handle for level designers and automated playtests
    window.__kql = { game, bus };

    return () => {
      resizeObserver.disconnect();
      if (fitFrame !== undefined) cancelAnimationFrame(fitFrame);
      const g = gameRef.current;
      gameRef.current = null;
      if (window.__kql?.game === g) delete window.__kql;
      if (g) {
        g.events.off(Phaser.Core.Events.READY, startScene);
        g.destroy(true);
        // destroy() is processed on the next frame. A sleeping game needs that
        // frame to release its scene, listeners, renderer and canvas.
        if (g.isRunning && !g.loop.running) g.loop.wake();
      }
    };
  }, []);

  return <div className="phaser-host" ref={hostRef} />;
}
