import { SIGNAL_HARBOR } from '../../game/levels/signalHarbor';
import { createPlaceholderCase } from './placeholder';

export const CASE002 = createPlaceholderCase({
  id: '002',
  title: 'Signal Harbor',
  customer: 'Prototype Training Range',
  summary:
    'Explore crane walkways and beacon locks. Reuses the Case 001 training tasks.',
  placeholderNotice:
    'Prototype scaffold: Signal Harbor currently reuses the Case 001 Heartbeat Hills tasks, evidence, and database while harbor-specific incident content is still being authored.',
  level: SIGNAL_HARBOR,
  emailSubject: 'Prototype drill — Signal Harbor scaffold using reused Case 001 corpus',
  emailBody: `This is a playable prototype of Signal Harbor, not a new customer escalation yet.

The geometry, checkpoints, gates, and room names are new. The five terminal lessons, query answers, evidence chain, and backing data intentionally reuse the Case 001 Heartbeat Hills outage corpus until the harbor-specific scenario is written.

Use this build to validate pacing, readability, and reachability rather than narrative accuracy.`,
  debriefTitle: 'Proxy misconfiguration (reused training corpus)',
  debriefBody:
    'Signal Harbor currently closes on the same proxy misconfiguration as Heartbeat Hills because this scaffold intentionally reuses the existing training corpus. The new value here is the harbor layout: different routes, different room pacing, and the same beginner-friendly KQL drills in a fresh map.',
  debriefFollowUp:
    'Custom harbor-specific telemetry, terminal copy, and any parse_json follow-up are still pending authoring. Treat this as a movement and content scaffold, not a distinct support diagnosis.',
});
