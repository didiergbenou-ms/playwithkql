import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { bus } from './bus';
import { GAME_HEIGHT, GAME_WIDTH } from './config';
import { DEFAULT_CASE_ID } from '../data/cases';

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
}

export function PhaserGame({
  solvedChallenges,
  openGates,
  characterId,
  caseId = DEFAULT_CASE_ID,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  // captured once — the scene is seeded on boot, then driven by the event bus
  const seed = useRef({ solvedChallenges, openGates, characterId, caseId });

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

    game.scene.add('Game', GameScene, true, seed.current);
    gameRef.current = game;

    // debug handle for level designers and automated playtests
    window.__kql = { game, bus };

    return () => {
      const g = gameRef.current;
      gameRef.current = null;
      if (window.__kql?.game === g) delete window.__kql;
      // Guard the teardown: rapid navigation could destroy the game while a
      // scene callback was still in flight, throwing "Cannot set properties
      // of null" from Phaser's internals.
      try {
        g?.destroy(true);
      } catch {
        /* already torn down */
      }
    };
  }, []);

  return <div className="phaser-host" ref={hostRef} />;
}
