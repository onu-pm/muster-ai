import 'server-only';
import {
  listFullPeople,
  matchPeople,
  type FullPerson,
} from '@/lib/data/people-records';
import {
  auditRecord,
  auditRecords,
  commonGaps,
  groupByGap,
  GROUP_THRESHOLD,
  type RecordAudit,
  type RecordField,
} from '@/lib/rules/records';
import {
  findOpenDuty,
  listArtifactsFor,
  openDuty,
  raiseException,
  recordStep,
  registerArtifact,
  setDutyState,
} from '@/lib/data/duties';
import { register } from './registry';
import { artifactTypeLabel, formatDate, pluralise } from '@/lib/copy/labels';

/**
 * Mira — records and documents.
 *
 * She is the only teammate whose job is entirely about what is *not* there. A
 * salary structure with no bank account behind it looks fine until payday; a
 * person with no PAN looks fine until a return is filed. So she reads every
 * file against the tested completeness rules and says what is missing and what
 * each gap actually stops.
 *
 * She never fills a gap in herself. A record is somebody's identity and bank
 * details — guessing at either is the one thing worse than leaving it blank.
 * She asks, and what comes back is written down as given.
 */

const MIRA = 'Mira';

/** What a gap stops, said once, so the same wording is used everywhere. */
function consequence(audit: RecordAudit): string {
  if (audit.blocking.length > 0) {
    return `can't be paid — no ${audit.blocking.map((b) => b.spoken.replace(/^(a|an|the) /, '')).join(', no ')} on file`;
  }
  return `payable, but ${pluralise(audit.missing.length, 'gap', 'gaps')} would hold up a filing`;
}


function missingPhrase(fields: RecordField[]): string {
  return `no ${fields.map((f) => f.spoken.replace(/^(a|an|the) /, '')).join(', no ')} on file`;
}

/**
 * One exception per pattern, or one per person when the pattern is small.
 * Returns how many were raised.
 */
async function raiseGaps(
  dutyId: string,
  blocked: RecordAudit[],
): Promise<number> {
  let raised = 0;

  for (const group of groupByGap(blocked)) {
    if (group.audits.length > GROUP_THRESHOLD) {
      const names = group.audits.map((a) => a.fullName);
      const id = await raiseException(dutyId, {
        kind: 'record_incomplete',
        conclusion:
          `${pluralise(group.audits.length, 'person', 'people')} can't be paid — ${missingPhrase(group.fields)} for any of them. ` +
          `${names.slice(0, 3).join(', ')} and ${names.length - 3} others. ` +
          `All of them short of exactly the same fields usually means an import that did not carry those columns.`,
        confidence: 0.98,
        payload: {
          ruleApplied:
            'Nobody is included in a run until there is somewhere to send the money.',
          affected: names,
          affectedCount: names.length,
          missing: group.fields.map((f) => ({
            field: f.label,
            because: f.because,
          })),
        },
      });
      if (id) raised += 1;
      continue;
    }

    for (const audit of group.audits) {
      const id = await raiseException(dutyId, {
        kind: 'record_incomplete',
        conclusion: `${audit.fullName} ${consequence(audit)}. ${audit.blocking[0].because}`,
        confidence: 0.98,
        payload: {
          personName: audit.fullName,
          personRef: audit.personId,
          ruleApplied:
            'Nobody is included in a run until there is somewhere to send the money.',
          missing: audit.missing.map((m) => ({
            field: m.label,
            because: m.because,
          })),
        },
      });
      if (id) raised += 1;
    }
  }

  return raised;
}

register({
  key: 'records.audit',
  teammate: MIRA,
  describe: 'check everybody’s file for what is missing',
  async run(ctx) {
    const people = await listFullPeople(ctx.orgId);
    const employees = people.filter((p) => p.type === 'employee');

    if (employees.length === 0) {
      return {
        ok: true,
        messages: [
          {
            from: MIRA,
            body: "There's nobody on the books yet, so there are no files for me to go through.",
          },
        ],
        data: { audited: 0 },
      };
    }

    const summary = auditRecords(employees);
    const messages = [];

    messages.push({
      from: MIRA,
      body:
        summary.complete === summary.audited
          ? `I've been through all ${summary.audited} files and everything I need is on them.`
          : summary.complete === 0
            ? `I've been through ${pluralise(summary.audited, 'file', 'files')} and not one of them is complete.`
            : `I've been through ${pluralise(summary.audited, 'file', 'files')}. ${summary.complete} of those are complete.`,
    });

    if (summary.blocked.length > 0) {
      /*
       * Said by pattern rather than by person. Repeating the same three gaps
       * after sixty-nine names is unreadable, and it hides the thing that
       * actually matters, which is that they are all short of the same fields.
       */
      for (const group of groupByGap(summary.blocked)) {
        const names = group.audits.map((a) => a.fullName);
        const gaps = group.fields
          .map((f) => f.spoken.replace(/^(a|an|the) /, ''))
          .join(', no ');

        messages.push({
          from: MIRA,
          body:
            names.length > GROUP_THRESHOLD
              ? `${pluralise(names.length, 'person', 'people')} can't be paid for the same reason — no ${gaps} on any of their files. ${names.slice(0, 3).join(', ')} and ${names.length - 3} others.`
              : `${names.join(', ')} can't be paid — no ${gaps} on file.`,
        });
      }
    }

    if (summary.incomplete.length > 0) {
      const gaps = commonGaps(summary.incomplete);
      messages.push({
        from: MIRA,
        body: `${pluralise(summary.incomplete.length, 'other file is', 'other files are')} payable but short of something for the statutory side — mostly ${gaps
          .slice(0, 3)
          .map((g) => `${g.spoken.replace(/^(a|an|the) /, '')} (${g.count})`)
          .join(', ')}.`,
      });
    }

    /*
     * A gap that stops somebody being paid is not a report, it is a decision:
     * either the detail gets collected or that person is left out of the run.
     * So it goes on the desk rather than into a paragraph Mira hopes is read.
     */
    let dutyId: string | null = null;

    if (summary.blocked.length > 0) {
      dutyId =
        (await findOpenDuty(ctx.orgId, 'records_audit'))?.id ??
        (await openDuty(ctx.orgId, 'records_audit'));

      if (dutyId) {
        await recordStep(
          dutyId,
          'audit_records',
          { people: employees.length },
          {
            summary: `Checked ${pluralise(summary.audited, 'file', 'files')} — ${summary.blocked.length} can't be paid yet`,
            blocked: summary.blocked.map((a) => a.fullName),
          },
        );

        const raised = await raiseGaps(dutyId, summary.blocked);

        messages.push({
          from: MIRA,
          body:
            raised === 1
              ? 'That’s one thing on your list rather than a paragraph you have to act on. Give me the missing details and I’ll write them on the files.'
              : `I’ve put ${pluralise(raised, 'item', 'items')} on your list — grouped by what is actually missing, not one per person. Give me the details and I’ll write them on the files.`,
        });
      }
    } else if (summary.incomplete.length === 0) {
      messages.push({
        from: MIRA,
        body: 'Nothing for you to do on my side.',
      });
    }

    return {
      ok: true,
      messages,
      data: {
        audited: summary.audited,
        complete: summary.complete,
        blocked: summary.blocked.length,
        incomplete: summary.incomplete.length,
        dutyInstanceId: dutyId,
      },
    };
  },
});

register({
  key: 'records.person_file',
  teammate: MIRA,
  describe: 'what is on one person’s file and what is missing',
  async run(ctx, input) {
    const name = String(input.name ?? '').trim();
    if (!name) {
      return {
        ok: false,
        error: 'No name given.',
        messages: [
          { from: MIRA, body: 'Whose file would you like me to go through?' },
        ],
      };
    }

    const people = await listFullPeople(ctx.orgId);
    const matches = matchPeople(people, name);

    if (matches.length === 0) {
      return {
        ok: false,
        error: 'Not found.',
        messages: [
          { from: MIRA, body: `I don't have a file for anyone called ${name}.` },
        ],
      };
    }

    if (matches.length > 1) {
      return {
        ok: false,
        error: 'Ambiguous.',
        messages: [
          {
            from: MIRA,
            body: `I have ${matches.length} people matching that: ${matches.map((p) => p.fullName).join(', ')}. Which one?`,
          },
        ],
      };
    }

    const person = matches[0];
    const audit = auditRecord(person);
    const documents = await listArtifactsFor([person.id]);

    const messages = [
      {
        from: MIRA,
        body:
          audit.missing.length === 0
            ? `${person.fullName}'s file is complete${person.doj ? `, joined ${formatDate(person.doj)}` : ''}.`
            : `${person.fullName}${person.doj ? `, joined ${formatDate(person.doj)}` : ''}. ${pluralise(audit.missing.length, 'thing is', 'things are')} missing.`,
      },
    ];

    if (audit.missing.length > 0) {
      for (const field of audit.missing.slice(0, 5)) {
        messages.push({
          from: MIRA,
          body: `${field.label} — ${field.because}`,
        });
      }
    }

    messages.push({
      from: MIRA,
      body:
        documents.length === 0
          ? 'No documents on the file at all yet.'
          : `${pluralise(documents.length, 'document', 'documents')} on file: ${documents
              .slice(0, 6)
              .map((d) => artifactTypeLabel(d.type).toLowerCase())
              .join(', ')}.`,
    });

    return {
      ok: true,
      messages,
      data: {
        personId: person.id,
        complete: audit.complete,
        missing: audit.missing.map((m) => m.key),
        blocking: audit.blocking.map((m) => m.key),
        documents: documents.length,
      },
    };
  },
});

register({
  key: 'records.register_document',
  teammate: MIRA,
  describe: 'put a document on someone’s file',
  async run(ctx, input) {
    const name = String(input.name ?? '').trim();
    const type = String(input.documentType ?? input.type ?? '').trim();

    if (!name || !type) {
      return {
        ok: false,
        error: 'Need a person and a document type.',
        messages: [
          {
            from: MIRA,
            body: 'Tell me whose file it goes on and what the document is, and I’ll record it.',
          },
        ],
      };
    }

    const people = await listFullPeople(ctx.orgId);
    const matches = matchPeople(people, name);

    if (matches.length !== 1) {
      return {
        ok: false,
        error: matches.length === 0 ? 'Not found.' : 'Ambiguous.',
        messages: [
          {
            from: MIRA,
            body:
              matches.length === 0
                ? `I don't have a file for ${name}.`
                : `More than one person matches ${name}. Which one?`,
          },
        ],
      };
    }

    const person = matches[0];
    const id = await registerArtifact({
      personId: person.id,
      type,
      source: 'declaration_upload',
      fileUrl: typeof input.fileUrl === 'string' ? input.fileUrl : null,
    });

    if (!id) {
      return {
        ok: false,
        error: 'Could not save it.',
        messages: [
          {
            from: MIRA,
            body: `I couldn't record that against ${person.fullName}. Try again in a moment.`,
          },
        ],
      };
    }

    return {
      ok: true,
      messages: [
        {
          from: MIRA,
          body: `Recorded ${artifactTypeLabel(type).toLowerCase()} on ${person.fullName}'s file.`,
        },
      ],
      data: { artifactId: id, personId: person.id },
    };
  },
});

register({
  key: 'records.statutory_registers',
  teammate: MIRA,
  describe: 'whether the statutory registers could be produced today',
  async run(ctx) {
    const people = await listFullPeople(ctx.orgId);
    const employees = people.filter((p) => p.type === 'employee');
    const audits = employees.map(auditRecord);

    /*
     * Each register has its own minimum. These are the fields an inspector
     * would look for, not a complete form: the point is to say whether the
     * register could be produced at all, not to produce it.
     */
    const registers = [
      {
        label: 'Register of employees under the Shops and Establishments Act',
        needs: ['doj', 'location'],
      },
      {
        label: 'Provident fund nomination and declaration (Form 11)',
        needs: ['uan', 'pan'],
      },
      {
        label: 'ESI register of employees',
        needs: ['esic_no'],
      },
      {
        label: 'Form 16 and the quarterly TDS return',
        needs: ['pan'],
      },
    ];

    const messages = [];
    const readiness: { label: string; shortBy: number }[] = [];

    for (const register of registers) {
      const short = audits.filter((audit) =>
        audit.missing.some((m) => register.needs.includes(m.key)),
      );
      readiness.push({ label: register.label, shortBy: short.length });
    }

    const ready = readiness.filter((r) => r.shortBy === 0);
    const notReady = readiness.filter((r) => r.shortBy > 0);

    messages.push({
      from: MIRA,
      body:
        notReady.length === 0
          ? `All ${registers.length} registers could be produced today for the ${pluralise(employees.length, 'person', 'people')} on the books.`
          : `${ready.length} of ${registers.length} registers could be produced today.`,
    });

    for (const register of notReady.slice(0, 4)) {
      messages.push({
        from: MIRA,
        body: `${register.label} — short of details on ${pluralise(register.shortBy, 'person', 'people')}.`,
      });
    }

    return { ok: true, messages, data: { registers: readiness } };
  },
});

/**
 * Asked by Hansel during onboarding, and by Noor at an exit. Returns the gaps
 * rather than a sentence, so the teammate asking can fold it into their own.
 */
register({
  key: 'records.check_person',
  teammate: MIRA,
  describe: 'check one file and report the gaps back to a teammate',
  async run(ctx, input) {
    const personId = String(input.personId ?? '');
    const people = await listFullPeople(ctx.orgId);
    const person = people.find((p) => p.id === personId);

    if (!person) {
      return { ok: false, error: 'Not found.', messages: [] };
    }

    const audit = auditRecord(person);

    return {
      ok: true,
      messages:
        audit.missing.length === 0
          ? [
              {
                from: MIRA,
                body: `${person.fullName}'s file is complete on my side.`,
              },
            ]
          : [
              {
                from: MIRA,
                body: `On the file I still need ${audit.missing
                  .map((m) => m.spoken)
                  .join(', ')}${audit.blocking.length > 0 ? ' — and those are the ones that stop them being paid' : ''}.`,
              },
            ],
      data: {
        complete: audit.complete,
        missing: audit.missing.map((m) => m.key),
        missingLabels: audit.missing.map((m) => m.label),
        missingSpoken: audit.missing.map((m) => m.spoken),
        blocking: audit.blocking.map((m) => m.key),
      },
    };
  },
});

/** Used by the scheduled sweep, which reports rather than converses. */
export async function sweepRecords(
  orgId: string,
  people: FullPerson[],
): Promise<{ blocked: number; raised: number }> {
  const employees = people.filter((p) => p.type === 'employee');
  const summary = auditRecords(employees);

  if (summary.blocked.length === 0) return { blocked: 0, raised: 0 };

  const dutyId =
    (await findOpenDuty(orgId, 'records_audit'))?.id ??
    (await openDuty(orgId, 'records_audit'));

  if (!dutyId) return { blocked: summary.blocked.length, raised: 0 };

  await recordStep(
    dutyId,
    'audit_records',
    { people: employees.length, scheduled: true },
    {
      summary: `Swept ${pluralise(summary.audited, 'file', 'files')} — ${summary.blocked.length} can't be paid yet`,
    },
  );

  const raised = await raiseGaps(dutyId, summary.blocked);

  if (raised === 0) await setDutyState(dutyId, 'in_progress');

  return { blocked: summary.blocked.length, raised };
}
