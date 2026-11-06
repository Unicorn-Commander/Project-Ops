import { GoneException } from '@nestjs/common';

/** Default lifetime when CLIENT_INVITE_TTL_DAYS is unset or not a positive number. */
export const CLIENT_INVITE_TTL_DAYS_DEFAULT = 14;

export const CLIENT_INVITE_EXPIRED_MESSAGE =
  'This invitation has expired. Ask the person who invited you to send a new one.';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Days a client-portal invite stays usable, from CLIENT_INVITE_TTL_DAYS.
 * Unset, blank, non-numeric, or < 1 all fall back to 14. Fractional values
 * are floored (0.5 → default, 14.9 → 14).
 */
export function clientInviteTtlDays(raw?: string): number {
  const value = raw === undefined ? process.env.CLIENT_INVITE_TTL_DAYS : raw;
  if (value == null || String(value).trim() === '') {
    return CLIENT_INVITE_TTL_DAYS_DEFAULT;
  }
  const parsed = Number(String(value).trim());
  if (!Number.isFinite(parsed) || parsed < 1) {
    return CLIENT_INVITE_TTL_DAYS_DEFAULT;
  }
  return Math.floor(parsed);
}

/** Absolute expiry: invitationSentAt plus the TTL. 14 days means 14 × 24 hours. */
export function clientInviteExpiresAt(invitationSentAt: Date, ttlDays: number): Date {
  return new Date(invitationSentAt.getTime() + ttlDays * MS_PER_DAY);
}

/**
 * True when the invite can no longer be used.
 * A missing or invalid invitationSentAt counts as expired: the only writer
 * (inviteToPortal) always stores the issue time, so an undated token has
 * no lifetime to derive and must be re-issued.
 */
export function isClientInviteExpired(
  invitationSentAt: Date | null | undefined,
  now: Date = new Date(),
  ttlDays: number = clientInviteTtlDays(),
): boolean {
  if (invitationSentAt == null || Number.isNaN(invitationSentAt.getTime())) {
    return true;
  }
  return now.getTime() >= clientInviteExpiresAt(invitationSentAt, ttlDays).getTime();
}

/** Signup rejects an expired invite with 410 and does not create a user. */
export function assertClientInviteCurrent(
  invitationSentAt: Date | null | undefined,
  now: Date = new Date(),
  ttlDays: number = clientInviteTtlDays(),
): void {
  if (isClientInviteExpired(invitationSentAt, now, ttlDays)) {
    throw new GoneException(CLIENT_INVITE_EXPIRED_MESSAGE);
  }
}

/**
 * Link embedded in the invitation email. The signup page is
 * /auth/client-signup/[token]. Older mail used /auth/contact-signup, which
 * the frontend redirects.
 */
export function buildClientInviteUrl(frontendUrl: string, invitationToken: string): string {
  return `${frontendUrl}/auth/client-signup/${invitationToken}`;
}
