/**
 * @mention parsing for notification fan-out.
 *
 * Pure + dependency-free (no Nest/Prisma) so it is cheap to unit test and safe
 * to import anywhere. It extracts the raw handles a comment references; turning
 * those handles into workspace-member User ids is the caller's job
 * (NotificationsService.resolveMentionedUserIds), which is what enforces the
 * "must be a member of THIS workspace" rule.
 *
 * A handle is `@` followed by either:
 *   - an email          → `@aaron@magicunicorn.tech`
 *   - a username token   → `@aaron_s` / `@aaron.s` / `@aaron-s`
 *
 * The email branch is matched FIRST (and greedily, including the domain) so a
 * username matcher can't truncate an email at the `@`. Handles are matched only
 * at a word boundary (start of string or after whitespace / common punctuation)
 * so `email@host` inside prose, or a `user@host` already consumed, is not
 * re-parsed as a bare `@host` username.
 */

// Username chars: letters, digits, dot, underscore, hyphen. Emails additionally
// allow a single `@` + a dotted domain. Kept conservative to avoid swallowing
// trailing sentence punctuation (e.g. "@aaron." → "aaron").
const HANDLE_RE =
  // (^|boundary) @  ( email  |  username )
  /(^|[\s([{<,;:!?"'])@([A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|[A-Za-z0-9][A-Za-z0-9._-]*)/g;

export interface ParsedMentions {
  /** Lowercased email handles (the `@a@b.com` form). */
  emails: string[];
  /** Lowercased username handles (the `@username` form, no email). */
  usernames: string[];
  /** Every raw handle (lowercased), emails + usernames, deduped. */
  all: string[];
}

/**
 * Extract @mention handles from free text. Case-insensitive + deduped.
 * Returns emails and usernames separately (a caller may resolve them against
 * different unique columns) plus a combined `all` set.
 */
export function parseMentions(content: string | null | undefined): ParsedMentions {
  const emails = new Set<string>();
  const usernames = new Set<string>();

  if (typeof content === 'string' && content.length > 0) {
    for (const match of content.matchAll(HANDLE_RE)) {
      const handle = match[2];
      if (!handle) continue;
      const lower = handle.toLowerCase();
      // A handle containing '@' is an email; otherwise a username. Trailing
      // dots/hyphens are trimmed so "@bob." resolves to the username "bob".
      const cleaned = lower.replace(/[._-]+$/, '');
      if (!cleaned) continue;
      if (cleaned.includes('@')) {
        emails.add(cleaned);
      } else {
        usernames.add(cleaned);
      }
    }
  }

  return {
    emails: [...emails],
    usernames: [...usernames],
    all: [...new Set([...emails, ...usernames])],
  };
}
