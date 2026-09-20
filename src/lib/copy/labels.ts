/**
 * Single gate between database values and anything a person reads.
 *
 * Every lookup falls back to `humanise`, so an enum value nobody has written
 * copy for yet still renders as words rather than as a raw key. Call these —
 * never interpolate a column value into the UI directly.
 */

/** Last-resort: turn `lop_discrepancy` into `Lop discrepancy` rather than leaking the key. */
export function humanise(value: string | null | undefined): string {
  if (!value) return 'Not set';
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function lookup<T extends string>(
  map: Record<string, string>,
  value: T | null | undefined,
): string {
  if (!value) return 'Not set';
  return map[value] ?? humanise(value);
}

/* ---------- Exceptions: the things that land on Catchup ---------- */

export const EXCEPTION_KIND_LABELS: Record<string, string> = {
  lop_discrepancy: 'Attendance does not match leave records',
  missing_attendance: 'No attendance record for the month',
  unexplained_absence: 'Absence with no leave applied',
  negative_leave_balance: 'Leave taken beyond the balance available',
  wage_definition_breach: 'Basic pay falls below half of total wages',
  missing_proof: 'Investment proof not submitted',
  proof_mismatch: 'Proof does not match what was declared',
  proof_over_cap: 'Declared amount is above the legal limit',
  structure_missing: 'No salary structure on record',
  rule_proposed: 'A new rule is waiting for your approval',
  duplicate_person: 'The same person appears twice',
  joiner_mid_month: 'Joined part-way through the month',
  leaver_mid_month: 'Left part-way through the month',
};

export function exceptionKindLabel(
  kind: string | null | undefined,
  kindLabel?: string | null,
): string {
  // 0007 added `kind_label` — prefer the stored human string when it is there.
  if (kindLabel && kindLabel.trim()) return kindLabel.trim();
  return lookup(EXCEPTION_KIND_LABELS, kind);
}

export const EXCEPTION_STATUS_LABELS: Record<string, string> = {
  open: 'Waiting on you',
  pending: 'Waiting on you',
  approved: 'Approved',
  rejected: 'Rejected',
  corrected: 'Corrected',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
  auto_resolved: 'Resolved on its own',
};

export const exceptionStatusLabel = (v?: string | null) =>
  lookup(EXCEPTION_STATUS_LABELS, v);

/* ---------- Work in flight ---------- */

export const DUTY_STATUS_LABELS: Record<string, string> = {
  pending: 'Not started',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  running: 'Working on it',
  blocked: 'Stuck, needs you',
  awaiting_approval: 'Waiting for your approval',
  completed: 'Done',
  complete: 'Done',
  done: 'Done',
  failed: 'Did not finish',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
};

export const dutyStatusLabel = (v?: string | null) =>
  lookup(DUTY_STATUS_LABELS, v);

export const STEP_STATUS_LABELS: Record<string, string> = {
  pending: 'Not started',
  running: 'Working on it',
  in_progress: 'Working on it',
  completed: 'Done',
  complete: 'Done',
  done: 'Done',
  failed: 'Did not finish',
  blocked: 'Stuck',
  skipped: 'Skipped',
};

export const stepStatusLabel = (v?: string | null) =>
  lookup(STEP_STATUS_LABELS, v);

/* ---------- Decisions ---------- */

export const DECISION_LABELS: Record<string, string> = {
  approve: 'Approved',
  approved: 'Approved',
  reject: 'Rejected',
  rejected: 'Rejected',
  correct: 'Corrected',
  corrected: 'Corrected',
  override: 'Overridden',
};

export const decisionLabel = (v?: string | null) => lookup(DECISION_LABELS, v);

/* ---------- Rules ---------- */

export const RULE_LABELS: Record<string, string> = {
  wage_definition: 'What counts as wages',
  proof_category_cap: 'Limits on investment proofs',
  pt_slab: 'Professional tax slabs',
  lop_calculation: 'How loss of pay is worked out',
  overtime_rate: 'Overtime rate',
  gratuity_eligibility: 'Who qualifies for gratuity',
  notice_period: 'Notice period',
  leave_encashment: 'Leave encashment',
};

export const RULE_DESCRIPTIONS: Record<string, string> = {
  wage_definition:
    'Which pay components count as wages when testing the basic-pay split.',
  proof_category_cap:
    'The most that can be claimed under each investment category.',
  pt_slab: 'Professional tax due at each salary band, by state.',
  lop_calculation: 'The divisor used to turn a day of absence into an amount.',
  overtime_rate: 'The multiplier applied to hours worked beyond the norm.',
  gratuity_eligibility: 'The service length at which gratuity becomes payable.',
  notice_period: 'How much notice each side must give.',
  leave_encashment: 'How unused leave converts to money on exit.',
};

export function ruleLabel(
  ruleKey: string | null | undefined,
  storedLabel?: string | null,
): string {
  if (storedLabel && storedLabel.trim()) return storedLabel.trim();
  return lookup(RULE_LABELS, ruleKey);
}

export function ruleDescription(
  ruleKey: string | null | undefined,
  fallback?: string | null,
): string {
  if (ruleKey && RULE_DESCRIPTIONS[ruleKey]) return RULE_DESCRIPTIONS[ruleKey];
  if (fallback && fallback.trim()) return fallback.trim();
  return 'No description written for this one yet.';
}

export const RULE_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  proposed: 'Waiting for your approval',
  pending: 'Waiting for your approval',
  confirmed: 'In use',
  active: 'In use',
  rejected: 'Turned down',
  superseded: 'Replaced by a newer version',
  archived: 'No longer used',
};

export const ruleStatusLabel = (v?: string | null) =>
  lookup(RULE_STATUS_LABELS, v);

/* ---------- Connections ---------- */

export const CONNECTION_STATUS_LABELS: Record<string, string> = {
  connected: 'Connected',
  available: 'Available',
  coming_soon: 'Coming soon',
  error: 'Needs attention',
  disconnected: 'Not connected',
};

export const connectionStatusLabel = (v?: string | null) =>
  lookup(CONNECTION_STATUS_LABELS, v);

/* ---------- Facts ---------- */

export const FACT_SOURCE_LABELS: Record<string, string> = {
  human_correction: 'You corrected this',
  user_correction: 'You corrected this',
  approval: 'You approved this',
  rule: 'From a rule you confirmed',
  import: 'From imported data',
  connector: 'From a connected source',
  inference: 'Worked out from what was on file',
};

export const factSourceLabel = (v?: string | null) =>
  lookup(FACT_SOURCE_LABELS, v);

/* ---------- Confidence: never a bare percentage ---------- */

export function confidenceLabel(confidence: number | null | undefined): string {
  if (confidence === null || confidence === undefined) return 'Unsure';
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

export function formatDateTime(value: string | Date | null | undefined): string {
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
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
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
