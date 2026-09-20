import type { AttendanceRecord, LeaveDay } from '@/lib/rules/lop';

/**
 * Generic attendance CSV import.
 *
 * Column names vary between spreadsheets, so headers are matched loosely — but
 * only against a fixed list of known aliases. Nothing is inferred from a model,
 * and a column that cannot be matched is reported rather than guessed at.
 */

export interface CsvParseResult {
  attendance: AttendanceRecord[];
  leave: LeaveDay[];
  /** Header names that were not recognised. */
  unrecognisedColumns: string[];
  /** Row numbers that could not be read, 1-based including the header. */
  skippedRows: number[];
}

export class CsvFormatError extends Error {}

const COLUMN_ALIASES: Record<string, string[]> = {
  name: ['name', 'employee', 'employee name', 'full name', 'person'],
  employeeId: ['id', 'employee id', 'emp id', 'employee code', 'code'],
  daysPresent: [
    'days present',
    'present',
    'present days',
    'days worked',
    'worked days',
    'attendance',
  ],
  paidLeave: ['paid leave', 'paid leave days', 'leave', 'leave days', 'pl'],
  unpaidLeave: [
    'unpaid leave',
    'unpaid leave days',
    'lop',
    'lop days',
    'loss of pay',
    'absent',
    'absent days',
  ],
};

/** Splits a CSV line, honouring quoted fields containing commas. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ',') {
      cells.push(current.trim());
      current = '';
    } else current += char;
  }

  cells.push(current.trim());
  return cells;
}

function matchColumn(header: string): string | null {
  const normalised = header.trim().toLowerCase().replace(/[_-]+/g, ' ');
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.includes(normalised)) return field;
  }
  return null;
}

function toNumber(value: string | undefined): number {
  if (!value) return 0;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function parseAttendanceCsv(
  text: string,
  year: number,
  month: number,
  totalDaysInMonth: number,
): CsvParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new CsvFormatError(
      'That file has no rows under its header. Check the export and try again.',
    );
  }

  const headers = splitCsvLine(lines[0]);
  const mapping = headers.map(matchColumn);
  const unrecognisedColumns = headers.filter((_, i) => mapping[i] === null);

  if (!mapping.includes('name')) {
    throw new CsvFormatError(
      'No column of names found. One column should be called Name or Employee.',
    );
  }
  if (!mapping.includes('daysPresent') && !mapping.includes('unpaidLeave')) {
    throw new CsvFormatError(
      'Nothing to count. Include either a Days present column or an Unpaid leave column.',
    );
  }

  const attendance: AttendanceRecord[] = [];
  const leave: LeaveDay[] = [];
  const skippedRows: number[] = [];
  const period = `${year}-${String(month).padStart(2, '0')}`;

  for (let row = 1; row < lines.length; row++) {
    const cells = splitCsvLine(lines[row]);
    const get = (field: string) => {
      const index = mapping.indexOf(field);
      return index === -1 ? undefined : cells[index];
    };

    const name = get('name')?.trim();
    if (!name) {
      skippedRows.push(row + 1);
      continue;
    }

    const personRef = get('employeeId')?.trim() || name.toLowerCase();
    const paidLeaveDays = Math.round(toNumber(get('paidLeave')));
    const unpaidLeaveDays = Math.round(toNumber(get('unpaidLeave')));

    const presentCell = get('daysPresent');
    const daysPresent =
      presentCell !== undefined
        ? toNumber(presentCell)
        : Math.max(0, totalDaysInMonth - paidLeaveDays - unpaidLeaveDays);

    attendance.push({
      personRef,
      personName: name,
      daysPresent,
      daysInMonth: totalDaysInMonth,
    });

    // The sheet gives counts, not dates. Synthetic dates inside the period keep
    // the reconciliation's shape without inventing which day was taken.
    for (let i = 0; i < paidLeaveDays; i++) {
      leave.push({
        personRef,
        date: `${period}-00`,
        paid: true,
        kind: 'from_spreadsheet',
      });
    }
    for (let i = 0; i < unpaidLeaveDays; i++) {
      leave.push({
        personRef,
        date: `${period}-00`,
        paid: false,
        kind: 'from_spreadsheet',
      });
    }
  }

  if (attendance.length === 0) {
    throw new CsvFormatError('No readable rows found in that file.');
  }

  return { attendance, leave, unrecognisedColumns, skippedRows };
}
