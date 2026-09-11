import { ROOM_TRACKS } from '../../game/music';
import { HEARTBEAT_HILLS } from '../../game/levels/heartbeatHills';
import {
  CASE_NOW,
  CAUSAL_CHAIN,
  CHALLENGES,
  CUSTOMER_EMAIL,
  EVIDENCE,
  MACHINES,
  ROOT_CAUSES,
  TABLE_META,
  buildDatabase,
} from '../case001';
import type { CaseDefinition } from './types';
import {
  buildCaseSkills,
  cloneChallenges,
  cloneDatabase,
  cloneEvidence,
  cloneLevel,
  cloneRootCauses,
  cloneTableMeta,
} from './placeholder';

export const CASE001: CaseDefinition = {
  id: '001',
  title: 'Heartbeat Hills',
  customer: 'Contoso',
  summary: 'Five production machines stopped sending heartbeats at 09:15Z. The machines are up.',
  placeholder: false,
  placeholderNotice: null,
  now: new Date(CASE_NOW.getTime()),
  database: () => cloneDatabase(buildDatabase()),
  tableMeta: cloneTableMeta(TABLE_META),
  challenges: cloneChallenges(CHALLENGES),
  evidence: cloneEvidence(EVIDENCE),
  rootCauses: cloneRootCauses(ROOT_CAUSES),
  causalChain: [...CAUSAL_CHAIN],
  email: { ...CUSTOMER_EMAIL },
  fleetSize: MACHINES.length,
  skills: buildCaseSkills(CHALLENGES),
  debrief: {
    title: 'Proxy misconfiguration',
    body:
      'The five machines never stopped running. At 09:02Z an agent proxy setting was pushed to rg-contoso-prod, pointing every agent at http://proxy-emea-01.contoso.local:8080 with a bypass list that covered *.contoso.local and nothing else. No Azure Monitor endpoint was exempt, so TLS died at the proxy and the agents went silent at 09:15Z while still logging the failure locally.',
    followUp:
      'The change was made by priya.nayar@contoso.com. Proving that from the activity log needs parse_json to read the change payload — that is later-case material, not part of this first case.',
  },
  level: cloneLevel(HEARTBEAT_HILLS),
  musicTracks: [...ROOM_TRACKS],
};
