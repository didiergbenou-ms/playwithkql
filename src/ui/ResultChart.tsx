import { useId, useMemo } from 'react';
import type { Table } from '../kql/types';
import { buildChartData } from './chartData';

const COLORS = ['#4fe6e6', '#f7c948', '#e451c8', '#5fd97a', '#9a97c4', '#e8862b'];

export function ResultChart({ table, kind }: { table: Table; kind: 'timechart' | 'columnchart' }) {
  const data = useMemo(() => buildChartData(table, kind), [table, kind]);
  const titleId = useId();
  const descriptionId = useId();
  if ('error' in data) return <p className="chart-notice" role="status">{data.error}</p>;
  const left = 58, right = 618, top = 25, bottom = 220;
  const spreadX = data.maxX - data.minX || 1;
  const spreadY = data.maxY - data.minY || 1;
  const x = (value: number) => left + (value - data.minX) / spreadX * (right - left);
  const y = (value: number) => bottom - (value - data.minY) / spreadY * (bottom - top);
  const barWidth = Math.max(1, Math.min(32, (right - left) / Math.max(data.categories.length, 1) / data.series.length * 0.7));
  const first = kind === 'timechart' ? new Date(data.minX).toISOString().replace('T', ' ').replace('.000Z', 'Z') : data.categories[0];
  const last = kind === 'timechart' ? new Date(data.maxX).toISOString().replace('T', ' ').replace('.000Z', 'Z') : data.categories.at(-1);
  return (
    <figure className="query-chart">
      <svg viewBox="0 0 650 285" role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
        <title id={titleId}>{`${kind === 'timechart' ? 'Time chart' : 'Column chart'}: ${data.yLabel}`}</title>
        <desc id={descriptionId}>{data.xLabel} against {data.yLabel}. {data.series.length} series. Exact values are in the result table below.</desc>
        {[0, 0.5, 1].map(fraction => {
          const value = data.minY + fraction * spreadY;
          return <g key={fraction}>
            <line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#45418c" />
            <text x={left - 8} y={y(value) + 4} textAnchor="end">{Number(value.toFixed(2))}</text>
          </g>;
        })}
        <line x1={left} x2={left} y1={top} y2={bottom} stroke="#9a97c4" />
        <text x={left} y="247" textAnchor="start">{first}</text>
        <text x={right} y="247" textAnchor="end">{last}</text>
        <text x="330" y="274" textAnchor="middle">{data.xLabel}{kind === 'timechart' ? ' (UTC)' : ''}</text>
        {data.series.map((series, index) => <g key={series.label} fill={COLORS[index % COLORS.length]}>
          {kind === 'timechart' && series.points.length > 1 && <polyline
            points={series.points.map(point => `${x(point.x)},${y(point.y)}`).join(' ')}
            fill="none" stroke={COLORS[index % COLORS.length]} strokeWidth="2" />}
          {series.points.map(point => kind === 'timechart'
            ? <circle key={point.x} cx={x(point.x)} cy={y(point.y)} r="2.5"><title>{`${series.label}: ${point.label} = ${point.y}`}</title></circle>
            : <rect key={point.x} x={x(point.x) - barWidth * data.series.length / 2 + index * barWidth}
                y={Math.min(y(point.y), y(0))} width={barWidth} height={Math.max(1, Math.abs(y(point.y) - y(0)))}>
                <title>{`${series.label}: ${point.label} = ${point.y}`}</title>
              </rect>)}
        </g>)}
      </svg>
      <figcaption>
        {data.series.map((series, index) => <span key={series.label} style={{ color: COLORS[index % COLORS.length] }}>{series.label}</span>)}
      </figcaption>
      <p className="muted">Chart from this query's rows. Lines connect observed points; missing buckets are not filled. The table below provides exact values.</p>
    </figure>
  );
}
