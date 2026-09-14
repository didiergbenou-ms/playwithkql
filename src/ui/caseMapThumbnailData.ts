import { ROOM_WIDTH, ROWS, type LevelDefinition } from '../game/levels/heartbeatHills';

export const CASE_MAP_THUMBNAIL_BACKGROUND = '#0d0b1a';

export interface CaseMapThumbnailRect {
  x: number;
  y: number;
  width: number;
  fill: string;
}

export interface CaseMapThumbnailData {
  width: number;
  height: number;
  rects: readonly CaseMapThumbnailRect[];
}

const thumbnailCache = new WeakMap<LevelDefinition, CaseMapThumbnailData>();

export function classifyCaseMapThumbnailTile(char: string): string | null {
  if (char === ' ') return null;
  if (char === '#') return '#6f6ac4';
  if (char === '=') return '#f7c948';
  if (char === '^') return '#e5404f';
  if (char === 'P' || char === '@') return '#4fe6e6';
  if (/[1-5V]/.test(char)) return '#5fd97a';
  if (/[GHJKL]/.test(char)) return '#e451c8';
  return '#45418c';
}

export function buildCaseMapThumbnailCells(level: LevelDefinition): (string | null)[][] {
  const width = level.rooms.length * ROOM_WIDTH;
  const cells: (string | null)[][] = Array.from({ length: ROWS }, () =>
    Array.from({ length: width }, (): string | null => null),
  );

  level.rooms.forEach((room, roomIndex) => {
    for (let y = 0; y < ROWS; y++) {
      const row = (room.rows[y] ?? '').padEnd(ROOM_WIDTH, ' ');
      for (let x = 0; x < ROOM_WIDTH; x++) {
        cells[y][roomIndex * ROOM_WIDTH + x] = classifyCaseMapThumbnailTile(row[x] ?? ' ');
      }
    }
  });

  return cells;
}

export function buildCaseMapThumbnailData(level: LevelDefinition): CaseMapThumbnailData {
  const cells = buildCaseMapThumbnailCells(level);
  const rects: CaseMapThumbnailRect[] = [];

  for (let y = 0; y < cells.length; y++) {
    const row = cells[y];
    let x = 0;
    while (x < row.length) {
      const fill = row[x];
      if (!fill) {
        x++;
        continue;
      }
      let width = 1;
      while (x + width < row.length && row[x + width] === fill) width++;
      rects.push({ x, y, width, fill });
      x += width;
    }
  }

  return {
    width: level.rooms.length * ROOM_WIDTH,
    height: ROWS,
    rects,
  };
}

export function getCaseMapThumbnailData(level: LevelDefinition): CaseMapThumbnailData {
  const cached = thumbnailCache.get(level);
  if (cached) return cached;
  const built = buildCaseMapThumbnailData(level);
  thumbnailCache.set(level, built);
  return built;
}
