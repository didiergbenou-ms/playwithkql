import heartbeatData from '../../../content/datasets/ds-case001-heartbeat/data.json';
import heartbeatSchema from '../../../content/datasets/ds-case001-heartbeat/schema.json';
import vaultData from '../../../content/datasets/ds-case002-vaults/data.json';
import vaultSchema from '../../../content/datasets/ds-case002-vaults/schema.json';
import perfData from '../../../content/datasets/ds-case003-canyon/data.json';
import perfSchema from '../../../content/datasets/ds-case003-canyon/schema.json';
import supplementData from '../../../content/datasets/ds-curriculum-supplement/data.json';
import supplementSchema from '../../../content/datasets/ds-curriculum-supplement/schema.json';
import type { ColumnMeta, TableMeta } from '../cases/types';
import type { Database, KValue } from '../../kql/types';

export const CURRICULUM_QUERY_TIME = '2026-03-11T12:00:00Z';
export const curriculumNow = () => new Date(CURRICULUM_QUERY_TIME);

interface DatasetSchema {
  queryTime: string;
  tables: { name: string; rowCount: number; columns: { name: string; type: string }[] }[];
}
interface Dataset {
  schema: DatasetSchema;
  data: Record<string, Record<string, unknown>[]>;
}
const datasets: Dataset[] = [
  { schema: heartbeatSchema, data: heartbeatData },
  { schema: vaultSchema, data: vaultData },
  { schema: perfSchema, data: perfData },
  { schema: supplementSchema, data: supplementData },
];
const docs: Record<string, string> = {
  Heartbeat: 'Supplied synthetic 12-machine fleet: five-minute observations, five last seen at 09:15Z.',
  Syslog: 'Supplied synthetic local log export, including a firewall outside the 12-machine heartbeat fleet.',
  AzureActivity: 'Supplied synthetic control-plane audit: one network-rule write at 09:12Z.',
  Perf: 'Supplied synthetic independent performance export; 15-minute samples continue after heartbeat loss.',
  NetworkChanges: 'Locally authored synthetic change-ticket enrichment. Incident identity derives from AzureActivity; rule payloads and baseline are authored fixtures.',
  SigninLogs: 'Locally authored synthetic admin sign-ins using documentation IPs. No account-compromise claim.',
};

function columnType(type: string): ColumnMeta['type'] {
  if (type === 'datetime' || type === 'string' || type === 'int' || type === 'real' || type === 'bool' || type === 'dynamic') return type;
  throw new Error(`Unsupported curriculum column type: ${type}`);
}

/** The repeated Heartbeat export is deduplicated, never appended to the fleet. */
export function curriculumTableMeta(): TableMeta[] {
  const tables = new Map<string, TableMeta>();
  for (const { schema } of datasets) {
    if (schema.queryTime !== CURRICULUM_QUERY_TIME) throw new Error('Curriculum clocks disagree');
    for (const table of schema.tables) {
      if (tables.has(table.name)) continue;
      tables.set(table.name, {
        name: table.name, doc: docs[table.name],
        columns: table.columns.map(column => ({
          name: column.name, type: columnType(column.type),
          doc: column.type === 'datetime' ? 'UTC timestamp relative to the fixed March 11 query clock.' : `${column.name} (${column.type}).`,
        })),
      });
    }
  }
  return [...tables.values()];
}

function value(cell: unknown, type: string): KValue {
  if (cell === null || cell === undefined) return null;
  if (type === 'datetime') {
    const date = new Date(String(cell));
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid curriculum datetime');
    return date;
  }
  if (type === 'real' || type === 'int') {
    if (typeof cell !== 'number' || !Number.isFinite(cell) || (type === 'int' && !Number.isInteger(cell))) throw new Error('Invalid curriculum number');
    return cell;
  }
  if (type === 'bool') {
    if (typeof cell !== 'boolean') throw new Error('Invalid curriculum boolean');
    return cell;
  }
  if (type === 'dynamic') return structuredClone(cell) as KValue;
  if (typeof cell !== 'string') throw new Error('Invalid curriculum string');
  return cell;
}

/** Fresh rows, dates, arrays and bags on every call; no registry imports or query execution. */
export function buildCurriculumDatabase(): Database {
  const database: Database = {};
  for (const { schema, data } of datasets) {
    if (schema.queryTime !== CURRICULUM_QUERY_TIME) throw new Error('Curriculum clocks disagree');
    for (const table of schema.tables) {
      const rows = data[table.name];
      if (!rows || rows.length !== table.rowCount) throw new Error(`Bad row count: ${table.name}`);
      if (database[table.name]) continue;
      database[table.name] = {
        name: table.name, columns: table.columns.map(column => column.name),
        rows: rows.map(row => Object.fromEntries(table.columns.map(column => [
          column.name, value(row[column.name], column.type),
        ]))),
      };
    }
  }
  return database;
}
