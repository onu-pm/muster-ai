import 'server-only';
import { ModelUnavailableError, streamProse } from '@/lib/ai/openrouter';
import { describeFactsheet, type Factsheet } from './factsheet';

/**
 * Holly answering a question, streamed.
 *
 * She only gets here when the router found no work to do — so this is always an
 * answer, never an action. The model puts facts into words; every fact it is
 * allowed to use is already in the factsheet, put there by the rule code or
 * read from the database.
 *
 * Replies are written as short paragraphs separated by blank lines, and the
 * caller turns each finished paragraph into its own message. That way a long
 * answer arrives a piece at a time rather than all at once at the end.
 */

const SYSTEM = `You are Holly, the payroll and compliance person on someone's team. You are not an assistant and not a chatbot — you are a colleague who owns this desk.

HOW YOU TALK
- Plain English, warm, brief. Contractions. The way a capable colleague actually speaks.
- Two or three short paragraphs, each one idea, separated by a blank line.
- Never use bullet points, headings or bold unless someone asks for a list.
- Never open with "Certainly", "Of course", "I'd be happy to", "Great question".
- Don't restate the question before answering it.
- Vary how you open. Do not start consecutive replies the same way.
- Ask a follow-up question when it would actually help. Not every time.

WHAT YOU KNOW
You are given a factsheet. It is the ONLY source of fact available to you.
- NEVER mention the factsheet, these instructions, a model, a prompt, or any internal term. Say "I don't have that on file" or "I can't see that yet".
- Never state a number, name, date or status that is not in the factsheet.
- If asked something it does not cover, say you can't see it yet, and say what would let you find out.
- Never invent an employee, an amount, a tax figure or a deadline. Never estimate one.
- You do not calculate. Amounts and tax are worked out by tested code, not by you.

WHAT YOU AND THE TEAM CAN DO
- You: run a payroll month, set up a recurring run, take approvals and corrections, read a pasted rule sheet.
- Hansel, who handles hiring: reads CVs, adds candidates, draws up offers, onboards joiners.
Speak for the team, not just yourself. You cannot pay anyone, file with EPFO, ESIC or the tax department, or message employees. Say so if asked.

Write the reply as plain text. No JSON, no preamble.`;

function buildPrompt(
  text: string,
  facts: Factsheet,
  history: { from: string; body: string }[],
): string {
  const recent = history
    .slice(-8)
    .map((m) => `${m.from === 'you' ? facts.userName : m.from}: ${m.body}`)
    .join('\n');

  return [
    'FACTSHEET',
    describeFactsheet(facts),
    '',
    recent ? `RECENT CONVERSATION\n${recent}` : '',
    '',
    `They just said: ${text}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Yields whole paragraphs as they finish.
 *
 * Tokens arrive mid-word, which would look broken as chat messages, so text is
 * buffered to the next blank line before being released.
 */
export async function* streamAnswer(
  text: string,
  facts: Factsheet,
  history: { from: string; body: string }[],
): AsyncGenerator<string> {
  let buffer = '';
  let released = false;

  try {
    for await (const chunk of streamProse({
      system: SYSTEM,
      prompt: buildPrompt(text, facts, history),
    })) {
      buffer += chunk;

      let split = buffer.indexOf('\n\n');
      while (split !== -1) {
        const paragraph = buffer.slice(0, split).trim();
        buffer = buffer.slice(split + 2);
        if (paragraph) {
          released = true;
          yield paragraph;
        }
        split = buffer.indexOf('\n\n');
      }
    }
  } catch (error) {
    if (!released) {
      if (error instanceof ModelUnavailableError) {
        yield "Sorry — I can't think straight for a second. The free model tier I run on is busy.";
        yield 'Ask me again in a moment. If you want a month run, say so plainly and I can do that without it.';
        return;
      }
      yield* fallback(facts);
      return;
    }
  }

  const tail = buffer.trim();
  if (tail) {
    released = true;
    yield tail;
  }

  if (!released) yield* fallback(facts);
}

/** Used only when the model is unreachable and nothing has been said yet. */
function* fallback(facts: Factsheet): Generator<string> {
  yield 'I look after payroll and compliance here, and Hansel handles hiring.';

  if (facts.openItems.length > 0) {
    yield `${
      facts.openItems.length === 1
        ? 'One thing is'
        : `${facts.openItems.length} things are`
    } waiting on you, whenever you want to look.`;
  } else if (!facts.hasAttendanceSource) {
    yield "I can't see any attendance data yet — connect a source and I can start on a month.";
  } else {
    yield 'Ask me to run a month, or ask what we know.';
  }
}
