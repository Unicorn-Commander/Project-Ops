/**
 * Runtime brand theming — pull Project Ops's color tokens from Brand-Ops.
 *
 * Brand-Ops (the suite's brand source of truth) exposes a brand's design tokens
 * at `GET {BRAND_OPS_URL}/api/brands/{slug}/tokens`. We fetch them server-side
 * and, in the root layout, inject a small `:root { … }` override AFTER
 * globals.css so the brand drives the theme. If Brand-Ops is unreachable,
 * unset, or returns anything unexpected, `fetchBrandCss()` returns `null` and
 * the hardcoded values in globals.css stand as the fallback.
 *
 * IMPORTANT — we do NOT paste Brand-Ops's own `css` block verbatim. That block
 * names variables like `--brand-primary` / `--surface-background`, which is not
 * the naming this app uses. globals.css drives everything off `--color-*`
 * (Tailwind 4 `@theme`) instead. So we read the structured `color` token list
 * and emit a `:root` block targeting the exact `--color-*` custom properties
 * this app already consumes (see the map below). That way the override actually
 * lands on the variables the UI reads, regardless of Brand-Ops's internal var
 * names. Typography is intentionally left alone: fonts are wired through
 * next/font (`--font-dm-sans` / `--font-jetbrains-mono`) in app/layout.tsx, so
 * we don't touch font families here.
 */

// Semantic Brand-Ops color-token name -> the globals.css custom properties it
// should override. A single brand token may feed more than one app variable
// (e.g. the brand background also seeds the warm secondary/muted surfaces),
// hence string[]. Only tokens Brand-Ops actually returns are emitted; anything
// missing simply leaves that app variable at its globals.css default.
const TOKEN_TO_CSS_VARS: Readonly<Record<string, readonly string[]>> = {
  "brand/primary": ["--color-primary"],
  "brand/accent": ["--color-accent"],
  "surface/background": ["--color-background"],
  "text/foreground": ["--color-foreground"],
  "text/muted": ["--color-muted-foreground"],
};

// Matches the BrandTokens contract from Brand-Ops
// (src/brand_ops/api/schemas.py::BrandTokens). Every field is treated as
// untrusted at runtime and validated defensively before use.
interface BrandColorToken {
  name?: unknown;
  value?: unknown;
}

interface BrandTokensResponse {
  brand?: unknown;
  color?: unknown;
  typography?: unknown;
  css?: unknown;
}

const DEFAULT_BRAND = "project-ops";
const REVALIDATE_SECONDS = 60 * 60; // 1h — brand tokens change rarely.
const FETCH_TIMEOUT_MS = 4000; // never let a slow/hung Brand-Ops stall a render.

/** Trim a trailing slash so URL joins don't double up. */
function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/** A plausible CSS color value (#hex, rgb()/hsl(), or a bare named color). */
function isSafeColorValue(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 64) return false;
  // Disallow anything that could break out of the declaration / inject rules.
  if (/[;{}<>]/.test(v)) return false;
  return (
    /^#[0-9a-fA-F]{3,8}$/.test(v) ||
    /^(?:rgb|rgba|hsl|hsla)\([\d\s.,%/]+\)$/.test(v) ||
    /^[a-zA-Z]+$/.test(v)
  );
}

/**
 * Build a `:root { … }` override block from a validated color-token list,
 * mapping each Brand-Ops semantic token onto the globals.css `--color-*`
 * variable(s) it drives. Returns `null` when nothing usable was produced (so
 * the caller injects no empty `<style>`).
 */
function buildRootCss(colorTokens: readonly BrandColorToken[]): string | null {
  const declarations: string[] = [];
  for (const token of colorTokens) {
    const name = typeof token?.name === "string" ? token.name : "";
    const value = typeof token?.value === "string" ? token.value : "";
    const targets = TOKEN_TO_CSS_VARS[name];
    if (!targets || !isSafeColorValue(value)) continue;
    for (const cssVar of targets) {
      declarations.push(`  ${cssVar}: ${value.trim()};`);
    }
  }
  if (declarations.length === 0) return null;
  return `:root {\n${declarations.join("\n")}\n}`;
}

/**
 * Fetch Project Ops's brand theme from Brand-Ops and return a ready-to-inject
 * `:root` CSS string, or `null`.
 *
 * Server-side only (reads server env, no `NEXT_PUBLIC_` prefix). NEVER throws —
 * every failure mode (unset env, network error, timeout, non-200, malformed
 * body, no usable tokens) resolves to `null` so the caller falls back to the
 * hardcoded globals.css theme. Uses Next's fetch cache with a 1h revalidate, so
 * a healthy Brand-Ops is hit at most once per revalidation window per server.
 */
export async function fetchBrandCss(): Promise<string | null> {
  try {
    const rawBase = process.env.BRAND_OPS_URL;
    if (!rawBase || !rawBase.trim()) return null; // not configured → fallback.

    const base = normalizeBaseUrl(rawBase);
    if (!/^https?:\/\//i.test(base)) return null; // refuse a non-http(s) base.

    const brand =
      (process.env.BRAND_OPS_BRAND && process.env.BRAND_OPS_BRAND.trim()) ||
      DEFAULT_BRAND;
    const url = `${base}/api/brands/${encodeURIComponent(brand)}/tokens`;

    const token = process.env.BRAND_OPS_TOKEN?.trim();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    // Hard timeout in addition to Next's fetch timeout: a hung Brand-Ops must
    // never block server rendering — we just fall back.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        headers,
        signal: controller.signal,
        // Cache + periodically revalidate. Tagged so it could be revalidated
        // on demand later (e.g. a Brand-Ops webhook) without code changes.
        next: { revalidate: REVALIDATE_SECONDS, tags: ["brand-tokens"] },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) return null;

    const data = (await res.json()) as BrandTokensResponse | null;
    if (!data || typeof data !== "object") return null;

    // Preferred path: map the structured color tokens onto our --color-* vars.
    if (Array.isArray(data.color)) {
      const css = buildRootCss(data.color as BrandColorToken[]);
      if (css) return css;
    }

    // No usable color tokens for this app → fall back rather than inject the
    // raw `css` block (it targets Brand-Ops's own var names, not ours).
    return null;
  } catch {
    // AbortError, network/DNS failure, JSON parse error — anything at all.
    return null;
  }
}
