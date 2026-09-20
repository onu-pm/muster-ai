import 'server-only';
import { env } from '@/lib/env';
import type { AttendanceRecord, LeaveDay } from '@/lib/rules/lop';
import { daysInMonth } from '@/lib/rules/lop';

/**
 * Remote.com connector.
 *
 * Reads people and their time off. Remote records time off, not attendance, so
 * days present are derived as the month minus the leave it knows about — which
 * is exactly why the reconciliation flags anything a second source disputes
 * rather than treating this as authoritative.
 */

export interface RemoteEmployment {
  id: string;
  fullName: string;
  status: string;
  type: string;
  jobTitle: string | null;
  countryCode: string | null;
}

interface EmploymentsResponse {
  data?: {
    total_pages?: number;
    employments?: {
      id: string;
      full_name: string;
      status: string;
      type: string;
      job_title: string | null;
      country?: { alpha_2_code?: string };
    }[];
  };
}

interface TimeoffResponse {
  data?: {
    total_pages?: number;
    timeoffs?: {
      id: string;
      status: string;
      employment_id: string;
      start_date: string;
      end_date: string;
      timeoff_type: string;
      timeoff_days?: { day: string; hours?: number; minutes?: number }[];
    }[];
  };
}

/** Leave types Remote reports that do not cost the employee pay. */
const PAID_LEAVE_TYPES = new Set([
  'public_holiday',
  'paid_time_off',
  'sick_leave',
  'maternity_leave',
  'paternity_leave',
  'parental_leave',
  'bereavement_leave',
  'military_leave',
  'jury_duty',
]);

const UNPAID_LEAVE_TYPES = new Set(['unpaid_leave', 'unpaid_time_off']);

export class RemoteConnectorError extends Error {}

async function call<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${env.remoteApiBase}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new RemoteConnectorError(
      response.status === 401 || response.status === 403
        ? 'Remote refused that token. Check the connection and try again.'
        : `Remote returned ${response.status}.`,
    );
  }

  return (await response.json()) as T;
}

export async function fetchEmployments(
  token: string,
  maxPages = 6,
): Promise<RemoteEmployment[]> {
  const people: RemoteEmployment[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= Math.min(totalPages, maxPages)) {
    const body = await call<EmploymentsResponse>(
      `/v1/employments?page=${page}`,
      token,
    );
    totalPages = body.data?.total_pages ?? 1;

    for (const row of body.data?.employments ?? []) {
      // Invited and archived people are not on this month's payroll.
      if (row.status !== 'active') continue;
      people.push({
        id: row.id,
        fullName: row.full_name,
        status: row.status,
        type: row.type,
        jobTitle: row.job_title ?? null,
        countryCode: row.country?.alpha_2_code ?? null,
      });
    }
    page++;
  }

  return people;
}

export async function fetchLeaveDays(
  token: string,
  year: number,
  month: number,
  maxPages = 12,
): Promise<LeaveDay[]> {
  const days: LeaveDay[] = [];
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  let page = 1;
  let totalPages = 1;

  while (page <= Math.min(totalPages, maxPages)) {
    const body = await call<TimeoffResponse>(`/v1/timeoff?page=${page}`, token);
    totalPages = body.data?.total_pages ?? 1;

    for (const timeoff of body.data?.timeoffs ?? []) {
      // Cancelled leave was never taken.
      if (timeoff.status === 'cancelled' || timeoff.status === 'declined') {
        continue;
      }

      const paid = UNPAID_LEAVE_TYPES.has(timeoff.timeoff_type)
        ? false
        : PAID_LEAVE_TYPES.has(timeoff.timeoff_type);

      const entries = timeoff.timeoff_days?.length
        ? timeoff.timeoff_days.map((d) => d.day)
        : expandRange(timeoff.start_date, timeoff.end_date);

      for (const day of entries) {
        if (!day?.startsWith(prefix)) continue;
        days.push({
          personRef: timeoff.employment_id,
          date: day,
          paid,
          kind: timeoff.timeoff_type,
        });
      }
    }
    page++;
  }

  return days;
}

/**
 * Attendance as Remote implies it: every day of the month minus the leave it
 * holds. This is a derivation, not a measurement, and is labelled as such
 * wherever it reaches a person.
 */
export function attendanceFromLeave(
  people: RemoteEmployment[],
  leave: LeaveDay[],
  year: number,
  month: number,
): AttendanceRecord[] {
  const total = daysInMonth(year, month);
  const leaveCount = new Map<string, number>();

  for (const day of leave) {
    leaveCount.set(day.personRef, (leaveCount.get(day.personRef) ?? 0) + 1);
  }

  return people.map((person) => ({
    personRef: person.id,
    personName: person.fullName,
    daysPresent: Math.max(0, total - (leaveCount.get(person.id) ?? 0)),
    daysInMonth: total,
  }));
}

function expandRange(start: string, end: string): string[] {
  const from = new Date(start);
  const to = new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [];

  const days: string[] = [];
  for (
    let d = new Date(from);
    d <= to && days.length < 366;
    d.setDate(d.getDate() + 1)
  ) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}
