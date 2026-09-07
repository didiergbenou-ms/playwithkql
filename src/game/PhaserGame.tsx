import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { bus } from './bus';
import { GAME_HEIGHT, GAME_WIDTH } from './config';

interface Props {
  solvedChallenges: string[];
  openGates: string[];
  characterId: string;
}

export function PhaserGame({ solvedChallenges, openGates, characterId }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  // captured once — the scene is seeded on boot, then driven by the event bus
  const seed = useRef({ solvedChallenges, openGates, characterId });

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
    (window as unknown as { __kql?: unknown }).__kql = { game, bus };

    return () => {
      const g = gameRef.current;
      gameRef.current = null;
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
