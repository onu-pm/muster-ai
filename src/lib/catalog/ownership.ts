/**
 * Which duty types belong to whom.
 *
 * Kept here rather than inside the standup because the Home strip needs the
 * same answer. It did not have it, and showed the single most recent duty in
 * the organisation on every teammate's card — so Holly, Hansel, Mira and Dev
 * all reported "Working on checking files for what is missing", which was
 * Mira's records audit wearing everybody's name.
 */
export const DUTY_OWNER: Record<string, string> = {
  payroll_input_pack: 'holly',
  salary_structure_review: 'holly',
  tax_declaration_review: 'holly',
  rules_setup: 'holly',
  hiring_screen: 'hansel',
  hiring_offer: 'hansel',
  hiring_onboard: 'hansel',
  records_audit: 'mira',
  benefit_enrolment: 'dev',
  benefits_review: 'dev',
  review_cycle: 'sana',
  performance_review: 'sana',
  exit: 'noor',
  final_settlement: 'noor',
};

/**
 * Payroll is the fallback for a duty type nobody has claimed yet, because it is
 * where this product started and where an unlabelled duty most likely came
 * from. It is a guess, so it is only ever used for attribution, never for work.
 */
export function ownerOf(dutyType: string | null | undefined): string {
  return dutyType ? (DUTY_OWNER[dutyType] ?? 'holly') : 'holly';
}
