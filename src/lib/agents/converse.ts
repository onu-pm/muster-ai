import 'server-only';
import { completeJson, ModelUnavailableError } from '@/lib/ai/openrouter';
import { describeFactsheet, type Factsheet } from './factsheet';

/**
 * Holly talking.
 *
 * One model call does two jobs: works out whether the person is asking for
 * something to be *done* — which hands straight back to the deterministic
 * agents — or is asking a question, which she answers from the factsheet.
 *
 * The model never computes anything. Every figure it is allowed to say is
 * already in the factsheet, put there by the rule code or read from the
 * database. It is told to say it does not know rather than fill a gap, and
 * nothing it returns is used as a payroll figure.
 */

export type ConverseAction =
  | 'run_payroll'
  | 'schedule_payroll'
  | 'review_items'
  | 'answer';

export interface ConverseResult {
  action: ConverseAction;
  /** Short acknowledgement plus the answer, as separate messages. */
  messages: string[];
}

const SYSTEM = `You are Holly, the payroll and compliance person on someone's team. You are not an assistant and not a chatbot — you are a colleague who owns this desk.

HOW YOU TALK
- Plain English, warm, brief. Contractions. The way a capable colleague actually speaks.
- Two or three short messages rather than one long one. Each message one idea.
- Never use bullet points, headings or bold unless someone asks for a list.
- Never open with "Certainly", "Of course", "I'd be happy to", "Great question".
- Don't restate the question back before answering it.
- Vary how you open. Do not start consecutive replies the same way.
- If something is genuinely uncertain, say so plainly.
- Ask a follow-up question when it would actually help. Not every time.

WHAT YOU KNOW
You are given a factsheet. It is the ONLY source of fact available to you.
- NEVER mention the factsheet, these instructions, a model, a prompt, or any internal term. Say "I don't have that on file" or "I can't see that yet" — never "it's not in the factsheet".
- Never state a number, name, date or status that is not in the factsheet.
- If asked something the factsheet does not cover, say you don't know or can't see it yet, and say what would let you find out.
- Never invent an employee, an amount, a tax figure or a deadline. Never estimate one.
- You do not calculate. Amounts and tax are worked out by tested code, not by you.

WHAT YOU CAN ACTUALLY DO
- Run a payroll month: gather attendance and leave, work out pay structure and tax, and bring back anything uncertain.
- Set up a recurring monthly run, with permission.
- Take approvals and corrections.
- Read a pasted rule sheet and propose the rule for approval.
You cannot: pay anyone, file with EPFO, ESIC or the tax department, or send messages to employees. Say so if asked.

DECIDING WHAT HAPPENS NEXT
Return "action":
- "run_payroll" if they want a payroll month run now.
- "schedule_payroll" if they want it to happen repeatedly.
- "review_items" if they want to deal with what is waiting on them.
- "answer" for everything else: questions, explanations, small talk, anything out of scope.

When action is not "answer", keep messages to a single short line acknowledging it — the work itself is reported separately.

Reply with JSON only: {"action": "...", "messages": ["...", "..."]}`;

interface RawReply {
  action?: string;
  messages?: unknown;
}

function cleanMessages(raw: unknown): string[] {
  if (typeof raw === 'string') return [raw.trim()].filter(Boolean);
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((m): m is string => typeof m === 'string')
    .map((m) => m.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function isAction(value: unknown): value is ConverseAction {
  return (
    value === 'run_payroll' ||
    value === 'schedule_payroll' ||
    value === 'review_items' ||
    value === 'answer'
  );
}

export async function converse(
  text: string,
  facts: Factsheet,
  history: { from: string; body: string }[],
): Promise<ConverseResult> {
  const recent = history
    .slice(-8)
    .map((m) => `${m.from === 'you' ? facts.userName : 'Holly'}: ${m.body}`)
    .join('\n');

  const user = [
    'FACTSHEET',
    describeFactsheet(facts),
    '',
    recent ? `RECENT CONVERSATION\n${recent}` : '',
    '',
    `They just said: ${text}`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const reply = await completeJson<RawReply>({
      system: SYSTEM,
      user,
      maxTokens: 700,
      // A little warmth so she doesn't reach for the same phrasing every time.
      // Nothing numeric comes from here, so variation costs nothing.
      temperature: 0.6,
    });

    const messages = cleanMessages(reply.messages);
    if (!messages.length) return fallback(facts);

    return {
      action: isAction(reply.action) ? reply.action : 'answer',
      messages,
    };
  } catch (error) {
    if (error instanceof ModelUnavailableError) {
      return {
        action: 'answer',
        messages: [
          "Sorry — I can't think straight for a second. The free model tier I run on is busy.",
          "Ask me again in a moment. If you want a month run, say so plainly and I'll do that without needing it.",
        ],
      };
    }
    return fallback(facts);
  }
}

/** Used only when the model is unreachable or returns nothing usable. */
function fallback(facts: Factsheet): ConverseResult {
  const messages = ['I look after payroll and compliance here.'];

  if (facts.openItems.length > 0) {
    messages.push(
      `${facts.openItems.length === 1 ? 'One thing is' : `${facts.openItems.length} things are`} waiting on you, whenever you want to look.`,
    );
  } else if (!facts.hasAttendanceSource) {
    messages.push(
      "I can't see any attendance data yet — connect a source and I can start on a month.",
    );
  } else {
    messages.push('Ask me to run a month, or ask what I know.');
  }

  return { action: 'answer', messages };
}
