/**
 * Mapping from Neon custom account fields to participant attributes.
 *
 * Field ids are Neon custom field ids (see GET /v2/customFields?category=Account).
 * Any non-blank value counts as "set" for a program flag.
 */

/** Dropdown field whose selected option name is copied to participant.vajrayana. */
export const VAJRAYANA_FIELD_ID = '92';

export type AppliesTo = 'new' | 'existing' | 'both';

export interface ProgramFlagRule {
  fieldId: string;
  program: string;
  flag: string;
  /**
   * Which participants the rule is applied to. Preserved from the legacy sync:
   * DRGY was only ever stamped on newly created participants and RIC 2021 only
   * on existing ones.
   */
  appliesTo: AppliesTo;
}

export const PROGRAM_FLAG_RULES: readonly ProgramFlagRule[] = [
  { fieldId: '79', program: 'drgy', flag: 'join', appliesTo: 'new' },
  { fieldId: '80', program: 'pilgrimage2020', flag: 'join', appliesTo: 'both' },
  { fieldId: '83', program: 'nextgen', flag: 'join', appliesTo: 'both' },
  { fieldId: '95', program: 'ric2021', flag: 'invite', appliesTo: 'existing' },
];

export const CUSTOM_FIELD_IDS: readonly string[] = [
  VAJRAYANA_FIELD_ID,
  ...PROGRAM_FLAG_RULES.map((rule) => rule.fieldId),
];

export function rulesFor(target: 'new' | 'existing'): ProgramFlagRule[] {
  return PROGRAM_FLAG_RULES.filter((rule) => rule.appliesTo === target || rule.appliesTo === 'both');
}
