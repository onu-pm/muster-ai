/**
 * Reading a CV into structured fields.
 *
 * The section dictionary and the inline-field approach below are adapted from
 * perminder-klair/resume-parser (MIT), which drives extraction from a
 * dictionary of section headings and `field:` patterns rather than a model.
 * See README for attribution. Rewritten in TypeScript, with the network
 * profile-scraping dropped — Muster never fetches a candidate's public
 * profiles, which would be processing personal data nobody asked for.
 *
 * Everything here is deterministic. A model is used afterwards, and only for
 * the prose a dictionary cannot reach.
 */

export interface CvContact {
  name: string | null;
  email: string | null;
  phone: string | null;
  links: string[];
}

export interface ParsedCv {
  contact: CvContact;
  /** Section heading (lower case) to the lines under it. */
  sections: Record<string, string[]>;
  /** Years mentioned, earliest first — a crude but honest span signal. */
  years: number[];
  /** The CV says a role is ongoing, so the latest year is now, not the last one printed. */
  mentionsPresent: boolean;
  /** Lines that fell under no heading. */
  preamble: string[];
}

/** Adapted from resume-parser's `dictionary.titles` (MIT). */
export const SECTION_TITLES: Record<string, string[]> = {
  objective: ['objective', 'objectives', 'career objective'],
  summary: ['summary', 'profile', 'about', 'professional summary'],
  experience: [
    'experience',
    'work experience',
    'employment',
    'employment history',
    'professional experience',
  ],
  education: ['education', 'academics', 'qualifications'],
  skills: ['skills', 'technical skills', 'skills & expertise', 'technologies'],
  projects: ['projects', 'personal projects'],
  certification: ['certification', 'certifications', 'licences', 'licenses'],
  languages: ['languages'],
  awards: ['awards', 'honors', 'honours', 'achievements'],
  interests: ['interests', 'hobbies'],
  references: ['references', 'referees'],
};

/** Adapted from resume-parser's `dictionary.profiles` (MIT), read-only. */
const PROFILE_HOSTS = [
  'github.com',
  'linkedin.com',
  'gitlab.com',
  'stackoverflow.com',
  'behance.net',
  'dribbble.com',
  'medium.com',
];

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE =
  /(?:(?:\+|00)\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?){1,3}\d{3,5}/;
const YEAR = /\b(19|20)\d{2}\b/g;

function normaliseHeading(line: string): string | null {
  const cleaned = line
    .replace(/[:•\-–—_*]/g, ' ')
    .trim()
    .toLowerCase();

  // A heading is short. A sentence that happens to contain "experience" is not.
  if (!cleaned || cleaned.length > 40) return null;

  for (const [key, variants] of Object.entries(SECTION_TITLES)) {
    if (variants.includes(cleaned)) return key;
  }
  return null;
}

function findLinks(text: string): string[] {
  const found = new Set<string>();
  for (const host of PROFILE_HOSTS) {
    const pattern = new RegExp(
      `(?:https?://)?(?:www\\.)?${host.replace('.', '\\.')}[/\\w.-]*`,
      'gi',
    );
    for (const match of text.match(pattern) ?? []) found.add(match);
  }
  return [...found];
}

/**
 * The candidate's name: the first substantial line that is not contact detail.
 * Deliberately conservative — a wrong name is worse than none, and the person
 * reviewing can always correct it.
 */
function findName(lines: string[]): string | null {
  for (const line of lines.slice(0, 6)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 60) continue;
    if (EMAIL.test(trimmed) || /\d{4,}/.test(trimmed)) continue;
    if (normaliseHeading(trimmed)) continue;
    if (!/^[A-Za-z][A-Za-z.'\- ]+$/.test(trimmed)) continue;

    const words = trimmed.split(/\s+/);
    if (words.length >= 2 && words.length <= 5) return trimmed;
  }
  return null;
}

export function parseCv(text: string): ParsedCv {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const sections: Record<string, string[]> = {};
  const preamble: string[] = [];
  let current: string | null = null;

  for (const line of lines) {
    const heading = normaliseHeading(line);
    if (heading) {
      current = heading;
      sections[current] ??= [];
      continue;
    }
    if (current) sections[current].push(line);
    else preamble.push(line);
  }

  const years = [...new Set((text.match(YEAR) ?? []).map(Number))].sort(
    (a, b) => a - b,
  );

  return {
    mentionsPresent: /\b(present|current|till date|to date|ongoing)\b/i.test(
      text,
    ),
    contact: {
      name: findName(lines),
      email: text.match(EMAIL)?.[0] ?? null,
      phone: text.match(PHONE)?.[0]?.trim() ?? null,
      links: findLinks(text),
    },
    sections,
    years,
    preamble,
  };
}

/**
 * A rough span of experience in years, from the earliest and latest years the
 * CV mentions. Reported as a range someone can sanity-check, never used to
 * decide anything on its own.
 */
export function yearsOfExperience(parsed: ParsedCv): number | null {
  if (parsed.years.length === 0) return null;

  const thisYear = new Date().getFullYear();
  const earliest = parsed.years[0];

  // "2021 - Present" means they are still there, so the span runs to now.
  // Taking the last year printed would quietly understate their experience.
  const latest = parsed.mentionsPresent
    ? thisYear
    : Math.min(parsed.years[parsed.years.length - 1], thisYear);
  const span = latest - earliest;
  return span > 0 && span < 60 ? span : null;
}

export interface SkillMatch {
  matched: string[];
  missing: string[];
  /** matched / required, 0 when nothing was required. */
  coverage: number;
}

/**
 * Which of a role's required skills the CV actually evidences.
 *
 * Whole-word matching over the entire text, not just the skills section, since
 * plenty of people evidence a skill in their experience and never list it.
 * This produces a coverage figure a human reads — it never rejects anyone.
 */
export function matchSkills(
  text: string,
  required: string[],
): SkillMatch {
  const haystack = text.toLowerCase();
  const matched: string[] = [];
  const missing: string[] = [];

  for (const skill of required) {
    const needle = skill.trim().toLowerCase();
    if (!needle) continue;

    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^a-z0-9+#])${escaped}([^a-z0-9+#]|$)`, 'i');

    if (pattern.test(haystack)) matched.push(skill);
    else missing.push(skill);
  }

  const total = matched.length + missing.length;
  return {
    matched,
    missing,
    coverage: total === 0 ? 0 : Math.round((matched.length / total) * 100) / 100,
  };
}
