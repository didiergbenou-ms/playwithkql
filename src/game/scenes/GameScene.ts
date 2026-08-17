import Phaser from 'phaser';
import { bus } from '../bus';
import { CHALLENGES } from '../../data/case001';
import { COLORS, PLAYER_H, PLAYER_W, generateTextures, registerAnimations } from '../textures';
import { characterById, textureKey, type CharacterDef } from '../characters';
import { TILE, parseLevel, type ParsedLevel } from '../levels/heartbeatHills';
import { CAMERA_ZOOM, VIEW_WIDTH } from '../config';
import { audio } from '../audio';

const GRAVITY = 780;
const RUN_SPEED = 118;
const AIR_ACCEL = 900;
const GROUND_ACCEL = 1500;
const JUMP_VELOCITY = -280;
const COYOTE_MS = 110;
const BUFFER_MS = 140;
const DEFAULT_MAX_HEALTH = 3;
const ENEMY_SPEED = 26;

type Interactable =
  | { kind: 'terminal'; challengeId: string; sprite: Phaser.GameObjects.Sprite; solved: boolean }
  | { kind: 'note'; noteId: string; sprite: Phaser.GameObjects.Sprite }
  | { kind: 'verdict'; sprite: Phaser.GameObjects.Sprite };

interface SceneInit {
  solvedChallenges?: string[];
  openGates?: string[];
  characterId?: string;
}

interface Run {
  col: number;
  row: number;
  len: number;
}

/** Collapses contiguous same-row tiles into single wide collision bodies. */
function mergeRuns(cells: { col: number; row: number }[]): Run[] {
  const byRow = new Map<number, number[]>();
  for (const c of cells) {
    const list = byRow.get(c.row);
    if (list) list.push(c.col);
    else byRow.set(c.row, [c.col]);
  }

  const runs: Run[] = [];
  for (const [row, colsRaw] of byRow) {
    const cols = [...colsRaw].sort((a, b) => a - b);
    let start = cols[0];
    let prev = cols[0];
    for (let i = 1; i <= cols.length; i++) {
      const c = cols[i];
      if (c !== prev + 1) {
        runs.push({ col: start, row, len: prev - start + 1 });
        start = c;
      }
      prev = c;
    }
  }
  return runs;
}

export class GameScene extends Phaser.Scene {
  private level!: ParsedLevel;
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  private solidLookup = new Set<string>();
  private gateSprites: { gateId: string; sprite: Phaser.Physics.Arcade.Sprite }[] = [];
  private interactables: { obj: Interactable; x: number; y: number }[] = [];
  private enemies!: Phaser.Physics.Arcade.Group;
  private fragments!: Phaser.Physics.Arcade.StaticGroup;
  private crystals!: Phaser.Physics.Arcade.StaticGroup;

  private prompt!: Phaser.GameObjects.Container;
  private promptText!: Phaser.GameObjects.Text;
  private roomBanner!: Phaser.GameObjects.Container;
  private waypoint!: Phaser.GameObjects.Text;
  private objectiveTarget: number | null = null;

  private lastGroundedAt = -9999;
  private jumpQueuedAt = -9999;
  private invulnerableUntil = 0;
  private facing = 1;

  private fragmentCount = 0;
  private crystalCount = 0;
  private health = DEFAULT_MAX_HEALTH;
  private maxHealth = DEFAULT_MAX_HEALTH;
  private notesRead = new Set<string>();
  private currentRoom = -1;
  private checkpoint = { x: 0, y: 0 };
  private nearest: Interactable | null = null;
  private frozen = false;
  private busOff: (() => void)[] = [];

  constructor() {
    super('Game');
  }

  init(data: SceneInit) {
    this.solvedIds = new Set(data.solvedChallenges ?? []);
    this.initialOpenGates = new Set(data.openGates ?? []);
    this.character = characterById(data.characterId ?? 'gumshoe');
  }

  private solvedIds = new Set<string>();
  private initialOpenGates = new Set<string>();
  private character!: CharacterDef;

  // ---- setup ---------------------------------------------------------------

  create() {
    generateTextures(this);
    registerAnimations(this);

    this.level = parseLevel();
    this.fragmentCount = 0;
    this.crystalCount = 0;
    this.maxHealth = this.character.stats.maxHealth;
    this.health = this.maxHealth;
    this.notesRead.clear();
    this.currentRoom = -1;
    this.gateSprites = [];
    this.interactables = [];
    this.solidLookup.clear();

    this.buildBackground();
    this.buildTerrain();
    this.buildProps();
    this.buildPlayer();
    this.buildHud();
    this.wireInput();
    this.wireBus();

    // Solid ceiling and side walls, but an open floor so falling off the world
    // still triggers the respawn check. Without the ceiling a player could jump
    // from a high platform and sail over a full-height gate.
    this.physics.world.setBounds(0, 0, this.level.width, this.level.height + 200);
    this.physics.world.setBoundsCollision(true, true, true, false);
    this.player.setCollideWorldBounds(true);

    this.cameras.main.setBounds(0, 0, this.level.width, this.level.height);
    this.cameras.main.setZoom(CAMERA_ZOOM);
    this.cameras.main.startFollow(this.player, true, 0.16, 0.18);
    this.cameras.main.setDeadzone(56, 32);
    this.cameras.main.setBackgroundColor(COLORS.dark);

    this.checkpoint = { ...this.level.spawn };
    bus.emit('game:ready');
    this.emitHud();
  }

  private buildBackground() {
    const { height } = this.level;
    const groundY = height - 3 * TILE;

    // Sized one screen wide plus a tile of slack, then pinned onto the camera's
    // left edge each frame. Anchored so the racks meet the ground line.
    this.parallaxFar = this.add
      .tileSprite(0, groundY - 150, VIEW_WIDTH + TILE, 160, 'skyline_far')
      .setOrigin(0)
      .setDepth(-95);
    this.parallaxNear = this.add
      .tileSprite(0, groundY - 148, VIEW_WIDTH + TILE, 160, 'skyline_near')
      .setOrigin(0)
      .setDepth(-90);

    for (const room of this.level.rooms.slice(1)) {
      this.add.rectangle(room.startX, 0, 1, height, COLORS.cyan, 0.1).setOrigin(0.5, 0).setDepth(-70);
    }
  }

  private parallaxFar!: Phaser.GameObjects.TileSprite;
  private parallaxNear!: Phaser.GameObjects.TileSprite;

  private buildTerrain() {
    const solids = this.physics.add.staticGroup();
    const platforms = this.physics.add.staticGroup();
    const spikes = this.physics.add.staticGroup();

    const solidRows = new Set(this.level.solids.map((s) => `${s.col},${s.row}`));

    // Visuals go through Blitters: hundreds of Bobs render in a single batch,
    // where hundreds of Sprites would each cost a transform + draw call.
    const groundBlitter = this.add.blitter(0, 0, 'tile').setDepth(-10);
    const capBlitter = this.add.blitter(0, 0, 'tile_top').setDepth(-10);

    for (const cell of this.level.solids) {
      const capped = !solidRows.has(`${cell.col},${cell.row - 1}`);
      const bx = cell.col * TILE;
      const by = cell.row * TILE;
      if (capped) capBlitter.create(bx, by);
      else groundBlitter.create(bx, by);
      this.solidLookup.add(`${cell.col},${cell.row}`);
    }

    // Physics uses merged horizontal runs instead of one body per tile.
    for (const run of mergeRuns(this.level.solids)) {
      const w = run.len * TILE;
      const body = solids.create(
        run.col * TILE + w / 2,
        run.row * TILE + TILE / 2,
        undefined as unknown as string,
      ) as Phaser.Physics.Arcade.Sprite;
      body.setVisible(false);
      body.setDisplaySize(w, TILE);
      (body.body as Phaser.Physics.Arcade.StaticBody).setSize(w, TILE).updateFromGameObject();
    }

    for (const cell of this.level.platforms) {
      const p = platforms.create(cell.col * TILE + TILE / 2, cell.row * TILE + 3, 'platform');
      const body = p.body as Phaser.Physics.Arcade.StaticBody;
      body.checkCollision.down = false;
      body.checkCollision.left = false;
      body.checkCollision.right = false;
      this.solidLookup.add(`${cell.col},${cell.row}`);
    }

    for (const cell of this.level.spikes) {
      spikes.create(cell.x, cell.y, 'spike');
    }

    for (const cell of this.level.gates) {
      const g = this.physics.add.staticSprite(cell.x, cell.y, 'gate');
      this.gateSprites.push({ gateId: cell.gateId, sprite: g });
    }
    // open gates carried over from a previous session, after every cell exists
    for (const gateId of this.initialOpenGates) this.openGate(gateId, false);

    this.terrain = { solids, platforms, spikes };
  }

  private terrain!: {
    solids: Phaser.Physics.Arcade.StaticGroup;
    platforms: Phaser.Physics.Arcade.StaticGroup;
    spikes: Phaser.Physics.Arcade.StaticGroup;
  };

  private buildProps() {
    this.fragments = this.physics.add.staticGroup();
    this.crystals = this.physics.add.staticGroup();

    for (const cell of this.level.fragments) {
      const f = this.fragments.create(cell.x, cell.y, 'fragment0') as Phaser.Physics.Arcade.Sprite;
      f.play('fragment');
    }

    for (const cell of this.level.crystals) {
      const c = this.crystals.create(cell.x, cell.y, 'crystal0') as Phaser.Physics.Arcade.Sprite;
      c.play('crystal');
    }

    this.enemies = this.physics.add.group({ allowGravity: true, collideWorldBounds: false });
    for (const cell of this.level.enemies) {
      const e = this.enemies.create(cell.x, cell.y, 'bug0') as Phaser.Physics.Arcade.Sprite;
      e.play('bug');
      e.setSize(12, 9).setOffset(0, 3);
      e.setData('dir', cell.col % 2 === 0 ? 1 : -1);
      e.setBounce(0);
      // world gravity is zero, so every dynamic body opts in individually
      (e.body as Phaser.Physics.Arcade.Body).setGravityY(GRAVITY);
    }

    for (const cell of this.level.terminals) {
      const spec = CHALLENGES[cell.challengeIndex];
      if (!spec) continue;
      const solved = this.solvedIds.has(spec.id);
      const sprite = this.add
        .sprite(cell.x, (cell.row + 1) * TILE, solved ? 'terminal_solved' : 'terminal_locked')
        .setOrigin(0.5, 1);
      this.interactables.push({
        obj: { kind: 'terminal', challengeId: spec.id, sprite, solved },
        x: cell.x,
        y: (cell.row + 1) * TILE - 14,
      });
    }

    for (const cell of this.level.notes) {
      const sprite = this.add.sprite(cell.x, (cell.row + 1) * TILE, 'note').setOrigin(0.5, 1);
      this.interactables.push({
        obj: { kind: 'note', noteId: cell.noteId, sprite },
        x: cell.x,
        y: (cell.row + 1) * TILE - 8,
      });
    }

    if (this.level.verdict) {
      const cell = this.level.verdict;
      const sprite = this.add.sprite(cell.x, (cell.row + 1) * TILE, 'verdict').setOrigin(0.5, 1);
      this.interactables.push({
        obj: { kind: 'verdict', sprite },
        x: cell.x,
        y: (cell.row + 1) * TILE - 20,
      });
    }

    for (const cell of this.level.checkpoints) {
      this.add
        .rectangle(cell.x, (cell.row + 1) * TILE - 2, 10, 2, COLORS.lime, 0.9)
        .setOrigin(0.5, 1);
      this.checkpointPoints.push({ x: cell.x, y: (cell.row + 1) * TILE - PLAYER_H / 2 - 2 });
    }
  }

  private checkpointPoints: { x: number; y: number }[] = [];

  private buildPlayer() {
    const { x, y } = this.level.spawn;
    const stats = this.character.stats;
    this.player = this.physics.add.sprite(x, y, textureKey(this.character.id, 'idle0'));
    this.player.setSize(PLAYER_W, PLAYER_H).setOffset(3, 4);
    this.player.setMaxVelocity(200 * stats.speed, 460);
    this.player.setDragX(800);
    (this.player.body as Phaser.Physics.Arcade.Body).setGravityY(GRAVITY);
    this.player.setDepth(10);
    this.player.play(`idle_${this.character.id}`);

    this.physics.add.collider(this.player, this.terrain.solids);
    this.physics.add.collider(this.player, this.terrain.platforms);
    this.physics.add.collider(
      this.player,
      this.gateSprites.map((g) => g.sprite),
    );
    this.physics.add.overlap(this.player, this.terrain.spikes, () => this.hurt(true));
    this.physics.add.overlap(this.player, this.fragments, (_p, f) =>
      this.collect(f as Phaser.Physics.Arcade.Sprite, 'fragment'),
    );
    this.physics.add.overlap(this.player, this.crystals, (_p, c) =>
      this.collect(c as Phaser.Physics.Arcade.Sprite, 'crystal'),
    );

    this.physics.add.collider(this.enemies, this.terrain.solids);
    this.physics.add.collider(this.enemies, this.terrain.platforms);
    this.physics.add.overlap(this.player, this.enemies, (_p, e) =>
      this.hitEnemy(e as Phaser.Physics.Arcade.Sprite),
    );
  }

  private buildHud() {
    // waypoint chevron: points toward whatever the player should do next
    this.waypoint = this.add.text(0, 0, '\u25B6', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '8px',
      color: '#f7c948',
    });
    this.waypoint.setOrigin(0.5, 0.5).setDepth(65).setVisible(false).setResolution(4);
    this.tweens.add({
      targets: this.waypoint,
      alpha: { from: 1, to: 0.25 },
      duration: 600,
      yoyo: true,
      repeat: -1,
    });

    this.promptText = this.add
      .text(0, 0, '', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '5px',
        color: '#0d0b1a',
        backgroundColor: '#f7c948',
        padding: { x: 3, y: 2 },
      })
      .setOrigin(0.5, 1)
      .setResolution(4);
    this.prompt = this.add.container(0, 0, [this.promptText]).setDepth(60).setVisible(false);

    const title = this.add
      .text(0, 0, '', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '12px',
        color: '#f6f6ff',
      })
      .setOrigin(0.5, 0.5)
      .setResolution(3);
    const sub = this.add
      .text(0, 16, '', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '6px',
        color: '#4fe6e6',
      })
      .setOrigin(0.5, 0.5)
      .setResolution(3);
    // World-space (not scrollFactor 0) so the camera zoom applies to it;
    // update() keeps it pinned to the camera centre while it is visible.
    this.roomBanner = this.add.container(0, 0, [title, sub]).setDepth(70).setAlpha(0);
  }

  private wireInput() {
    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.keys = kb.addKeys('W,A,S,D,E,R,SPACE') as Record<string, Phaser.Input.Keyboard.Key>;

    this.keys.E.on('down', () => this.interact());
    this.keys.R.on('down', () => this.respawn());
  }

  /**
   * Phaser captures SPACE and the arrow keys at the document level, so it
   * preventDefaults them even when the plugin itself is disabled. That ate
   * every space bar press while a React modal had focus.
   */
  private setKeyboardCapture(active: boolean) {
    const kb = this.input.keyboard;
    if (!kb) return;
    kb.enabled = active;
    if (active) kb.enableGlobalCapture();
    else kb.disableGlobalCapture();
  }

  private wireBus() {
    this.busOff.push(
      bus.on('ui:openGate', ({ gateId, challengeId }) => {
        this.openGate(gateId, true);
        if (challengeId) this.markTerminalSolved(challengeId);
      }),
    );
    this.busOff.push(
      bus.on('ui:setPaused', ({ paused }) => {
        this.frozen = paused;
        this.setKeyboardCapture(!paused);
        if (paused) {
          this.physics.pause();
          this.player.anims.pause();
          // drop held keys so movement does not resume on close
          this.input.keyboard?.resetKeys();
          this.jumpHeld = false;
        } else {
          this.physics.resume();
          this.player.anims.resume();
          // stop the key that closed the modal from immediately re-opening it
          this.interactLockUntil = this.time.now + 250;
        }
      }),
    );
    this.busOff.push(bus.on('ui:restartRoom', () => this.respawn()));
    this.busOff.push(
      bus.on('ui:objective', ({ challengeId, finale }) => {
        this.objectiveTarget = this.findObjectiveX(challengeId, finale);
      }),
    );

    // Phaser emits SHUTDOWN when a scene stops, but DESTROY when the whole
    // game is torn down (which is what happens on Abandon). Listening for only
    // SHUTDOWN leaked these bus handlers; on re-entry the stale handler ran
    // against a destroyed scene, threw, and left the player on a black screen.
    const cleanup = () => {
      this.busOff.forEach((off) => off());
      this.busOff = [];
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
  }

  // ---- gameplay ------------------------------------------------------------

  update(_time: number, delta: number) {
    if (this.frozen) return;
    const now = this.time.now;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const dt = delta / 1000;

    const left = this.cursors.left.isDown || this.keys.A.isDown;
    const right = this.cursors.right.isDown || this.keys.D.isDown;
    const jumpDown = this.cursors.up.isDown || this.keys.W.isDown || this.keys.SPACE.isDown;

    const grounded = body.blocked.down || body.touching.down;
    if (grounded) this.lastGroundedAt = now;
    if (jumpDown && !this.jumpHeld) this.jumpQueuedAt = now;
    this.jumpHeld = jumpDown;

    // horizontal movement with separate ground/air acceleration
    const stats = this.character.stats;
    const runSpeed = RUN_SPEED * stats.speed;
    const accel = (grounded ? GROUND_ACCEL : AIR_ACCEL) * stats.speed;
    if (left && !right) {
      body.velocity.x = Math.max(body.velocity.x - accel * dt, -runSpeed);
      this.facing = -1;
    } else if (right && !left) {
      body.velocity.x = Math.min(body.velocity.x + accel * dt, runSpeed);
      this.facing = 1;
    } else if (grounded) {
      body.velocity.x *= 0.72;
      if (Math.abs(body.velocity.x) < 12) body.velocity.x = 0;
    }
    this.player.setFlipX(this.facing < 0);

    // coyote time + input buffering
    const canCoyote = now - this.lastGroundedAt <= COYOTE_MS;
    const buffered = now - this.jumpQueuedAt <= BUFFER_MS;
    if (buffered && canCoyote) {
      body.velocity.y = JUMP_VELOCITY * stats.jump;
      this.jumpQueuedAt = -9999;
      this.lastGroundedAt = -9999;
      this.puff(this.player.x, this.player.y + PLAYER_H / 2, 'spark_cyan', 5);
      audio.play('jump');
    }

    // variable jump height
    if (!jumpDown && body.velocity.y < -160) body.velocity.y = -160;

    this.updateAnimation(grounded, body.velocity);
    this.updateEnemies();
    this.updateProximity();
    this.updateCheckpoints();
    this.updateRoom();

    // Manual parallax. NOTE: with camera zoom, scrollX is *not* the left edge
    // of the visible world — worldView.x is. Using scrollX here left the layers
    // half a screen out of position.
    const cam = this.cameras.main;
    const viewLeft = cam.worldView.x;
    this.parallaxFar.x = viewLeft;
    this.parallaxFar.tilePositionX = viewLeft * 0.3;
    this.parallaxNear.x = viewLeft;
    this.parallaxNear.tilePositionX = viewLeft * 0.55;

    if (this.roomBanner.alpha > 0) {
      this.roomBanner.setPosition(cam.midPoint.x, cam.midPoint.y - 46);
    }

    this.updateWaypoint();

    if (this.player.y > this.level.height + 40) this.hurt(true);

    if (now < this.invulnerableUntil) {
      this.player.setAlpha(Math.floor(now / 60) % 2 ? 0.35 : 1);
    } else {
      this.player.setAlpha(1);
    }
  }

  private jumpHeld = false;

  private updateAnimation(grounded: boolean, v: Phaser.Math.Vector2) {
    const id = this.character.id;
    if (!grounded) {
      this.player.anims.stop();
      this.player.setTexture(textureKey(id, v.y < 0 ? 'jump' : 'fall'));
      return;
    }
    const key = Math.abs(v.x) > 12 ? `run_${id}` : `idle_${id}`;
    if (this.player.anims.currentAnim?.key !== key || !this.player.anims.isPlaying) {
      this.player.play(key, true);
    }
  }

  private updateEnemies() {
    for (const obj of this.enemies.getChildren()) {
      const e = obj as Phaser.Physics.Arcade.Sprite;
      if (!e.active) continue;
      let dir = e.getData('dir') as number;
      const body = e.body as Phaser.Physics.Arcade.Body;

      const col = Math.floor((e.x + dir * 9) / TILE);
      const rowBelow = Math.floor((e.y + 11) / TILE);
      const groundAhead = this.solidLookup.has(`${col},${rowBelow}`);
      const wallAhead = this.solidLookup.has(`${col},${Math.floor(e.y / TILE)}`);

      if ((!groundAhead && body.blocked.down) || wallAhead || body.blocked.left || body.blocked.right) {
        dir *= -1;
        e.setData('dir', dir);
      }
      e.setVelocityX(ENEMY_SPEED * dir);
      e.setFlipX(dir < 0);
    }
  }

  private updateProximity() {
    let best: Interactable | null = null;
    let bestDist = 30;
    let bx = 0;
    let by = 0;

    for (const entry of this.interactables) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, entry.x, entry.y + 10);
      if (d < bestDist) {
        bestDist = d;
        best = entry.obj;
        bx = entry.x;
        by = entry.y;
      }
    }

    this.nearest = best;
    if (!best) {
      this.prompt.setVisible(false);
      return;
    }

    const label =
      best.kind === 'terminal'
        ? best.solved
          ? '[E] review query'
          : '[E] run KQL'
        : best.kind === 'note'
          ? '[E] read'
          : '[E] submit verdict';
    this.promptText.setText(label);
    // clear of both the prop and the (taller) player sprite
    this.prompt.setPosition(bx, Math.min(by, this.player.y - PLAYER_H / 2) - 6).setVisible(true);
  }

  private updateCheckpoints() {
    for (const cp of this.checkpointPoints) {
      if (
        Math.abs(this.player.x - cp.x) < 20 &&
        Math.abs(this.player.y - cp.y) < 24 &&
        (this.checkpoint.x !== cp.x || this.checkpoint.y !== cp.y)
      ) {
        this.checkpoint = { ...cp };
        this.puff(cp.x, cp.y + 6, 'spark_amber', 4);
      }
    }
  }

  /** World x of the current objective, or null if there isn't one. */
  private findObjectiveX(challengeId: string | undefined, finale: boolean): number | null {
    if (finale) {
      const v = this.interactables.find((i) => i.obj.kind === 'verdict');
      return v ? v.x : null;
    }
    if (!challengeId) return null;
    const t = this.interactables.find(
      (i) => i.obj.kind === 'terminal' && i.obj.challengeId === challengeId,
    );
    return t ? t.x : null;
  }

  /**
   * Floats a chevron above the player pointing at the objective. Hidden once
   * you are close enough to see the target yourself, so it never nags.
   */
  private updateWaypoint() {
    if (this.objectiveTarget === null) {
      this.waypoint.setVisible(false);
      return;
    }
    const dx = this.objectiveTarget - this.player.x;
    if (Math.abs(dx) < 70) {
      this.waypoint.setVisible(false);
      return;
    }
    this.waypoint.setVisible(true);
    this.waypoint.setText(dx > 0 ? '\u25B6' : '\u25C0');
    this.waypoint.setPosition(this.player.x + (dx > 0 ? 16 : -16), this.player.y - 20);
  }

  private updateRoom() {
    const idx = this.level.rooms.findIndex(
      (r) => this.player.x >= r.startX && this.player.x < r.endX,
    );
    if (idx === -1 || idx === this.currentRoom) return;
    this.currentRoom = idx;
    const room = this.level.rooms[idx];

    bus.emit('game:room', { name: room.name, index: idx });
    this.cameras.main.setBackgroundColor(room.tint);

    const [title, sub] = this.roomBanner.list as Phaser.GameObjects.Text[];
    title.setText(room.name);
    sub.setText(room.subtitle);
    this.roomBanner.setAlpha(0);
    this.tweens.add({
      targets: this.roomBanner,
      alpha: 1,
      duration: 300,
      yoyo: true,
      hold: 1400,
    });
    this.emitHud();
  }

  // ---- interactions --------------------------------------------------------

  private interactLockUntil = 0;
  /** Honour the OS "reduce motion" setting for shake and camera punch. */
  private readonly reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  private interact() {
    if (this.frozen || !this.nearest || this.time.now < this.interactLockUntil) return;
    const target = this.nearest;
    if (target.kind === 'terminal') {
      bus.emit('game:terminal', { challengeId: target.challengeId });
    } else if (target.kind === 'note') {
      this.notesRead.add(target.noteId);
      this.emitHud();
      bus.emit('game:note', { noteId: target.noteId });
    } else {
      bus.emit('game:verdict');
    }
  }

  private collect(sprite: Phaser.Physics.Arcade.Sprite, kind: 'fragment' | 'crystal') {
    if (!sprite.active) return;
    sprite.disableBody(true, false);
    this.tweens.add({
      targets: sprite,
      y: sprite.y - 12,
      alpha: 0,
      duration: 260,
      onComplete: () => sprite.destroy(),
    });
    this.puff(sprite.x, sprite.y, kind === 'fragment' ? 'spark_cyan' : 'spark_magenta', 6);

    if (kind === 'fragment') this.fragmentCount++;
    else this.crystalCount++;
    bus.emit('game:pickup', {
      kind,
      total: kind === 'fragment' ? this.fragmentCount : this.crystalCount,
    });
    this.emitHud();
  }

  private hitEnemy(enemy: Phaser.Physics.Arcade.Sprite) {
    if (!enemy.active) return;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const stomping = body.velocity.y > 30 && this.player.y < enemy.y - 3;

    if (stomping) {
      enemy.disableBody(true, false);
      this.tweens.add({
        targets: enemy,
        alpha: 0,
        scaleY: 0.3,
        duration: 150,
        onComplete: () => enemy.destroy(),
      });
      this.puff(enemy.x, enemy.y, 'spark_magenta', 8);
      body.velocity.y = -195;
      return;
    }
    this.hurt(false, enemy.x);
  }

  private hurt(fatal: boolean, fromX?: number) {
    if (this.time.now < this.invulnerableUntil) return;
    this.health = Math.max(0, this.health - 1);
    bus.emit('game:damage', { health: this.health });
    this.cameras.main.shake(140, 0.01);
    this.emitHud();

    if (fatal || this.health === 0) {
      this.respawn();
      return;
    }
    this.invulnerableUntil = this.time.now + 1200;
    const dir = fromX !== undefined && fromX > this.player.x ? -1 : 1;
    this.player.setVelocity(130 * dir, -150);
  }

  private respawn() {
    this.health = this.maxHealth;
    this.invulnerableUntil = this.time.now + 900;
    this.player.setVelocity(0, 0);
    this.player.setPosition(this.checkpoint.x, this.checkpoint.y - 4);
    this.cameras.main.flash(220, 10, 20, 45);
    bus.emit('game:death');
    this.emitHud();
  }

  private openGate(gateId: string, animate: boolean) {
    for (const g of this.gateSprites) {
      if (g.gateId !== gateId || !g.sprite.active) continue;
      const body = g.sprite.body as Phaser.Physics.Arcade.StaticBody | null;
      if (body) body.enable = false;
      if (animate) {
        this.puff(g.sprite.x, g.sprite.y, 'spark_amber', 5);
        this.tweens.add({
          targets: g.sprite,
          alpha: 0,
          scaleY: 0.1,
          duration: 380,
          ease: 'Back.easeIn',
          onComplete: () => g.sprite.destroy(),
        });
      } else {
        g.sprite.destroy();
      }
    }
    if (animate) {
      audio.play('gate');
      // camera punch: a brief zoom-in that snaps back reads as impact without
      // the vestibular problems of a big shake
      if (!this.reducedMotion) {
        this.cameras.main.zoomTo(CAMERA_ZOOM * 1.06, 90, 'Quad.easeOut', true);
        this.time.delayedCall(110, () =>
          this.cameras.main.zoomTo(CAMERA_ZOOM, 220, 'Quad.easeOut', true),
        );
        this.cameras.main.shake(180, 0.004);
      }
      // single flash, well inside the WCAG three-per-second limit
      this.cameras.main.flash(200, 60, 40, 0);
    }
  }

  private markTerminalSolved(challengeId: string) {
    for (const entry of this.interactables) {
      if (entry.obj.kind === 'terminal' && entry.obj.challengeId === challengeId) {
        entry.obj.solved = true;
        entry.obj.sprite.setTexture('terminal_solved');
        this.puff(entry.x, entry.y, 'spark_cyan', 8);
      }
    }
  }

  private puff(x: number, y: number, texture: string, count: number) {
    const emitter = this.add.particles(x, y, texture, {
      speed: { min: 20, max: 70 },
      angle: { min: 200, max: 340 },
      lifespan: 380,
      quantity: count,
      emitting: false,
    });
    emitter.setDepth(50);
    emitter.explode(count);
    this.time.delayedCall(600, () => emitter.destroy());
  }

  private emitHud() {
    bus.emit('game:hud', {
      fragments: this.fragmentCount,
      crystals: this.crystalCount,
      health: this.health,
      maxHealth: this.maxHealth,
      room: this.level.rooms[Math.max(0, this.currentRoom)]?.name ?? '',
      notes: this.notesRead.size,
    });
  }
}
