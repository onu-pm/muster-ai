/**
 * Reading figures and names out of what someone typed.
 *
 * Deliberately separate from the router, and free of any server-only import,
 * so it can be unit tested. Nothing numeric in Muster originates from a model:
 * a package figure is parsed here, from the person's own words.
 */

/**
 * Pulls a money figure out of what someone typed.
 *
 * Handles "12 lakh", "1.2L", "₹12,00,000" and plain numbers. Deterministic, so
 * no package figure ever originates from a model.
 */
export function readMoney(text: string): number | null {
  const cleaned = text.replace(/,/g, '').toLowerCase();

  const lakh = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lac|lakhs|l)\b/);
  if (lakh) return Math.round(Number(lakh[1]) * 100_000);

  const crore = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:crore|cr)\b/);
  if (crore) return Math.round(Number(crore[1]) * 10_000_000);

  const plain = cleaned.match(/(?:₹|rs\.?\s*)?(\d{5,9})\b/);
  if (plain) return Number(plain[1]);

  return null;
}

/** A person's name as written after "for", "hire", "onboard" or "offer to". */
export function readPersonName(text: string): string | null {
  const patterns = [
    /\bfor\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/,
    /\b(?:hire|hiring|onboard|onboarding|offer\s+to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}
