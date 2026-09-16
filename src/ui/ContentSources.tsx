import { CURRICULUM_SOURCES, MIT_NOTICE } from '../data/curriculumSources';

export function ContentSources({ ids }: { ids?: readonly string[] }) {
  const entries = ids ? CURRICULUM_SOURCES.filter(source => ids.includes(source.id)) : CURRICULUM_SOURCES;
  return (
    <details className="content-attribution">
      <summary>{ids ? 'Lesson sources and attribution' : 'Content credits and licenses'}</summary>
      <p>Adapted from the supplied curriculum and the references below. Lessons were rewritten and reshaped for three maps and three difficulties. All investigation data is synthetic.</p>
      <ul>{entries.map(source => <li key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li>)}</ul>
      <p>Portions are adapted from Microsoft Learn documentation, © Microsoft Corporation, licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>. Changes include rewritten explanations, condensed exercises and game-specific examples.</p>
      <details><summary>Must Learn KQL MIT license</summary><p>{MIT_NOTICE}</p></details>
    </details>
  );
}
