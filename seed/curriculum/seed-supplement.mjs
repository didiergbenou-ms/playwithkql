// Locally authored synthetic enrichment, not additional production telemetry.
// Only the incident row's identity/time/resource are derived from the supplied activity log.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATASETS_ROOT, writeDataset } from './lib.mjs';

const activity = JSON.parse(readFileSync(resolve(DATASETS_ROOT, 'ds-case002-vaults', 'data.json'), 'utf8')).AzureActivity;
const writes = activity.filter(row => row.OperationNameValue === 'MICROSOFT.NETWORK/NETWORKSECURITYGROUPS/SECURITYRULES/WRITE');
if (writes.length !== 1) throw new Error('Expected one planted network-rule write');
const incident = writes[0];
const affected = ['PRD-WEB-01', 'PRD-WEB-02', 'PRD-APP-01', 'PRD-APP-02', 'PRD-SQL-01'];
const rule = (name, access, port, priority) => ({ name, access, port, priority, direction: 'Outbound' });
const baseline = rule('allow-oms-outbound', 'Allow', 443, 200);
const deny = rule('deny-all-outbound', 'Deny', 443, 100);
const NetworkChanges = [
  {
    TimeGenerated: '2026-03-11T08:00:00Z', Caller: 'ops-automation@contoso.com',
    ActivityStatusValue: 'Succeeded', ResourceGroup: 'rg-prod-network', _ResourceId: incident._ResourceId,
    ChangeId: 'BASELINE-0800', Ticket: 'BASELINE', Approved: true,
    Properties: JSON.stringify({ before: baseline, after: baseline, affectedHosts: [], rollbackRecorded: false }),
    Changes: [baseline], Message: 'baseline outbound access=Allow port=443',
  },
  {
    TimeGenerated: incident.TimeGenerated, Caller: incident.Caller,
    ActivityStatusValue: incident.ActivityStatusValue, ResourceGroup: incident.ResourceGroup, _ResourceId: incident._ResourceId,
    ChangeId: 'CHG-4471', Ticket: 'CHG-4471', Approved: true,
    Properties: JSON.stringify({ before: baseline, after: deny, affectedHosts: affected, rollbackRecorded: false }),
    Changes: [baseline, deny], Message: 'changed outbound access=Deny port=443',
  },
  {
    TimeGenerated: '2026-03-11T09:30:00Z', Caller: 'ops-automation@contoso.com',
    ActivityStatusValue: 'Succeeded', ResourceGroup: 'rg-dev',
    _ResourceId: '/subscriptions/00000000-0000-0000-0000-000000000001/resourcegroups/rg-dev/providers/microsoft.network/networksecuritygroups/nsg-dev',
    ChangeId: 'CHG-4472', Ticket: 'CHG-4472', Approved: true,
    Properties: JSON.stringify({ before: baseline, after: baseline, affectedHosts: ['DEV-WEB-01'], rollbackRecorded: false }),
    Changes: [baseline], Message: 'reviewed outbound access=Allow port=443',
  },
];
const SigninLogs = [
  ['08:40:00', incident.Caller, 50074, '198.51.100.10', false],
  ['08:42:00', incident.Caller, 0, '198.51.100.10', true],
  ['09:05:00', incident.Caller, 0, '198.51.100.10', true],
  ['10:00:00', incident.Caller, 0, '198.51.100.10', true],
  ['08:00:00', 'ops-automation@contoso.com', 0, '198.51.100.20', true],
  ['09:30:00', 'ops-automation@contoso.com', 0, '198.51.100.20', true],
].map(([time, user, result, ip, mfa]) => ({
  TimeGenerated: `2026-03-11T${time}Z`, UserPrincipalName: user, ResultType: result,
  IPAddress: ip, Location: 'Corporate lab', AppDisplayName: 'Azure Portal',
  IsApprovedAdmin: true,
  DeviceDetail: { operatingSystem: 'Windows', isManaged: true },
  AuthenticationDetails: [{ method: mfa ? 'MFA' : 'Password', succeeded: mfa }],
}));
const columns = definitions => definitions.map(([name, type]) => ({ name, type }));
writeDataset({
  datasetId: 'ds-curriculum-supplement',
  tables: { NetworkChanges, SigninLogs },
  columns: {
    NetworkChanges: columns([
      ['TimeGenerated', 'datetime'], ['Caller', 'string'], ['ActivityStatusValue', 'string'],
      ['ResourceGroup', 'string'], ['_ResourceId', 'string'], ['ChangeId', 'string'],
      ['Ticket', 'string'], ['Approved', 'bool'], ['Properties', 'string'],
      ['Changes', 'dynamic'], ['Message', 'string'],
    ]),
    SigninLogs: columns([
      ['TimeGenerated', 'datetime'], ['UserPrincipalName', 'string'], ['ResultType', 'int'],
      ['IPAddress', 'string'], ['Location', 'string'], ['AppDisplayName', 'string'],
      ['IsApprovedAdmin', 'bool'], ['DeviceDetail', 'dynamic'], ['AuthenticationDetails', 'dynamic'],
    ]),
  },
});
