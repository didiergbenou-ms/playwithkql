/**
 * Heartbeat Hills — Case 001.
 *
 * The world is authored as ASCII so a level designer can reshape it without
 * touching engine code. Rows are padded to ROOM_WIDTH on load, so you only
 * need to count columns up to the last thing you place.
 *
 *   #  solid block          =  one-way platform      ^  spikes
 *   P  player spawn         @  checkpoint            f  log fragment
 *   c  kusto crystal        E  corrupted null (enemy)
 *   1-5 KQL terminal (index into CHALLENGES)
 *   G H J K L  gates, mapped by GATE_CHARS below
 *   V  verdict console      n  lore board
 */

export const TILE = 16;
export const ROWS = 13;
export const ROOM_WIDTH = 46;

export const GATE_CHARS: Record<string, string> = {
  G: 'gate-office',
  H: 'gate-forest',
  J: 'gate-caverns',
  K: 'gate-datacenter',
  L: 'gate-core',
};

export interface RoomDef {
  name: string;
  subtitle: string;
  /** Background tint for the parallax layers. */
  tint: number;
  rows: string[];
}

const office: RoomDef = {
  name: 'Customer Office',
  subtitle: 'Contoso — Platform Operations',
  tint: 0x121a3d,
  rows: [
    '                                        G',
    '                                        G',
    '                                f c f   G',
    '                                =====   G',
    '                            ===         G',
    '                 ==========             G',
    '          f f f                         G',
    '         =======                        G',
    '      ===                               G',
    '   P  n           f           1   n     G',
    '##############################################',
    '##############################################',
    '##############################################',
  ],
};

const forest: RoomDef = {
  name: 'Monitoring Forest',
  subtitle: 'Telemetry pines — mind the gaps',
  tint: 0x0d2438,
  rows: [
    '                                           H',
    '                                           H',
    '                        c                  H',
    '                     =======               H',
    '            f E f                          H',
    '          =========                        H',
    '      f f                                  H',
    '    ======                    ======       H',
    ' ===                           f f  ===    H',
    ' @      E             f   f           2    H',
    '##############    ############   #############',
    '##############    ############   #############',
    '##############^^^^############^^^#############',
  ],
};

const caverns: RoomDef = {
  name: 'Server Caverns',
  subtitle: 'Cold aisle, colder logs',
  tint: 0x1a1030,
  rows: [
    '                                   J        K',
    '                                   J        K',
    '                                   J        K',
    '                                   J        K',
    '                            f 3  c J        K',
    '                           ======= J        K',
    '                     f             J        K',
    '                   ======          J        K',
    '             f                     J        K',
    ' @         ======                  J        K',
    '#########                          J        K',
    '#########   f    E   ^^f    E f    J   4    K',
    '##############################################',
  ],
};

const datacenter: RoomDef = {
  name: 'Data Center',
  subtitle: 'Core ingestion hall',
  tint: 0x2a1030,
  rows: [
    '                    L',
    '                    L',
    '                    L',
    '                    L',
    '                    L',
    '                    L    f c f',
    '                    L    =======',
    '                    L',
    '                    L ===',
    ' @  n   f  E  5     L           E   V',
    '##############################################',
    '##############################################',
    '##############################################',
  ],
};

export const ROOMS: RoomDef[] = [office, forest, caverns, datacenter];

export interface LoreNote {
  id: string;
  title: string;
  body: string;
}

/** Lore boards, in world reading order (top-to-bottom, left-to-right). */
export const NOTES: LoreNote[] = [
  {
    id: 'note-email',
    title: 'Pinned email — j.alvarez@contoso.com',
    body: `"Five servers have no heartbeat since around 09:00 UTC on 13 August. The machines are UP — I can RDP into them right now. Our edge web servers are still reporting fine. Nothing was patched. Nobody rebooted anything."\n\nUnderlined twice, in red pen: THE MACHINES ARE UP.`,
  },
  {
    id: 'note-cheatsheet',
    title: 'Bureau field card — KQL in six lines',
    body: `Heartbeat                      <- pick a table\n| where TimeGenerated > ago(24h)  <- keep some rows\n| project Computer, Version       <- keep some columns\n| summarize count() by Computer   <- squash into groups\n| sort by count_ asc              <- default is desc!\n| take 10                         <- stop reading\n\nEvery query is a pipeline. Data flows left to right, one pipe at a time.`,
  },
  {
    id: 'note-plaque',
    title: 'Brass plaque, Data Center entrance',
    body: `AZURE INVESTIGATION BUREAU\nRule 1 — a machine that writes logs is not a machine that is switched off.\nRule 2 — five things failing in the same minute is one thing failing.\nRule 3 — always ask what changed, then ask who changed it.`,
  },
];

export interface ParsedCell {
  char: string;
  col: number;
  row: number;
  /** World pixel position of the tile centre. */
  x: number;
  y: number;
  roomIndex: number;
}

export interface ParsedLevel {
  width: number;
  height: number;
  solids: ParsedCell[];
  platforms: ParsedCell[];
  spikes: ParsedCell[];
  gates: (ParsedCell & { gateId: string })[];
  fragments: ParsedCell[];
  crystals: ParsedCell[];
  enemies: ParsedCell[];
  terminals: (ParsedCell & { challengeIndex: number })[];
  notes: (ParsedCell & { noteId: string })[];
  checkpoints: ParsedCell[];
  verdict: ParsedCell | null;
  spawn: { x: number; y: number };
  rooms: { name: string; subtitle: string; tint: number; startX: number; endX: number }[];
  totalFragments: number;
  totalCrystals: number;
}

/** Turns the ASCII rooms into typed world data. */
export function parseLevel(): ParsedLevel {
  const level: ParsedLevel = {
    width: ROOMS.length * ROOM_WIDTH * TILE,
    height: ROWS * TILE,
    solids: [],
    platforms: [],
    spikes: [],
    gates: [],
    fragments: [],
    crystals: [],
    enemies: [],
    terminals: [],
    notes: [],
    checkpoints: [],
    verdict: null,
    spawn: { x: TILE * 3, y: TILE * 8 },
    rooms: ROOMS.map((r, i) => ({
      name: r.name,
      subtitle: r.subtitle,
      tint: r.tint,
      startX: i * ROOM_WIDTH * TILE,
      endX: (i + 1) * ROOM_WIDTH * TILE,
    })),
    totalFragments: 0,
    totalCrystals: 0,
  };

  let noteCursor = 0;

  for (let row = 0; row < ROWS; row++) {
    for (let roomIndex = 0; roomIndex < ROOMS.length; roomIndex++) {
      const raw = ROOMS[roomIndex].rows[row] ?? '';
      if (raw.length > ROOM_WIDTH) {
        console.warn(
          `[level] ${ROOMS[roomIndex].name} row ${row} is ${raw.length} chars, max ${ROOM_WIDTH}`,
        );
      }
      const line = raw.padEnd(ROOM_WIDTH, ' ');

      for (let c = 0; c < ROOM_WIDTH; c++) {
        const char = line[c];
        if (char === ' ') continue;

        const col = roomIndex * ROOM_WIDTH + c;
        const cell: ParsedCell = {
          char,
          col,
          row,
          x: col * TILE + TILE / 2,
          y: row * TILE + TILE / 2,
          roomIndex,
        };

        if (char === '#') level.solids.push(cell);
        else if (char === '=') level.platforms.push(cell);
        else if (char === '^') level.spikes.push(cell);
        else if (char === 'f') level.fragments.push(cell);
        else if (char === 'c') level.crystals.push(cell);
        else if (char === 'E') level.enemies.push(cell);
        else if (char === '@') level.checkpoints.push(cell);
        else if (char === 'V') level.verdict = cell;
        else if (char === 'P') level.spawn = { x: cell.x, y: cell.y };
        else if (char === 'n') {
          const note = NOTES[noteCursor] ?? NOTES[NOTES.length - 1];
          noteCursor++;
          level.notes.push({ ...cell, noteId: note.id });
        } else if (char >= '1' && char <= '5') {
          level.terminals.push({ ...cell, challengeIndex: Number(char) - 1 });
        } else if (char in GATE_CHARS) {
          level.gates.push({ ...cell, gateId: GATE_CHARS[char] });
        }
      }
    }
  }

  level.totalFragments = level.fragments.length;
  level.totalCrystals = level.crystals.length;
  return level;
}
