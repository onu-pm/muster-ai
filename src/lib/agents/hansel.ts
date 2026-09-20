import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { completeJson, ModelUnavailableError } from '@/lib/ai/openrouter';
import { listPeople } from '@/lib/data/knowledge';
import {
  matchSkills,
  parseCv,
  yearsOfExperience,
  type ParsedCv,
} from '@/lib/hiring/cv';
import { register, type CapabilityResult } from './registry';
import { formatMoney } from '@/lib/copy/labels';

/**
 * Hansel — hiring and onboarding.
 *
 * He reads CVs, summarises candidates against a role, and turns an accepted
 * offer into a person on the books. Anything touching pay is Holly's: he asks
 * her rather than working it out himself, which is why no salary arithmetic
 * appears in this file.
 *
 * He never rejects anyone. Screening produces a summary and a coverage figure
 * for a person to read; the decision is always theirs.
 */

const HANSEL = 'Hansel';

interface CvReading {
  headline: string | null;
  current_title: string | null;
  strengths: string[];
  gaps: string[];
}

/** The prose a dictionary cannot reach. Never a score, never a decision. */
async function readCvProse(
  parsed: ParsedCv,
  roleTitle: string,
): Promise<CvReading | null> {
  const body = [
    parsed.preamble.join('\n'),
    ...Object.entries(parsed.sections).map(
      ([section, lines]) => `${section.toUpperCase()}\n${lines.join('\n')}`,
    ),
  ]
    .join('\n\n')
    .slice(0, 5000);

  try {
    return await completeJson<CvReading>({
      system: `You read a CV and summarise it for a hiring manager.

Rules:
- Describe only what the CV says. Never infer an employer, a title, a date or a qualification that is not written.
- Do not score, rank or recommend. Do not say whether to interview them.
- Do not comment on age, gender, nationality, marital status, photographs, or anything about a protected characteristic. Ignore them entirely if present.
- "gaps" means requirements of the role the CV does not evidence — nothing about the person.
- Reply with JSON only:
{"headline": one short line on what they do, "current_title": their most recent job title or null, "strengths": up to 4 short phrases, "gaps": up to 3 short phrases}`,
      user: `Role being hired for: ${roleTitle}\n\nCV:\n${body}`,
      maxTokens: 600,
      temperature: 0.2,
    });
  } catch (error) {
    if (error instanceof ModelUnavailableError) return null;
    return null;
  }
}

/* ---------------- Screening ---------------- */

register({
  key: 'hiring.screen_cv',
  teammate: HANSEL,
  describe: 'read a CV and summarise the candidate against a role',
  async run(ctx, input) {
    const text = String(input.cvText ?? '').trim();
    const roleTitle = String(input.roleTitle ?? 'this role');
    const required = Array.isArray(input.requiredSkills)
      ? (input.requiredSkills as string[])
      : [];

    if (text.length < 80) {
      return {
        ok: false,
        error: 'That is too short to be a CV.',
        messages: [
          {
            from: HANSEL,
            body: "That's a bit short for me to read as a CV. Paste the whole thing and I'll go through it.",
          },
        ],
      };
    }

    const parsed = parseCv(text);
    const skills = matchSkills(text, required);
    const span = yearsOfExperience(parsed);
    const prose = await readCvProse(parsed, roleTitle);

    const name = parsed.contact.name ?? 'This candidate';
    const messages = [
      {
        from: HANSEL,
        body:
          `${name}${prose?.current_title ? ` — ${prose.current_title}` : ''}.` +
          (span ? ` Around ${span} years of history on the CV.` : '') +
          (prose?.headline ? ` ${prose.headline}` : ''),
      },
    ];

    if (required.length > 0) {
      messages.push({
        from: HANSEL,
        body:
          skills.matched.length > 0
            ? `Evidences ${skills.matched.length} of ${required.length} things you asked for: ${skills.matched.join(', ')}.` +
              (skills.missing.length
                ? ` Nothing in the CV on ${skills.missing.join(', ')}.`
                : '')
            : `Nothing in the CV evidences ${required.join(', ')}. Worth a look anyway if the rest reads well.`,
      });
    }

    messages.push({
      from: HANSEL,
      body: parsed.contact.email
        ? `Contact is ${parsed.contact.email}. Want me to put them on the list for ${roleTitle}?`
        : `I couldn't find an email on it. Want me to put them on the list for ${roleTitle} anyway?`,
    });

    return {
      ok: true,
      messages,
      data: {
        name: parsed.contact.name,
        email: parsed.contact.email,
        phone: parsed.contact.phone,
        links: parsed.contact.links,
        yearsOfExperience: span,
        skillCoverage: skills.coverage,
        matchedSkills: skills.matched,
        missingSkills: skills.missing,
        strengths: prose?.strengths ?? [],
        gaps: prose?.gaps ?? [],
      },
    };
  },
});

/* ---------------- Adding a candidate ---------------- */

register({
  key: 'hiring.add_candidate',
  teammate: HANSEL,
  describe: 'put a candidate on the books',
  async run(ctx, input) {
    const fullName = String(input.name ?? '').trim();
    if (!fullName) {
      return {
        ok: false,
        error: 'A candidate needs a name.',
        messages: [
          {
            from: HANSEL,
            body: "I need a name before I can add them. What are they called?",
          },
        ],
      };
    }

    const existing = await listPeople(ctx.orgId);
    const already = existing.find(
      (p) => p.fullName.toLowerCase() === fullName.toLowerCase(),
    );

    if (already) {
      return {
        ok: true,
        messages: [
          {
            from: HANSEL,
            body: `${fullName} is already on the books, so I've left the record alone.`,
          },
        ],
        data: { personId: already.id, alreadyExisted: true },
      };
    }

    const { data, error } = await createAdminClient()
      .from('people')
      .insert({
        org_id: ctx.orgId,
        type: 'candidate',
        full_name: fullName,
        salary_structure: {},
      })
      .select('id')
      .single();

    if (error || !data) {
      return {
        ok: false,
        error: error?.message,
        messages: [
          {
            from: HANSEL,
            body: `I couldn't save ${fullName}: ${error?.message ?? 'something went wrong'}.`,
          },
        ],
      };
    }

    return {
      ok: true,
      messages: [
        { from: HANSEL, body: `${fullName} is on the list as a candidate.` },
      ],
      data: { personId: data.id as string, alreadyExisted: false },
    };
  },
});

/* ---------------- Preparing an offer ---------------- */

register({
  key: 'hiring.prepare_offer',
  teammate: HANSEL,
  describe: 'prepare an offer, with Holly working out the pay structure',
  async run(ctx, input) {
    const fullName = String(input.name ?? '').trim();
    const roleTitle = String(input.roleTitle ?? 'the role');
    const ctc = Number(input.annualCtc);

    if (!fullName || !Number.isFinite(ctc) || ctc <= 0) {
      return {
        ok: false,
        error: 'Need a name and an annual figure.',
        messages: [
          {
            from: HANSEL,
            body: "Tell me who it's for and the annual package, and I'll get it drawn up.",
          },
        ],
      };
    }

    const added = await ctx.invoke('hiring.add_candidate', { name: fullName });
    if (!added.ok) return added;

    const messages = [
      ...added.messages,
      {
        from: HANSEL,
        body: `Offer for ${fullName}, ${roleTitle}, at ${formatMoney(ctc)} a year. The split is Holly's call, not mine — passing it to her.`,
      },
    ];

    // Pay structure is Holly's. Hansel asks rather than inventing one.
    const structured = await ctx.invoke('payroll.draft_structure', {
      personId: added.data?.personId,
      name: fullName,
      annualCtc: ctc,
    });

    messages.push(...structured.messages);

    if (!structured.ok) {
      return { ok: false, messages, error: structured.error };
    }

    return {
      ok: true,
      messages,
      data: {
        personId: added.data?.personId,
        ...structured.data,
      },
    };
  },
});

/* ---------------- Onboarding ---------------- */

/** What has to be true before someone can actually be paid. */
export const ONBOARDING_CHECKLIST = [
  { key: 'signed_offer', label: 'Signed offer on file' },
  { key: 'pan', label: 'PAN collected' },
  { key: 'bank', label: 'Bank account and IFSC collected' },
  { key: 'uan', label: 'Provident fund number, if they have one' },
  { key: 'structure', label: 'Salary structure agreed' },
] as const;

register({
  key: 'hiring.onboard',
  teammate: HANSEL,
  describe: 'turn an accepted offer into someone on the payroll',
  async run(ctx, input) {
    const fullName = String(input.name ?? '').trim();
    const people = await listPeople(ctx.orgId);
    const person = people.find(
      (p) => p.fullName.toLowerCase() === fullName.toLowerCase(),
    );

    if (!person) {
      return {
        ok: false,
        error: 'No such person.',
        messages: [
          {
            from: HANSEL,
            body: `I don't have anyone called ${fullName} on the books yet. Want me to add them first?`,
          },
        ],
      };
    }

    const hasStructure = Object.values(person.salaryStructure).some(
      (v) => Number(v) > 0,
    );

    const outstanding = ONBOARDING_CHECKLIST.filter((item) => {
      if (item.key === 'structure') return !hasStructure;
      // The rest live on the person record, which this project does not yet
      // capture for candidates. Reported as outstanding rather than assumed.
      return true;
    });

    const messages = [
      {
        from: HANSEL,
        body: `Moving ${person.fullName} from candidate to employee.`,
      },
    ];

    const { error } = await createAdminClient()
      .from('people')
      .update({ type: 'employee', updated_at: new Date().toISOString() })
      .eq('id', person.id);

    if (error) {
      return {
        ok: false,
        error: error.message,
        messages: [
          {
            from: HANSEL,
            body: `I couldn't update their record: ${error.message}`,
          },
        ],
      };
    }

    messages.push({
      from: HANSEL,
      body:
        outstanding.length > 0
          ? `Still outstanding before they can be paid: ${outstanding.map((o) => o.label.toLowerCase()).join(', ')}.`
          : 'Everything I need is on file.',
    });

    // Getting someone onto payroll is Holly's desk, not his.
    const placed = await ctx.invoke('payroll.place_on_payroll', {
      personId: person.id,
      name: person.fullName,
    });

    messages.push(...placed.messages);

    return {
      ok: true,
      messages,
      data: { personId: person.id, outstanding: outstanding.map((o) => o.key) },
    };
  },
});
