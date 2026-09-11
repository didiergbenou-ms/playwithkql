import type { ChallengeSpec } from '../../kql/challenge';
import type { Database } from '../../kql/types';
import type { Evidence, RootCauseOption, TableMeta } from '../case001';
import type { LevelDefinition } from '../../game/levels/heartbeatHills';
import type { TrackId } from '../../game/music';

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
