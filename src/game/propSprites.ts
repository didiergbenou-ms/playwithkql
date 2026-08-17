/**
 * Prop sprite maps, kept free of any Phaser import so they can be unit tested.
 *
 * IMPORTANT: none of these may end with an all-transparent row. Props are
 * drawn with origin (0.5, 1) — the bottom of the canvas is placed on the floor
 * — so a blank bottom row lifts the art and the prop appears to hover.
 * There is a test that enforces this.
 */

/**
 * Terminal art, 16 x 19. 'A' is the accent colour placeholder so the same
 * artwork serves the locked (amber) and solved (lime) variants.
 *
 * Written out literally rather than assembled from template fragments — the
 * previous concatenated version silently produced 17-wide rows among 16-wide
 * ones, giving the sprite a ragged edge.
 */
const TERMINAL_TEMPLATE = [
  '.AAAAAAAAAAAAAA.',
  'AkkkkkkkkkkkkkkA',
  'AkAAAAAAkkkkkkkA',
  'AkkkkkkkkkkkkkkA',
  'AkAAAAAAAAAkkkkA',
  'AkkkkkkkkkkkkkkA',
  'AkAAAAkkkkkkkkkA',
  'AkkkkkkkkkkkkkkA',
  'AkAAAAAAAAkkkkkA',
  'AkkkkkkkkkkkkkkA',
  'AkAAAAAkkkkkkkkA',
  'AkkkkkkkkkkkkkkA',
  '.AAAAAAAAAAAAAA.',
  '...kkkkkkkkkk...',
  '...k........k...',
  '..kk........kk..',
  '..kk........kk..',
  '..kk........kk..',
  '.kkkk......kkkk.',
];

export function terminalRows(accent: string): string[] {
  return TERMINAL_TEMPLATE.map((r) => r.replace(/A/g, accent));
}

export const VERDICT_ROWS = [
  '..mmmmmmmmmmmmmmmmmmmm..',
  '.mkkkkkkkkkkkkkkkkkkkkm.',
  'mkkwwkkkkkkkkkkkkkkwwkkm',
  'mkkkkkkkkkkkkkkkkkkkkkkm',
  'mkkmmmmkkkkkkkkmmmmkkkkm',
  'mkkkkkkkkkkkkkkkkkkkkkkm',
  'mkkkkkkkmmmmmmkkkkkkkkkm',
  'mkkkkkkmmwwwwmmkkkkkkkkm',
  'mkkkkkkmwmmmmwmkkkkkkkkm',
  'mkkkkkkmwmkkmwmkkkkkkkkm',
  'mkkkkkkmwmmmmwmkkkkkkkkm',
  'mkkkkkkmmwwwwmmkkkkkkkkm',
  'mkkkkkkkmmmmmmkkkkkkkkkm',
  'mkkkkkkkkkkkkkkkkkkkkkkm',
  'mkkmmmmkkkkkkkkmmmmkkkkm',
  'mkkkkkkkkkkkkkkkkkkkkkkm',
  'mkkwwkkkkkkkkkkkkkkwwkkm',
  '.mkkkkkkkkkkkkkkkkkkkkm.',
  '..mmmmmmmmmmmmmmmmmmmm..',
  '....kkkk........kkkk....',
  '....kkkk........kkkk....',
  '...kkkkkk......kkkkkk...',
];

export const NOTE_ROWS = [
  'kkkkkkkkkk',
  'kwwwwwwwwk',
  'kwkkkkwwwk',
  'kwwwwwwwwk',
  'kwkkkkkwwk',
  'kwwwwwwwwk',
  'kwkkkkwwwk',
  'kwwwwwwwwk',
  'kwkkkwwwwk',
  'kwwwwwwwwk',
  'kaaaaaaaak',
  'kkkkkkkkkk',
];

/** Every prop whose bottom row must not be transparent. */
export const FLOOR_PROPS: { name: string; rows: string[] }[] = [
  { name: 'terminal_locked', rows: terminalRows('a') },
  { name: 'terminal_solved', rows: terminalRows('l') },
  { name: 'verdict', rows: VERDICT_ROWS },
  { name: 'note', rows: NOTE_ROWS },
];
