import { describe, expect, it } from 'vitest';
import { parseAttendanceCsv, splitCsvLine, CsvFormatError } from './csv';
import { reconcileLop } from '@/lib/rules/lop';

describe('splitting a CSV line', () => {
  it('splits on commas', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps commas inside quotes', () => {
    expect(splitCsvLine('"Rao, Priya",20')).toEqual(['Rao, Priya', '20']);
  });

  it('unescapes doubled quotes', () => {
    expect(splitCsvLine('"She said ""hi""",1')).toEqual(['She said "hi"', '1']);
  });
});

describe('reading an attendance sheet', () => {
  const header = 'Employee Name,Employee ID,Days Present,Paid Leave,Unpaid Leave';

  it('reads a straightforward sheet', () => {
    const result = parseAttendanceCsv(
      `${header}\nPriya Rao,E001,28,2,0\nArun Kumar,E002,27,1,2`,
      2026,
      9,
      30,
    );

    expect(result.attendance).toHaveLength(2);
    expect(result.attendance[0]).toMatchObject({
      personRef: 'E001',
      personName: 'Priya Rao',
      daysPresent: 28,
    });
    expect(result.leave.filter((l) => !l.paid)).toHaveLength(2);
  });

  it('accepts the column names people actually use', () => {
    const result = parseAttendanceCsv(
      'Name,Present Days,LOP Days\nPriya Rao,29,1',
      2026,
      9,
      30,
    );
    expect(result.attendance[0].daysPresent).toBe(29);
    expect(result.leave).toHaveLength(1);
    expect(result.leave[0].paid).toBe(false);
  });

  it('derives days present when the sheet only gives leave', () => {
    const result = parseAttendanceCsv(
      'Name,Paid Leave,Unpaid Leave\nPriya Rao,2,1',
      2026,
      9,
      30,
    );
    expect(result.attendance[0].daysPresent).toBe(27);
  });

  it('reports columns it did not recognise instead of ignoring them', () => {
    const result = parseAttendanceCsv(
      'Name,Days Present,Favourite Colour\nPriya Rao,30,blue',
      2026,
      9,
      30,
    );
    expect(result.unrecognisedColumns).toEqual(['Favourite Colour']);
  });

  it('skips nameless rows and says which', () => {
    const result = parseAttendanceCsv(
      'Name,Days Present\nPriya Rao,30\n,25\nArun Kumar,28',
      2026,
      9,
      30,
    );
    expect(result.attendance).toHaveLength(2);
    expect(result.skippedRows).toEqual([3]);
  });

  it('refuses a sheet with no name column', () => {
    expect(() =>
      parseAttendanceCsv('Days Present,LOP\n30,0', 2026, 9, 30),
    ).toThrow(CsvFormatError);
  });

  it('refuses a sheet with nothing to count', () => {
    expect(() => parseAttendanceCsv('Name,Department\nPriya,Eng', 2026, 9, 30)).toThrow(
      CsvFormatError,
    );
  });

  it('refuses a header with no rows', () => {
    expect(() => parseAttendanceCsv('Name,Days Present', 2026, 9, 30)).toThrow(
      CsvFormatError,
    );
  });

  it('treats junk in a numeric cell as zero rather than NaN', () => {
    const result = parseAttendanceCsv(
      'Name,Days Present,Unpaid Leave\nPriya Rao,n/a,-3',
      2026,
      9,
      30,
    );
    expect(result.attendance[0].daysPresent).toBe(0);
    expect(result.leave).toHaveLength(0);
  });

  it('feeds the reconciliation to one figure per person', () => {
    const result = parseAttendanceCsv(
      'Name,Days Present,Paid Leave,Unpaid Leave\nPriya Rao,27,2,1',
      2026,
      9,
      30,
    );
    const [line] = reconcileLop(result.attendance, result.leave);
    expect(line.lopDays).toBe(1);
    expect(line.needsReview).toBe(false);
  });
});
