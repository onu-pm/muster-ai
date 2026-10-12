/**
 * What is worth asking, given what is actually on file.
 *
 * Deliberately not a fixed list. A chip that says "Run September payroll" when
 * nobody has a salary structure is an invitation to watch something fail, and a
 * chip offering to look at the hiring pipeline when there is no pipeline is
 * noise. Each one below is only offered when the state behind it exists, and
 * each is phrased as the person would say it — the text is what gets typed.
 *
 * Order matters: the first chips are the ones that unblock something.
 */

export interface Suggestion {
  /** The chip. Short enough to scan. */
  label: string;
  /** What is actually sent, which may be longer and more specific. */
  text: string;
}

export interface WorkspaceState {
  blockedRecords: number;
  needsYou: number;
  candidates: number;
  withoutStructure: number;
  hasConnection: boolean;
}

export function suggestionsFor(state: WorkspaceState): Suggestion[] {
  const out: Suggestion[] = [];

  if (state.blockedRecords > 0) {
    out.push({
      label: `Why can’t ${state.blockedRecords} be paid?`,
      text: 'What is missing from our records?',
    });
  }

  if (state.needsYou > 0) {
    out.push({
      label: 'What needs me?',
      text: 'What is waiting on a decision from me?',
    });
  }

  // Always useful, and never wrong: it reads rather than changes anything.
  out.push({
    label: 'Team standup',
    text: 'How is the team doing?',
  });

  if (state.withoutStructure > 0) {
    out.push({
      label: 'Who has no salary set',
      text: 'Who is on the roster?',
    });
  }

  if (state.candidates > 0) {
    out.push({
      label: 'Hiring pipeline',
      text: 'Who is in the pipeline?',
    });
  }

  out.push({ label: 'Who is covered', text: 'Who is on the group cover?' });
  out.push({ label: 'Reviews due', text: 'Whose review is due?' });

  if (!state.hasConnection) {
    out.push({
      label: 'Connect a source',
      text: 'What can I connect so you can read attendance?',
    });
  }

  // More than five is a menu, and a menu is what this product is trying not
  // to be. The prompt box takes anything; these are only a way in.
  return out.slice(0, 5);
}
