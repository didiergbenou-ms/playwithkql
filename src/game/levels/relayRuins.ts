import {
  GATE_CHARS,
  ROOM_WIDTH,
  ROWS,
  assertLevelDefinition,
  type LevelDefinition,
  type LoreNote,
  type RoomDef,
} from './heartbeatHills';

const PREFIX = 'case003-';

const gates = {
  G: `${PREFIX}${GATE_CHARS.G}`,
  H: `${PREFIX}${GATE_CHARS.H}`,
  J: `${PREFIX}${GATE_CHARS.J}`,
  K: `${PREFIX}${GATE_CHARS.K}`,
  L: `${PREFIX}${GATE_CHARS.L}`,
};

const rooms: RoomDef[] = [
  {
    name: 'Survey Camp',
    subtitle: 'Collapsed relay tents and easy first climbs',
    tint: 0x2f203f,
    rows: [
      '                                           G',
      '                                           G',
      '                                           G',
      '                    f fc                   G',
      '                   #####                   G',
      '               f c #####  f                G',
      '              #### ##### ####              G',
      '           f  #### ##### ####  f           G',
      '          ### #### ##### #### ###          G',
      '  P @ fn  ### #### ##### #### ###    1  f  G',
      '##############################################',
      '##############################################',
      '##############################################',
    ],
  },
  {
    name: 'Shattered Causeway',
    subtitle: 'Stone spans stacked like broken ladders',
    tint: 0x3c2349,
    rows: [
      '                                            H',
      '                                            H',
      '                                            H',
      '                   f  f                     H',
      '                  ======                    H',
      '             f  c        f  c               H',
      '            ======      ======              H',
      '        f                       f           H',
      '       =====                  ======        H',
      '  @ fn                                 2 f  H',
      '##########################  ##################',
      '##########################  ##################',
      '##########################^^##################',
    ],
  },
  {
    name: 'Relay Vault',
    subtitle: 'Training vault split by twin ward doors',
    tint: 0x4a2755,
    rows: [
      '                     J                   K',
      '                     J                   K',
      '                     J                   K',
      '                     J                   K',
      '                     J                   K',
      '             f c     J         f c       K',
      '            ####     J        ####       K',
      '        f   ####     J    f   ####       K',
      '       #### ####     J   #### ####===    K',
      '   @ f #### #### f3  J nf#### ####    4f K',
      '##############################################',
      '##############################################',
      '##############################################',
    ],
  },
  {
    name: 'Archive Spire',
    subtitle: 'Final console above the reclaimed stacks',
    tint: 0x5a2e65,
    rows: [
      '                        L',
      '                        L',
      '                        L',
      '                        L',
      '                        L',
      '             f c        L         f c',
      '            ####        L        ####',
      '        f   ####  f     L    f   ####',
      '       #### ####====    L   #### ####===',
      '   @ f #### ####     5  L f #### ####   f V',
      '##############################################',
      '##############################################',
      '##############################################',
    ],
  },
];

const notes: LoreNote[] = [
  {
    id: `${PREFIX}note-camp`,
    title: 'Camp ledger — scaffold status',
    body:
      'Relay Ruins is another movement-and-content scaffold. Its rooms are newly authored, but the terminal objectives still point at the Heartbeat Hills Case 001 training incident until a ruin-specific outage story is written.',
  },
  {
    id: `${PREFIX}note-causeway`,
    title: 'Broken arch inscription — deliberate reuse',
    body:
      'Do not read new support meaning into the copied terminal text. This build intentionally reuses the same Case 001 database, worked examples, and verdict chain so designers can tune jumps, checkpoints, and gate pacing without waiting on fresh telemetry.',
  },
  {
    id: `${PREFIX}note-vault`,
    title: 'Vault margin note — replace after playtest',
    body:
      'Authoring reminder: swap these borrowed lessons for Relay Ruins-specific evidence once the custom corpus exists. Keep the forgiving geometry, because the purpose of this prototype is to validate readability and reach, not advanced platforming.',
  },
];

if (rooms.length !== 4) throw new Error(`Relay Ruins: expected 4 rooms, got ${rooms.length}`);
if (notes.length !== 3) throw new Error(`Relay Ruins: expected 3 notes, got ${notes.length}`);
if (rooms.some((room) => room.rows.length !== ROWS)) throw new Error('Relay Ruins: every room must have 13 rows');
if (rooms.some((room) => room.rows.some((row) => row.length > ROOM_WIDTH))) {
  throw new Error('Relay Ruins: room row exceeds 46 columns');
}

export const RELAY_RUINS: LevelDefinition = assertLevelDefinition('Relay Ruins', {
  rooms,
  notes,
  gateChars: gates,
});
