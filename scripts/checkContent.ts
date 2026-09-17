import { AUTHORING_CASES } from '../src/authoring/catalog';
import { validateCase } from '../src/authoring/validateCase';
import { CASES, getCaseVariants } from '../src/data/cases';

let failed = false;
const ids = new Set<string>();
for (const caseDef of AUTHORING_CASES) {
  if (ids.has(caseDef.id)) {
    console.error(`FAIL authoring catalog: duplicate case id "${caseDef.id}"`);
    failed = true;
  }
  ids.add(caseDef.id);
  const variants = CASES.some(item => item.id === caseDef.id) ? getCaseVariants(caseDef.id) : [caseDef];
  for (const variant of variants) {
    const label = `${variant.id}/${variant.difficulty ?? 'draft'}: ${variant.title}`;
    const errors = validateCase(variant);
    if (errors.length) {
      failed = true;
      console.error(`FAIL ${label}`);
      errors.forEach((error) => console.error(`  ${error}`));
    } else {
      console.log(`OK ${label}`);
    }
  }
}
if (failed) process.exit(1);
