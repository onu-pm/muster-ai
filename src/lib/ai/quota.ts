/**
 * Telling a spent daily allowance apart from a busy minute.
 *
 * Kept out of the client module so it can be unit tested: getting this wrong
 * meant Holly told people to "try again in a moment" when the allowance would
 * not return until the next day.
 */
const QUOTA_EXHAUSTED = /free-models-per-day|add \d+ credits/i;

export function isQuotaMessage(message: string): boolean {
  return QUOTA_EXHAUSTED.test(message);
}
