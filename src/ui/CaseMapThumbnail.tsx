import { memo } from 'react';
import type { CaseDefinition } from '../data/cases/types';
import { CASE_MAP_THUMBNAIL_BACKGROUND, getCaseMapThumbnailData } from './caseMapThumbnailData';

function CaseMapThumbnailInner({ caseDef }: { caseDef: CaseDefinition }) {
  const { width, height, rects } = getCaseMapThumbnailData(caseDef.level);

  return (
    <svg
      className="case-thumb"
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <rect width={width} height={height} fill={CASE_MAP_THUMBNAIL_BACKGROUND} />
      {rects.map((tile, index) => (
        <rect key={index} x={tile.x} y={tile.y} width={tile.width} height="1" fill={tile.fill} />
      ))}
    </svg>
  );
}

export const CaseMapThumbnail = memo(CaseMapThumbnailInner);
