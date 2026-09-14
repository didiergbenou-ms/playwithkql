import { CASES } from '../data/cases';
import type { CaseDefinition } from '../data/cases/types';
import { CASE_STARTER } from './caseStarter';

// Add unregistered drafts here to preview and validate them without shipping them.
export const AUTHORING_CASES: readonly CaseDefinition[] = [...CASES, CASE_STARTER];
