/**
 * Typed event bridge between React (UI shell) and Phaser (world).
 * Phaser never imports the React store; it only speaks over this bus.
 */

export interface HudState {
  fragments: number;
  crystals: number;
  health: number;
  maxHealth: number;
  room: string;
  notes: number;
}

export type GameEvents = {
  'game:ready': void;
  'game:hud': HudState;
  'game:room': { name: string; index: number };
  'game:terminal': { challengeId: string };
  'game:note': { noteId: string };
  'game:verdict': void;
  'game:pickup': { kind: 'fragment' | 'crystal'; total: number };
  'game:damage': { health: number };
  'game:death': void;

  'ui:resume': void;
  'ui:openGate': { gateId: string; challengeId?: string };
  'ui:objective': { challengeId?: string; finale: boolean };
  'ui:restartRoom': void;
  'ui:setPaused': { paused: boolean };
  /** Dev shortcut: drop the player into a room without walking there. */
  'ui:teleport': { roomIndex: number };
};

type Handler<T> = (payload: T) => void;

class Bus {
  private map = new Map<string, Set<Handler<never>>>();

  on<K extends keyof GameEvents>(evt: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.map.get(evt as string);
    if (!set) {
      set = new Set();
      this.map.set(evt as string, set);
    }
    set.add(fn as Handler<never>);
    return () => this.off(evt, fn);
  }

  off<K extends keyof GameEvents>(evt: K, fn: Handler<GameEvents[K]>): void {
    this.map.get(evt as string)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof GameEvents>(
    evt: K,
    ...args: GameEvents[K] extends void ? [] : [GameEvents[K]]
  ): void {
    const set = this.map.get(evt as string);
    if (!set) return;
    for (const fn of [...set]) {
      // One misbehaving listener must not stop the others from running — a
      // stale handler from a destroyed scene used to break the whole chain.
      try {
        (fn as Handler<GameEvents[K]>)(args[0] as GameEvents[K]);
      } catch (err) {
        // Log and carry on rather than unsubscribing: the real fix for stale
        // listeners is the scene DESTROY cleanup, and silently dropping a live
        // listener because of one transient error would be worse.
        console.error(`[bus] listener for "${String(evt)}" threw`, err);
      }
    }
  }

  clear(): void {
    this.map.clear();
  }
}

export const bus = new Bus();
