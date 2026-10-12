/**
 * Single gate between database values and anything a person reads.
 *
 * Every lookup falls back to `humanise`, so an enum value nobody has written
 * copy for yet still renders as words rather than as a raw key. Call these —
 * never interpolate a column value into the UI directly.
 *
 * The maps below cover the values actually present in this project's schema.
 */

/** Last-resort: turn `lop_discrepancy` into `Lop discrepancy` rather than leaking the key. */
export function humanise(value: string | null | undefined): string {
  if (!value) return 'Not set';
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function lookup(
  map: Record<string, string>,
  value: string | null | undefined,
): string {
  if (!value) return 'Not set';
  return map[value] ?? humanise(value);
}

/* ---------- Exceptions: the things that land on Catchup ---------- */

export const EXCEPTION_KIND_LABELS: Record<string, string> = {
  lop_discrepancy: 'Attendance and leave records disagree',
  wage_definition_breach: 'Basic pay is below half of total wages',
  declaration_proof_ineligible: 'A claimed proof does not qualify',
  declaration_proof_unverified: 'A proof could not be verified',
  proposed_rule: 'A new rule is waiting for your approval',
  missing_attendance: 'No attendance record for the month',
  missing_proof: 'Investment proof not submitted',
  proof_over_cap: 'Declared amount is above the legal limit',
  structure_missing: 'No salary structure on record',
  record_incomplete: 'A file is missing something before they can be paid',
  benefit_enrolment_proposed: 'An addition to the group cover is waiting for you',
  benefit_removal_proposed: 'Someone would come off the group cover',
  review_cycle_proposed: 'A review cycle is waiting for you to start it',
  review_overdue: 'A review has slipped past its window',
  review_outcome_recorded: 'A review outcome is waiting for you to confirm',
  settlement_proposed: 'A final settlement is waiting for your approval',
  exit_blocked: 'An exit cannot be settled yet',
};

export function exceptionKindLabel(
  kind: string | null | undefined,
  kindLabel?: string | null,
): string {
  // 0007 adds `kind_label`; prefer the stored human string when it is there.
  if (kindLabel && kindLabel.trim()) return kindLabel.trim();
  return lookup(EXCEPTION_KIND_LABELS, kind);
}

/**
 * The rule behind each finding, in one line — what the Catchup card shows under
 * "the rule applied". Payload may override this with a more specific sentence.
 */
export const EXCEPTION_RULE_LINES: Record<string, string> = {
  lop_discrepancy:
    'Loss of pay is only applied when attendance and the leave ledger agree.',
  wage_definition_breach:
    'Basic and dearness allowance together must be at least 50% of total wages.',
  declaration_proof_ineligible:
    'A proof only counts if it falls inside the category it was claimed under.',
  declaration_proof_unverified:
    'A proof counts once the document supports the amount declared.',
  proposed_rule: 'A rule takes effect only once you confirm it.',
  proof_over_cap:
    'Each investment category is capped at the statutory limit for the year.',
  record_incomplete:
    'Nobody is included in a run until there is somewhere to send the money.',
  benefit_enrolment_proposed:
    'Nobody is added to a policy, and no premium is started, without someone approving it.',
  benefit_removal_proposed:
    'Cover is never ended automatically. A claim refused after an exit is worse than a month of extra premium.',
  review_overdue:
    'A review is due a set number of months after the last one, within a fixed window.',
  settlement_proposed:
    'A final settlement is the last payment an employer makes, so it is always approved by a person before it goes out.',
};

export function exceptionRuleLine(
  kind: string | null | undefined,
  fromPayload?: string | null,
): string | null {
  if (fromPayload && fromPayload.trim()) return fromPayload.trim();
  if (!kind) return null;
  return EXCEPTION_RULE_LINES[kind] ?? null;
}

export const EXCEPTION_STATUS_LABELS: Record<string, string> = {
  open: 'Waiting on you',
  resolved: 'Resolved',
};

export const exceptionStatusLabel = (v?: string | null) =>
  lookup(EXCEPTION_STATUS_LABELS, v);

/* ---------- Work in flight ---------- */

export const DUTY_TYPE_LABELS: Record<string, string> = {
  payroll_input_pack: 'Attendance and leave for the month',
  salary_structure_review: 'Salary structure review',
  tax_declaration_review: 'Tax declaration review',
  rules_setup: 'Setting up a rule',
  hiring_screen: 'Reading an application',
  hiring_offer: 'Drawing up an offer',
  hiring_onboard: 'Getting a joiner onto the books',
  records_audit: 'Checking files for what is missing',
  benefit_enrolment: 'Adding someone to the group cover',
  benefits_review: 'Reviewing who is covered',
  review_cycle: 'A performance review cycle',
  performance_review: 'One person\u2019s review',
  exit: 'Working through an exit',
  final_settlement: 'Working out a final settlement',
};

export const dutyTypeLabel = (v?: string | null) =>
  lookup(DUTY_TYPE_LABELS, v);

export const DUTY_STATE_LABELS: Record<string, string> = {
  open: 'Not started',
  in_progress: 'Working on it',
  blocked: 'Stuck, needs you',
  closed: 'Done',
};

export const dutyStateLabel = (v?: string | null) =>
  lookup(DUTY_STATE_LABELS, v);

export const CAPABILITY_LABELS: Record<string, string> = {
  reconcile: 'Matched records against each other',
  explain: 'Worked out why the numbers differ',
  execute: 'Calculated the figures',
  verify: 'Checked a document against what was declared',
  audit_records: 'Checked files for what is missing',
  enrol: 'Drew up group cover',
  review_cover: 'Reviewed who is covered',
  open_cycle: 'Opened a review cycle',
  record_review: 'Recorded a review outcome',
  begin_exit: 'Started an exit',
  settle: 'Worked out a final settlement',
};

export const capabilityLabel = (v?: string | null) =>
  lookup(CAPABILITY_LABELS, v);

/* ---------- Decisions ---------- */

export const DECISION_LABELS: Record<string, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  corrected: 'Corrected',
};

export const decisionLabel = (v?: string | null) => lookup(DECISION_LABELS, v);

/* ---------- Rules ---------- */

export const RULE_LABELS: Record<string, string> = {
  wage_definition: 'What counts as wages',
  proof_category_cap: 'Limits on investment proofs',
  pt_slab: 'Professional tax slabs',
  ctc_breakup: 'How a salary is split',
  lop_calculation: 'How loss of pay is worked out',
  leave_policy: 'Leave entitlement and encashment',
  notice_policy: 'Notice periods and recovery',
  benefits_policy: 'Group cover and premiums',
  review_policy: 'How review cycles run',
};

export const RULE_DESCRIPTIONS: Record<string, string> = {
  wage_definition:
    'Which pay components count as wages when testing the basic-pay split.',
  proof_category_cap:
    'The most that can be claimed under each investment category.',
  pt_slab: 'Professional tax due at each salary band, by state.',
  ctc_breakup: 'The percentages a new salary is broken into.',
  lop_calculation: 'The divisor used to turn a day of absence into an amount.',
  leave_policy:
    'Days earned a year, how many carry forward, and how many can be paid out.',
  notice_policy:
    'How much notice is required and what is recovered when it is not served.',
  benefits_policy:
    'What group cover you offer, for how much, and who pays the premium.',
  review_policy: 'How often reviews run and how long after probation they start.',
};

export function ruleLabel(
  ruleKey: string | null | undefined,
  storedLabel?: string | null,
): string {
  if (storedLabel && storedLabel.trim()) return storedLabel.trim();
  if (ruleKey) return lookup(RULE_LABELS, ruleKey);
  return 'A rule you confirmed';
}

export function ruleDescription(
  ruleKey: string | null | undefined,
  fallback?: string | null,
): string {
  if (ruleKey && RULE_DESCRIPTIONS[ruleKey]) return RULE_DESCRIPTIONS[ruleKey];
  if (fallback && fallback.trim()) return fallback.trim();
  return 'No description written for this one yet.';
}

export const RULE_SCOPE_LABELS: Record<string, string> = {
  statutory: 'Required by law',
  policy: 'Your own policy',
};

export const ruleScopeLabel = (v?: string | null) =>
  lookup(RULE_SCOPE_LABELS, v);

/** `rules` has no status column — it has a `confirmed` boolean. */
export const ruleConfirmedLabel = (confirmed: boolean) =>
  confirmed ? 'In use' : 'Waiting for your approval';

export const JURISDICTION_LABELS: Record<string, string> = {
  'IN-national': 'All of India',
  'IN-KA': 'Karnataka',
  'IN-MH': 'Maharashtra',
  'IN-TN': 'Tamil Nadu',
  'IN-DL': 'Delhi',
  'IN-TG': 'Telangana',
  'IN-WB': 'West Bengal',
  'IN-GJ': 'Gujarat',
  'IN-HR': 'Haryana',
  'IN-UP': 'Uttar Pradesh',
  'IN-KL': 'Kerala',
};

export const jurisdictionLabel = (v?: string | null) =>
  lookup(JURISDICTION_LABELS, v);

/* ---------- People ---------- */

export const PERSON_TYPE_LABELS: Record<string, string> = {
  candidate: 'Candidate',
  employee: 'Employee',
  ex_employee: 'Left the company',
};

export const personTypeLabel = (v?: string | null) =>
  lookup(PERSON_TYPE_LABELS, v);

export const TAX_REGIME_LABELS: Record<string, string> = {
  old: 'Old tax regime',
  new: 'New tax regime',
};

export const taxRegimeLabel = (v?: string | null) =>
  lookup(TAX_REGIME_LABELS, v);

export const ROLE_LABELS: Record<string, string> = {
  hr_admin: 'HR admin',
  owner: 'Owner',
  member: 'Member',
  viewer: 'Can view only',
};

export const roleLabel = (v?: string | null) => lookup(ROLE_LABELS, v);

/* ---------- Documents and checks ---------- */

export const ARTIFACT_TYPE_LABELS: Record<string, string> = {
  lic_ppf_elss: 'Life insurance, PPF or ELSS proof',
  medical_insurance: 'Medical insurance proof',
  rent_receipts: 'Rent receipts',
  home_loan_interest: 'Home loan interest certificate',
  attendance_sheet: 'Attendance sheet',
  signed_offer: 'Signed offer letter',
  pan_card: 'PAN card',
  aadhaar: 'Aadhaar',
  bank_proof: 'Bank account proof',
  cancelled_cheque: 'Cancelled cheque',
  previous_payslip: 'Payslip from a previous employer',
  relieving_letter: 'Relieving letter',
  education_certificate: 'Education certificate',
  resignation_letter: 'Resignation letter',
  experience_letter: 'Experience letter',
  cv: 'CV',
  form_11: 'Provident fund declaration (Form 11)',
  nominee_form: 'Nomination form',
  insurance_card: 'Insurance card',
};

export const artifactTypeLabel = (v?: string | null) =>
  lookup(ARTIFACT_TYPE_LABELS, v);

export const ARTIFACT_SOURCE_LABELS: Record<string, string> = {
  declaration_upload: 'Uploaded with a declaration',
  csv_import: 'From a spreadsheet you uploaded',
  remote_com: 'From Remote.com',
};

export const artifactSourceLabel = (v?: string | null) =>
  lookup(ARTIFACT_SOURCE_LABELS, v);

export const VERDICT_OUTCOME_LABELS: Record<string, string> = {
  accepted: 'Accepted',
  rejected: 'Not accepted',
  flagged: 'Needs a closer look',
};

export const verdictOutcomeLabel = (v?: string | null) =>
  lookup(VERDICT_OUTCOME_LABELS, v);

export const TAX_DECLARATION_STATUS_LABELS: Record<string, string> = {
  draft: 'Not submitted yet',
  submitted: 'Submitted, not yet checked',
  verified: 'Checked',
  rejected: 'Not accepted',
};

export const taxDeclarationStatusLabel = (v?: string | null) =>
  lookup(TAX_DECLARATION_STATUS_LABELS, v);

/* ---------- Money owed to the company ---------- */

export const LOAN_KIND_LABELS: Record<string, string> = {
  loan: 'Loan',
  advance: 'Salary advance',
};

export const loanKindLabel = (v?: string | null) => lookup(LOAN_KIND_LABELS, v);

export const LOAN_STATUS_LABELS: Record<string, string> = {
  active: 'Being repaid',
  closed: 'Fully repaid',
};

export const loanStatusLabel = (v?: string | null) =>
  lookup(LOAN_STATUS_LABELS, v);

/* ---------- Connections ---------- */

export const CONNECTION_STATUS_LABELS: Record<string, string> = {
  connected: 'Connected',
  not_connected: 'Not connected',
};

export const connectionStatusLabel = (v?: string | null) =>
  lookup(CONNECTION_STATUS_LABELS, v);

/* ---------- Facts ---------- */

export const FACT_SOURCE_LABELS: Record<string, string> = {
  human_correction: 'You corrected this',
  approval: 'You approved this',
  rule: 'From a rule you confirmed',
  import: 'From imported data',
  connector: 'From a connected source',
};

export const factSourceLabel = (v?: string | null) =>
  lookup(FACT_SOURCE_LABELS, v);

/* ---------- Confidence: never a bare percentage ---------- */

export function confidenceLabel(confidence: number | null | undefined): string {
  if (confidence === null || confidence === undefined) return 'Not sure';
  const pct = confidence > 1 ? confidence : confidence * 100;
  if (pct >= 90) return 'Very confident';
  if (pct >= 75) return 'Fairly confident';
  if (pct >= 50) return 'Worth a second look';
  return 'Not confident';
}

/* ---------- Money and dates, written the Indian way ---------- */

export function formatMoney(
  amount: number | string | null | undefined,
): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

export function formatDateTime(
  value: string | Date | null | undefined,
): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

export function relativeDay(value: string | Date | null | undefined): string {
  if (!value) return 'No date set';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return 'No date set';
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days <= 7) return `In ${days} days`;
  if (days < -1 && days >= -7) return `${Math.abs(days)} days ago`;
  return formatDate(d);
}

/** "3 things need you." — the Catchup header line. */
export function countLine(n: number): string {
  if (n === 0) return 'Nothing needs you right now.';
  if (n === 1) return '1 thing needs you.';
  return `${n} things need you.`;
}

export function pluralise(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/* ---------- Group cover ---------- */

export const COVER_KIND_LABELS: Record<string, string> = {
  group_medical: 'Group medical cover',
  group_accident: 'Group personal accident cover',
  group_term_life: 'Group term life cover',
};

export const coverKindLabel = (v?: string | null) =>
  lookup(COVER_KIND_LABELS, v);

/* ---------- Reviews ---------- */

export const REVIEW_OUTCOME_LABELS: Record<string, string> = {
  exceeded: 'Exceeded what the role asked for',
  met: 'Met what the role asked for',
  developing: 'Developing into the role',
  below: 'Below what the role asked for',
};

export const reviewOutcomeLabel = (v?: string | null) =>
  lookup(REVIEW_OUTCOME_LABELS, v);

export const CYCLE_FREQUENCY_LABELS: Record<string, string> = {
  annual: 'Once a year',
  half_yearly: 'Twice a year',
  quarterly: 'Every quarter',
};

export const cycleFrequencyLabel = (v?: string | null) =>
  lookup(CYCLE_FREQUENCY_LABELS, v);

export const REVIEW_REASON_LABELS: Record<string, string> = {
  cycle: 'Regular review',
  confirmation: 'Confirmation after probation',
};

export const reviewReasonLabel = (v?: string | null) =>
  lookup(REVIEW_REASON_LABELS, v);

/* ---------- Exits ---------- */

export const EXIT_REASON_LABELS: Record<string, string> = {
  resignation: 'Resigned',
  termination: 'Let go',
  retirement: 'Retired',
  death: 'Died in service',
  disablement: 'Left through disablement',
};

export const exitReasonLabel = (v?: string | null) =>
  lookup(EXIT_REASON_LABELS, v);

/**
 * A settlement line, said the way it would be said out loud. A negative amount
 * is money coming back off what someone is owed, and it says so rather than
 * showing a minus sign and leaving it to be worked out.
 */
export function settlementLine(label: string, amount: number): string {
  return amount < 0
    ? `${label}: ${formatMoney(Math.abs(amount))} back`
    : `${label}: ${formatMoney(amount)}`;
}
