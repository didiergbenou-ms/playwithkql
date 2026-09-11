import {
  GATE_CHARS,
  ROOM_WIDTH,
  ROWS,
  assertLevelDefinition,
  type LevelDefinition,
  type LoreNote,
  type RoomDef,
} from './heartbeatHills';

const PREFIX = 'case002-';

const gates = {
  G: `${PREFIX}${GATE_CHARS.G}`,
  H: `${PREFIX}${GATE_CHARS.H}`,
  J: `${PREFIX}${GATE_CHARS.J}`,
  K: `${PREFIX}${GATE_CHARS.K}`,
  L: `${PREFIX}${GATE_CHARS.L}`,
};

const rooms: RoomDef[] = [
  {
    name: 'Harbor Dispatch',
    subtitle: 'Prototype pier office — copied lessons, new footing',
    tint: 0x17304a,
    rows: [
      '                                            G',
      '                                            G',
      '                                            G',
      '                       f  c                 G',
      '                     =======                G',
      '                f  c         f              G',
      '               ======       =====           G',
      '          f  f                              G',
      '          =====                  ====       G',
      '  P  @  nf                           1  f f G',
      '##############################################',
      '##############################################',
      '##############################################',
    ],
  },
  {
    name: 'Container Run',
    subtitle: 'Crane rails over the shallows',
    tint: 0x114067,
    rows: [
      '                                             H',
      '                                             H',
      '                                             H',
      '                  f   f                      H',
      '                 =======                     H',
      '            f  c         f                   H',
      '           ======       ======               H',
      '       f                        f c          H',
      '      =====                   ======         H',
      '  @ nf                    E           2   f  H',
      '##############################################',
      '##############################################',
      '##############################################',
    ],
  },
  {
    name: 'Beacon Locks',
    subtitle: 'Two lock chambers, two reused drills',
    tint: 0x1f3557,
    rows: [
      '                      J                    K',
      '                      J                    K',
      '                      J                    K',
      '                      J                    K',
      '                      J                    K',
      '            f  f      J         f c        K',
      '           ======     J        =====       K',
      '        f c           J     f              K',
      '      =====           J    ====     ====   K',
      '   @ f            3   J fn              4f K',
      '##############################################',
      '##############################################',
      '##############################################',
    ],
  },
  {
    name: 'Breakwater Control',
    subtitle: 'Verdict terminal beyond the storm gate',
    tint: 0x223b63,
    rows: [
      '                         L',
      '                         L',
      '                         L',
      '                         L',
      '                         L',
      '            f  c         L        f c',
      '           ======        L       =====',
      '       f          f      L   f',
      '      =====      =====   L  =====',
      '   @ f                5  L f           f V',
      '##############################################',
      '##############################################',
      '##############################################',
    ],
  },
];

const notes: LoreNote[] = [
  {
    id: `${PREFIX}note-dispatch`,
    title: 'Dockmaster clipboard — prototype disclaimer',
    body:
      'Signal Harbor is a playable map scaffold, not a bespoke customer story yet. The terminals in this build intentionally reuse the Heartbeat Hills Case 001 tasks and telemetry while the harbor-specific incident is still being authored.',
  },
  {
    id: `${PREFIX}note-crane`,
    title: 'Crane rail placard — copied training corpus',
    body:
      'Everything behind these gates is still wired to the same Contoso heartbeat outage training corpus: the same queries, the same evidence chain, and the same proxy diagnosis. The geometry is new; the lesson content is a deliberate placeholder.',
  },
  {
    id: `${PREFIX}note-locks`,
    title: 'Beacon workshop chalkboard — authoring TODO',
    body:
      'Replace the reused Case 001 support narrative with a Harbor routing scenario once the custom data tables, terminal briefings, and debrief copy are ready. Until then this chamber exists to validate flow, gates, checkpoints, and platform spacing.',
  },
];

if (rooms.length !== 4) throw new Error(`Signal Harbor: expected 4 rooms, got ${rooms.length}`);
if (notes.length !== 3) throw new Error(`Signal Harbor: expected 3 notes, got ${notes.length}`);
if (rooms.some((room) => room.rows.length !== ROWS)) throw new Error('Signal Harbor: every room must have 13 rows');
if (rooms.some((room) => room.rows.some((row) => row.length > ROOM_WIDTH))) {
  throw new Error('Signal Harbor: room row exceeds 46 columns');
}

export const SIGNAL_HARBOR: LevelDefinition = assertLevelDefinition('Signal Harbor', {
  rooms,
  notes,
  gateChars: gates,
});
