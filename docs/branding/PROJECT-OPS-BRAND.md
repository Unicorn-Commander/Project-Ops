# Project-Ops — Brand Reference

Project-Ops is registered in **Brand-Ops** as the brand slug `project-ops`, a
sub-brand of `unicorn-commander` (which itself sits under `magic-unicorn`). This
file is the human-readable canonical reference; the machine source of truth is
Brand-Ops itself:

```
get_brand            project-ops      # identity (colors, fonts, voice, tagline)
get_brand_tokens     project-ops      # machine tokens + ready-to-paste :root CSS
get_brand_guidelines project-ops      # the assembled brand book
check_compliance     project-ops …    # deterministic copy/asset scoring
```

> The live Brand-Ops store is the Docker volume `deploy_brand-ops-kits` on bigboy
> (`/app/brand-kits/project-ops/`). The same `brand.yaml` should also be committed
> into the Brand-Ops repo so a fresh deploy reseeds it — see "Persistence" below.

## Identity

- **Tagline:** _Project delivery you self-host._
- **Positioning:** the professional-services spine of the Unicorn Commander
  suite. It runs projects & tasks (list / kanban / Gantt), a real CRM, time
  tracking, and billing, with a client portal and the in-app AI assistant. Logged
  time becomes billable rollups that flow to Accounting-Ops for invoicing.
- **Signature move:** _the mascot artwork carries the rainbow; the UI chrome stays
  calm._ Project-Ops is distinct from the suite's emerald / navy / gold lanes by a
  calm **indigo** primary — it bills real clients, so it reads trustworthy.
- **Mascots:** the Project-Ops crew, led by **the Colonel**, who is also the
  in-app AI assistant (Brand-Ops agent identity `the-colonel`, inherits this voice).

## Color tokens — the three shipping themes

These mirror `frontend/app/globals.css` (the running source) exactly. The Brand-Ops
5-key palette records the Light-mode brand colors; the full per-theme set lives here.

| Token | Light | Dark | Vibrant ("MU at night") |
|---|---|---|---|
| `background` | `#fafaf9` | `#08080a` | `#0c0a1a` |
| `foreground` | `#171717` | `#fafafa` | `#f4f0ff` |
| `card` | `#ffffff` | `#17171c` | `#1a1530` |
| `primary` | `#4f46e5` (indigo-600) | `#6366f1` (indigo-500) | `#a78bfa` (violet-400) |
| `accent` | `#f59e0b` (amber) | `#f59e0b` | `#fb923c` |
| `border` / `input` | `#e4e4e7` | `#2e2e33` | `#2d2548` |
| `muted-foreground` | `#71717a` | `#b4b4bd` | `#b8a9d9` |
| `destructive` | `#dc2626` | `#dc2626` | `#dc2626` |

Status badges (theme-aware via `frontend/lib/badge-styles.ts`): success `#23A455`,
warning `#fcb900`, danger = destructive, info = primary. **Chrome carries no rainbow
hue** — only the mascot art and accent surfaces do.

Brand-Ops `:root` token block (`get_brand_tokens project-ops`):

```css
:root {
  --brand-primary: #4f46e5;
  --brand-accent: #f59e0b;
  --surface-background: #fafaf9;
  --text-foreground: #171717;
  --text-muted: #71717a;
  --font-display: "DM Sans";
  --font-body: "DM Sans";
  --font-mono: "JetBrains Mono";
}
```

## Typography

- **Display + body:** DM Sans.
- **Mono** (code, identifiers, `P-XXXXX` project numbers): JetBrains Mono.

> Repo note: `app/layout.tsx` still imports Inter into `--font-inter` while
> `globals.css` overrides `body` to DM Sans, and no mono face is loaded yet. Polish
> task: load DM Sans (+ JetBrains Mono) via `next/font` and drop the unused Inter
> variable so the loaded fonts match the brand.

## Voice

- **Tone:** confident, direct, technical, professional, calm, unapologetic.
  (Inherits Magic Unicorn's voice, tuned calmer for software that touches money.)
- **Forbidden phrases:** _revolutionary, game-changer, synergize, unleash._
- **No em-dashes in brand copy** — Brand-Ops `check_compliance` scores them as a
  violation. Use commas, periods, or parentheses.

## Assets

Canonical art lives in `frontend/public/` and is mirrored into the Brand-Ops kit
(`/app/brand-kits/project-ops/imported/`):

- `the-colonel.png` — the Colonel (in-app assistant avatar / crew lead).
- `projectops-mascot.png` — the brand mark.
- `projectops-crew-{light,dark}.png` — the crew lockups (landing / marketing).

Shared `*-Ops` officer generation refs (`refs/colonel.png`, `refs/canonical-unicorn.png`)
are copied in so any future on-brand asset generation matches the family house style.

## Persistence

The corrected `brand.yaml` is **live** in the Brand-Ops volume now. To make it
survive a clean Brand-Ops redeploy, commit `brand-kits/project-ops/` into the
Brand-Ops repo as well (palette + voice + prompts + the `imported/` art and `refs/`).
A copy of the authored file is kept at the repo root of this change for reference.
