import type { ChallengeSpec } from '../../kql/challenge';
import type { Database } from '../../kql/types';
import type { LevelDefinition } from '../../game/levels/heartbeatHills';
import type { TrackId } from '../../game/music';

export interface Evidence {
  id: string;
  title: string;
  detail: string;
  /** Position in the causal chain shown on the verdict board. */
  chainIndex: number;
}

export interface RootCauseOption {
  id: string;
  label: string;
  detail: string;
  correct?: boolean;
  /** Shown when the player picks this and is wrong. */
  rebuttal?: string;
}

export interface ColumnMeta {
  name: string;
  type: 'datetime' | 'string' | 'int' | 'dynamic';
  doc: string;
}

export interface TableMeta {
  name: string;
  doc: string;
  columns: ColumnMeta[];
}

/** Everything needed to select, play, grade and debrief one case. */
export interface CaseDefinition {
  id: string;
  title: string;
  customer: string;
  summary: string;
  placeholder: boolean;
  placeholderNotice: string | null;
  now: Date;
  database: () => Database;
  tableMeta: TableMeta[];
  challenges: ChallengeSpec[];
  evidence: Evidence[];
  rootCauses: RootCauseOption[];
  causalChain: string[];
  email: { from: string; subject: string; body: string };
  fleetSize: number;
  skills: string[];
  debrief: { title: string; body: string; followUp: string };
  level: LevelDefinition;
  musicTracks: TrackId[];
}
