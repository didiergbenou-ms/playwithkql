import { AUTHORING_CASES } from '../src/authoring/catalog';
import { validateCase } from '../src/authoring/validateCase';

let failed = false;
const ids = new Set<string>();
for (const caseDef of AUTHORING_CASES) {
  if (ids.has(caseDef.id)) {
    console.error(`FAIL authoring catalog: duplicate case id "${caseDef.id}"`);
    failed = true;
  }
  ids.add(caseDef.id);
  const errors = validateCase(caseDef);
  if (errors.length) {
    failed = true;
    console.error(`FAIL ${caseDef.id}: ${caseDef.title}`);
    errors.forEach((error) => console.error(`  ${error}`));
  } else {
    console.log(`OK ${caseDef.id}: ${caseDef.title}`);
  }
}
if (failed) process.exit(1);
