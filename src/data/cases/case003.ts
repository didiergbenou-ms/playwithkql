import { RELAY_RUINS } from '../../game/levels/relayRuins';
import { createPlaceholderCase } from './placeholder';

export const CASE003 = createPlaceholderCase({
  id: '003',
  title: 'Relay Ruins',
  customer: 'Prototype Training Range',
  summary:
    'Climb broken relay towers and archive terraces. Reuses the Case 001 training tasks.',
  placeholderNotice:
    'Prototype scaffold: Relay Ruins currently reuses the Case 001 Heartbeat Hills tasks, evidence, and database while Relay-specific incident content is still being authored.',
  level: RELAY_RUINS,
  emailSubject: 'Prototype drill — Relay Ruins scaffold using reused Case 001 corpus',
  emailBody: `Relay Ruins is a second playable prototype map.

Its rooms, checkpoints, gates, and collectible routes are newly authored. Its terminal lessons, sample data, evidence unlocks, and root-cause diagnosis intentionally remain the same Case 001 Heartbeat Hills training material until the Relay-specific corpus is ready.

Please evaluate traversal comfort and teaching flow, not story originality.`,
  debriefTitle: 'Proxy misconfiguration (reused training corpus)',
  debriefBody:
    'Relay Ruins also resolves to the borrowed Heartbeat Hills proxy failure for now. That is intentional: this scaffold exists to exercise a different map shape and room rhythm while keeping the proven Case 001 beginner lessons intact.',
  debriefFollowUp:
    'A Relay-specific scenario will replace the copied data later. Until then, this debrief should be read as a prototype note, not as evidence that Case 002 or Case 003 already teach later-difficulty parse_json material.',
});
