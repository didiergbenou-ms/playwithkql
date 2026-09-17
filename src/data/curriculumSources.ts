export interface CurriculumSource { id: string; title: string; url: string }

const parts = [
  'Tools and Resources', 'Just Above Sea Level', 'Workflow', 'Search for Fun and Profit',
  'Turn Search into Workflow', 'Interface Intimacy', 'Schema Talk', 'The Where Operator',
  'The Limit/Take Operators', 'The Count Operator', 'The Summarize Operator',
  'The Render Operator', 'The Extend Operator', 'The Project Operator', 'The Distinct Operator',
  'The Order/Sort and Top Operators', 'The Let Statement', 'The Union Operator', 'The Join Operator',
  'Microsoft Sentinel Analytics Rules', 'KQL Tips, Tricks, and Tools',
];

export const CURRICULUM_SOURCES: readonly CurriculumSource[] = [
  ...parts.map((title, index) => ({
    id: `MLKQL-Part${String(index + 1).padStart(2, '0')}`,
    title: `Must Learn KQL ${index + 1}: ${title}`,
    url: 'https://github.com/rod-trent/MustLearnKQL',
  })),
  ...[1, 2, 3].map(index => ({
    id: `MLKQL-Adv-Ch${index}`, title: `Advanced KQL chapter ${index}`,
    url: 'https://github.com/rod-trent/MustLearnKQL/tree/main/Advanced_KQL',
  })),
  { id: 'MSLearn-common-operators', title: 'KQL common operators', url: 'https://learn.microsoft.com/en-us/kusto/query/tutorials/learn-common-operators' },
  { id: 'MSLearn-kql-overview', title: 'KQL overview', url: 'https://learn.microsoft.com/en-us/kusto/query/' },
  { id: 'MSLearn-aggregation-functions', title: 'KQL aggregation functions', url: 'https://learn.microsoft.com/en-us/kusto/query/tutorials/use-aggregation-functions' },
  { id: 'MSLearn-join-tables', title: 'KQL join tutorial', url: 'https://learn.microsoft.com/en-us/kusto/query/tutorials/join-data-from-multiple-tables' },
  { id: 'MSLearn-path-monitoring', title: 'Analyze monitoring data with KQL', url: 'https://learn.microsoft.com/en-us/training/paths/analyze-monitoring-data-with-kql/' },
  { id: 'MSLearn-path-adx', title: 'Data analysis in Azure Data Explorer', url: 'https://learn.microsoft.com/en-us/training/paths/data-analysis-data-explorer-kusto-query-language/' },
  { id: 'MSLearn-path-sc200', title: 'Microsoft Sentinel queries', url: 'https://learn.microsoft.com/en-us/training/paths/sc-200-utilize-kql-for-azure-sentinel/' },
  { id: 'MSLearn-geospatial', title: 'Geospatial visualizations', url: 'https://learn.microsoft.com/en-us/kusto/query/tutorials/create-geospatial-visualizations' },
  { id: 'MSLearn-anomalies', title: 'KQL anomaly analysis', url: 'https://learn.microsoft.com/en-us/azure/azure-monitor/logs/kql-machine-learning-azure-monitor' },
];

export const MIT_NOTICE = `MIT License

Copyright (c) 2022 Rod Trent

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
