import type { Table } from '../kql/types';
import { toDisplayString } from '../kql/evaluator';

export interface ChartPoint { x: number; y: number; label: string }
export interface ChartSeries { label: string; points: ChartPoint[] }
export type ChartData = { error: string } | {
  xLabel: string; yLabel: string; minX: number; maxX: number; minY: number; maxY: number;
  series: ChartSeries[]; categories: string[];
};

export function buildChartData(table: Table, kind: 'timechart' | 'columnchart'): ChartData {
  if (!table.rows.length) return { error: 'No rows to chart. The result table is empty.' };
  if (table.rows.length > 2000) return { error: 'Chart preview supports up to 2,000 rows. Aggregate the data first; the full query result is unchanged.' };
  const timeColumn = table.columns.find(column => table.rows.some(row => row[column] instanceof Date));
  const xColumn = kind === 'timechart' ? timeColumn : table.columns[0];
  if (!xColumn) return { error: 'A timechart needs a datetime column and numeric values.' };
  const numeric = table.columns.filter(column => column !== xColumn &&
    table.rows.some(row => typeof row[column] === 'number') &&
    table.rows.every(row => row[column] == null || (typeof row[column] === 'number' && Number.isFinite(row[column]))));
  if (!numeric.length) return { error: 'A chart needs at least one numeric value column.' };
  if (table.rows.length * numeric.length > 2000) {
    return { error: 'Chart preview supports up to 2,000 plotted values. Aggregate the data first; the full result is unchanged.' };
  }
  const groupColumns = table.columns.filter(column => column !== xColumn && !numeric.includes(column));
  const categories: string[] = [];
  const categoryIndices = new Map<string, number>();
  const grouped = new Map<string, ChartSeries>();
  for (const row of table.rows) {
    const xValue = row[xColumn];
    const label = toDisplayString(xValue ?? null);
    if (xValue == null || (kind === 'timechart' &&
      (!(xValue instanceof Date) || !Number.isFinite(xValue.getTime())))) {
      return { error: 'Some rows have missing or invalid chart coordinates. Check the result table.' };
    }
    if (!categoryIndices.has(label)) {
      categoryIndices.set(label, categories.length);
      categories.push(label);
    }
    const x = kind === 'timechart' && xValue instanceof Date ? xValue.getTime() : categoryIndices.get(label)!;
    const group = groupColumns.map(column => toDisplayString(row[column] ?? null)).join(' / ');
    for (const column of numeric) {
      const value = row[column];
      if (value == null) continue;
      if (typeof value !== 'number' || !Number.isFinite(value)) return { error: 'Non-numeric chart value.' };
      const key = JSON.stringify([column, ...groupColumns.map(name => row[name])]);
      let series = grouped.get(key);
      if (!series) {
        series = { label: group ? `${group} · ${column}` : column, points: [] };
        grouped.set(key, series);
      }
      if (series.points.some(point => point.x === x)) {
        return { error: 'Multiple values share a coordinate in one series. Aggregate them before charting.' };
      }
      series.points.push({ x, y: value, label });
    }
  }
  const series = [...grouped.values()].filter(item => item.points.length);
  if (!series.length) return { error: 'There are no non-null numeric values to chart.' };
  if (series.length > 24) return { error: 'Chart preview supports up to 24 series. Filter or aggregate the data first.' };
  for (const item of series) item.points.sort((a, b) => a.x - b.x);
  const points = series.flatMap(item => item.points);
  return {
    xLabel: xColumn, yLabel: numeric.join(', '), series, categories,
    minX: kind === 'columnchart' ? 0 : Math.min(...points.map(point => point.x)),
    maxX: kind === 'columnchart' ? categories.length - 1 : Math.max(...points.map(point => point.x)),
    minY: Math.min(0, ...points.map(point => point.y)), maxY: Math.max(0, ...points.map(point => point.y)),
  };
}
