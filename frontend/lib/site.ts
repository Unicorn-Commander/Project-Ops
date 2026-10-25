// Per-environment public site settings, inlined at build time from NEXT_PUBLIC_*
// build args (see Dockerfile). Every value is optional: unset means "emit
// nothing" (no canonical, no analytics), so a dev or dogfood build never
// carries production hosts or the production analytics id.

function cleanOrigin(raw: string | undefined): string | undefined {
  const v = (raw ?? "").trim();
  if (!v) return undefined;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    return u.origin;
  } catch {
    return undefined;
  }
}

/** Canonical origin, e.g. https://projectops.unicorncommander.ai (no trailing slash). */
export const SITE_URL = cleanOrigin(process.env.NEXT_PUBLIC_SITE_URL);

/** Bare host for display (print footers, showcase chrome). */
export const SITE_HOST = SITE_URL ? new URL(SITE_URL).host : "projectops.magicunicorn.dev";

/** Umami (self-hosted, cookieless). Both must be set or analytics is off. */
export const UMAMI_SCRIPT_URL = (process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL ?? "").trim() || undefined;
export const UMAMI_WEBSITE_ID = (process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID ?? "").trim() || undefined;
export const ANALYTICS_ENABLED = Boolean(UMAMI_SCRIPT_URL && UMAMI_WEBSITE_ID);
