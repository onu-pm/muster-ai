/**
 * What has to be on a person's file before they can be paid.
 *
 * Deterministic and tested. Nothing here is a judgment call: either a field is
 * on the record or it is not, and whether it is *required* follows from the
 * statutory thresholds below rather than from anyone's opinion.
 *
 * Thresholds, and where they come from:
 *  - ESI: the wage ceiling for coverage is Rs 21,000 a month (Employees' State
 *    Insurance (Central) Rules, rule 50, as amended with effect from 1 January
 *    2017). Above it, an ESIC number is not expected.
 *  - EPF: Rs 15,000 a month is the statutory wage ceiling for mandatory
 *    membership (EPF Scheme 1952, para 2(f) read with para 26). Above it
 *    membership is voluntary, so a missing UAN is reported but does not block.
 *  - PAN is needed to deduct and report tax against a person at all.
 *
 * The checklist taxonomy — grouping a joiner's file into identity, pay details
 * and statutory enrolment rather than one flat list — follows the structure
 * used by OfficeDev/microsoft-teams-apps-newemployeeonboarding (MIT), which
 * separates what the employer needs from what the new joiner must supply.
 */

export const ESI_WAGE_CEILING = 21_000;
export const EPF_WAGE_CEILING = 15_000;

export type RecordSeverity = 'blocks_pay' | 'blocks_filing' | 'worth_having';

export interface RecordField {
  key: string;
  /** Written the way it would be said to a person, never the column name. */
  label: string;
  /**
   * The same thing in the middle of a sentence. Lower-casing a label is not
   * enough: "Bank IFSC" becomes "bank ifsc", and PAN and UAN stop being
   * acronyms altogether. So the spoken form is written out rather than derived.
   */
  spoken: string;
  severity: RecordSeverity;
  /** One line on why it is needed, so a gap is never just a red mark. */
  because: string;
}

export interface PersonRecord {
  id: string;
  fullName: string;
  type: string;
  pan: string | null;
  uan: string | null;
  esicNo: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  doj: string | null;
  entityId: string | null;
  locationId: string | null;
  monthlyGross: number;
}

export interface RecordAudit {
  personId: string;
  fullName: string;
  missing: RecordField[];
  /** Missing things that stop them being paid at all. */
  blocking: RecordField[];
  complete: boolean;
}

const BANK_ACCOUNT = /^[0-9]{6,20}$/;
/** Four letters, a zero, then the branch code. Reserve Bank's IFSC format. */
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** Five letters, four digits, one letter. */
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
/** Twelve digits, issued by EPFO. */
const UAN = /^[0-9]{12}$/;

const present = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * A field that is filled in but malformed is worse than an empty one, because
 * nothing downstream will question it. Both are reported as missing.
 */
function valid(value: string | null | undefined, shape: RegExp): boolean {
  if (!present(value)) return false;
  return shape.test(value!.trim().toUpperCase());
}

export function auditRecord(person: PersonRecord): RecordAudit {
  const missing: RecordField[] = [];

  if (!valid(person.pan, PAN)) {
    missing.push({
      key: 'pan',
      label: 'PAN',
      spoken: 'a PAN',
      severity: 'blocks_filing',
      because:
        'Tax deducted against someone has to be reported under their PAN.',
    });
  }

  if (!valid(person.bankAccount, BANK_ACCOUNT)) {
    missing.push({
      key: 'bank_account',
      label: 'Bank account number',
      spoken: 'a bank account number',
      severity: 'blocks_pay',
      because: 'There is nowhere to send their salary without it.',
    });
  }

  if (!valid(person.bankIfsc, IFSC)) {
    missing.push({
      key: 'bank_ifsc',
      label: 'Bank IFSC',
      spoken: 'a bank IFSC',
      severity: 'blocks_pay',
      because: 'A transfer needs the branch code as well as the account.',
    });
  }

  if (!present(person.doj)) {
    missing.push({
      key: 'doj',
      label: 'Date they joined',
      spoken: 'the date they joined',
      severity: 'blocks_pay',
      because:
        'A part month, leave entitlement and gratuity all count from this date.',
    });
  }

  if (!person.entityId) {
    missing.push({
      key: 'entity',
      label: 'Which company employs them',
      spoken: 'which company employs them',
      severity: 'blocks_filing',
      because: 'Statutory returns are filed per company, not per group.',
    });
  }

  if (!person.locationId) {
    missing.push({
      key: 'location',
      label: 'Which location they work at',
      spoken: 'which location they work at',
      severity: 'blocks_filing',
      because:
        'Professional tax and the Shops Act rules follow the state they sit in.',
    });
  }

  // Statutory enrolment, only where the wage actually brings them in scope.
  if (person.monthlyGross > 0 && person.monthlyGross <= ESI_WAGE_CEILING) {
    if (!present(person.esicNo)) {
      missing.push({
        key: 'esic_no',
        label: 'ESIC number',
        spoken: 'an ESIC number',
        severity: 'blocks_filing',
        because: `They earn ${person.monthlyGross <= ESI_WAGE_CEILING ? 'within' : 'above'} the ESI wage ceiling, so they have to be enrolled.`,
      });
    }
  }

  if (!valid(person.uan, UAN)) {
    const mandatory =
      person.monthlyGross > 0 && person.monthlyGross <= EPF_WAGE_CEILING;
    missing.push({
      key: 'uan',
      label: 'Provident fund number (UAN)',
      spoken: 'a provident fund number',
      severity: mandatory ? 'blocks_filing' : 'worth_having',
      because: mandatory
        ? 'Provident fund membership is compulsory at their wage, so they need a UAN.'
        : 'Above the provident fund wage ceiling membership is optional, but a UAN is worth having on file.',
    });
  }

  const blocking = missing.filter((m) => m.severity === 'blocks_pay');

  return {
    personId: person.id,
    fullName: person.fullName,
    missing,
    blocking,
    complete: missing.length === 0,
  };
}

export interface AuditSummary {
  audited: number;
  complete: number;
  blocked: RecordAudit[];
  /** Incomplete but still payable — a filing problem rather than a pay problem. */
  incomplete: RecordAudit[];
}

export function auditRecords(people: PersonRecord[]): AuditSummary {
  const audits = people.map(auditRecord);

  return {
    audited: audits.length,
    complete: audits.filter((a) => a.complete).length,
    blocked: audits.filter((a) => a.blocking.length > 0),
    incomplete: audits.filter(
      (a) => a.blocking.length === 0 && a.missing.length > 0,
    ),
  };
}

/** The same gap counted across everybody, so a pattern reads as one sentence. */
export function commonGaps(
  audits: RecordAudit[],
): { label: string; spoken: string; count: number; severity: RecordSeverity }[] {
  const tally = new Map<
    string,
    { label: string; spoken: string; count: number; severity: RecordSeverity }
  >();

  for (const audit of audits) {
    for (const field of audit.missing) {
      const row = tally.get(field.key) ?? {
        label: field.label,
        spoken: field.spoken,
        count: 0,
        severity: field.severity,
      };
      row.count += 1;
      tally.set(field.key, row);
    }
  }

  return [...tally.values()].sort((a, b) => b.count - a.count);
}

/**
 * The same gap across many people is one finding, not many.
 *
 * Sixty-nine people all missing a bank account is a single thing to fix — an
 * import that did not carry those columns, usually — and raising it sixty-nine
 * times buries everything else on the desk under one problem. So blocked files
 * are grouped by exactly which fields they are short of, and a group of more
 * than a few is raised once, with every name in the payload so nothing is lost.
 */
export const GROUP_THRESHOLD = 3;

interface GapGroup {
  /** The blocking fields these people share. */
  fields: RecordField[];
  audits: RecordAudit[];
}

export function groupByGap(blocked: RecordAudit[]): GapGroup[] {
  const groups = new Map<string, GapGroup>();

  for (const audit of blocked) {
    const signature = audit.blocking
      .map((b) => b.key)
      .sort()
      .join('|');

    const group = groups.get(signature) ?? { fields: audit.blocking, audits: [] };
    group.audits.push(audit);
    groups.set(signature, group);
  }

  // Biggest pattern first: it is the one worth saying out loud.
  return [...groups.values()].sort((a, b) => b.audits.length - a.audits.length);
}

