import { describe, expect, it } from 'vitest';
import { parseCv, matchSkills, yearsOfExperience } from './cv';
import { splitCtc, structureFromRule, DEFAULT_SHAPE } from '@/lib/rules/structure';
import { applyWageTest } from '@/lib/rules/wage-definition';
import { readMoney, readPersonName } from '@/lib/agents/parse-input';
import { matchFastPath, matchSmallTalk } from '@/lib/agents/fast-path';

const CV = `Ananya Sharma
ananya.sharma@example.com
+91 98765 43210
github.com/ananyas

SUMMARY
Backend engineer building payments systems.

EXPERIENCE
Senior Engineer, Razorpay, 2021 - Present
Engineer, Freshworks, 2018 - 2021

EDUCATION
B.Tech Computer Science, 2014 - 2018

SKILLS
TypeScript, PostgreSQL, Node.js, Kubernetes`;

describe('reading a CV', () => {
  const parsed = parseCv(CV);

  it('finds the contact details', () => {
    expect(parsed.contact.name).toBe('Ananya Sharma');
    expect(parsed.contact.email).toBe('ananya.sharma@example.com');
    expect(parsed.contact.phone).toContain('98765');
    expect(parsed.contact.links).toContain('github.com/ananyas');
  });

  it('splits it into the sections it recognises', () => {
    expect(Object.keys(parsed.sections)).toEqual(
      expect.arrayContaining(['summary', 'experience', 'education', 'skills']),
    );
    expect(parsed.sections.experience.join(' ')).toContain('Razorpay');
  });

  it('works out a rough span of experience', () => {
    expect(yearsOfExperience(parsed)).toBe(
      new Date().getFullYear() - 2014,
    );
  });

  it('does not mistake a sentence for a heading', () => {
    const tricky = parseCv(
      'Jane Doe\nI have ten years of experience in payments and education technology.\n\nSKILLS\nGo',
    );
    expect(Object.keys(tricky.sections)).toEqual(['skills']);
  });

  it('returns nothing rather than guess a name it cannot find', () => {
    expect(parseCv('SKILLS\nGo, Rust').contact.name).toBeNull();
  });
});

describe('matching a CV to what a role needs', () => {
  it('finds skills anywhere in the CV, not just the skills list', () => {
    const result = matchSkills(CV, ['TypeScript', 'Razorpay', 'Rust']);
    expect(result.matched).toEqual(['TypeScript', 'Razorpay']);
    expect(result.missing).toEqual(['Rust']);
    expect(result.coverage).toBeCloseTo(0.67, 2);
  });

  it('does not match a skill inside a longer word', () => {
    const result = matchSkills('I know Javascripting and Goa', ['Go', 'Java']);
    expect(result.matched).toEqual([]);
  });

  it('handles skills with punctuation in them', () => {
    expect(matchSkills('Strong C++ and C# background', ['C++', 'C#']).matched)
      .toEqual(['C++', 'C#']);
  });

  it('reports zero coverage rather than dividing by zero', () => {
    expect(matchSkills(CV, []).coverage).toBe(0);
  });
});

describe('splitting a package', () => {
  it('splits so the parts add back to the whole', () => {
    const structure = splitCtc(1_200_000);
    const total =
      structure.basic + structure.hra + structure.specialAllowance;
    expect(total).toBe(Math.round(1_200_000 / 12));
  });

  it('produces a split that passes the wage test by construction', () => {
    const structure = splitCtc(1_200_000);
    expect(applyWageTest(structure).passed).toBe(true);
  });

  it('honours a confirmed breakup rule', () => {
    const shape = structureFromRule({ basic_pct: 40, hra_pct: 20 });
    expect(shape.basicPct).toBe(0.4);
    expect(shape.hraPct).toBe(0.2);
  });

  it('accepts a rule written as a fraction as well as a percentage', () => {
    expect(structureFromRule({ basicPct: 0.45 }).basicPct).toBe(0.45);
  });

  it('refuses a split whose parts exceed the whole', () => {
    expect(structureFromRule({ basic_pct: 80, hra_pct: 40 })).toEqual(
      DEFAULT_SHAPE,
    );
  });

  it('returns zeros for a nonsense package rather than a wrong number', () => {
    expect(splitCtc(0)).toEqual({ basic: 0, hra: 0, specialAllowance: 0 });
    expect(splitCtc(Number.NaN).basic).toBe(0);
  });

  it('flags a low-basic rule instead of silently producing one', () => {
    const structure = splitCtc(1_200_000, structureFromRule({ basic_pct: 30 }));
    expect(applyWageTest(structure).passed).toBe(false);
  });
});

describe('reading figures and names out of what someone typed', () => {
  it('reads Indian money shorthand', () => {
    expect(readMoney('offer her 12 lakh')).toBe(1_200_000);
    expect(readMoney('18L package')).toBe(1_800_000);
    expect(readMoney('1.5 crore')).toBe(15_000_000);
    expect(readMoney('₹12,00,000 a year')).toBe(1_200_000);
  });

  it('returns nothing when no figure was given', () => {
    expect(readMoney('hire someone good')).toBeNull();
  });

  it('reads a name out of a request', () => {
    expect(readPersonName('onboard Ananya Sharma')).toBe('Ananya Sharma');
    expect(readPersonName('prepare an offer for Rahul Menon')).toBe(
      'Rahul Menon',
    );
  });

  it('returns nothing rather than inventing a name', () => {
    expect(readPersonName('run september payroll')).toBeNull();
  });
});

describe('spending the daily model allowance wisely', () => {
  it('answers small talk without a model', () => {
    expect(matchSmallTalk('hi')).toBe('greeting');
    expect(matchSmallTalk('thanks!')).toBe('thanks');
    expect(matchSmallTalk('what can you do?')).toBe('capabilities');
    expect(matchSmallTalk('bye')).toBe('goodbye');
  });

  it('does not mistake real work for small talk', () => {
    expect(matchSmallTalk('Run September payroll')).toBeNull();
    expect(matchSmallTalk('hi, can you find the salary of Rahul')).toBeNull();
    expect(matchSmallTalk('help me understand the wage test for Priya')).toBeNull();
  });

  it('routes the patterned questions straight to a capability', () => {
    expect(matchFastPath('Find the salary of Rahul')?.capability).toBe(
      'payroll.person_summary',
    );
    expect(matchFastPath('what is the attendance of August')?.capability).toBe(
      'payroll.attendance_summary',
    );
    expect(matchFastPath('who is in the pipeline?')?.capability).toBe(
      'hiring.candidate_list',
    );
    expect(matchFastPath('how many employees do we have')?.capability).toBe(
      'payroll.roster',
    );
  });

  it('leaves anything ambiguous to the planner rather than guessing', () => {
    expect(matchFastPath('run september payroll')).toBeNull();
    expect(matchFastPath('what should I be worried about?')).toBeNull();
    // "salary structure rules" is about policy, not one person's pay.
    expect(matchFastPath('what are our salary structure rules')).toBeNull();
  });
});
