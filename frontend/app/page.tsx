import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { iconWellClass } from "@/lib/badge-styles";
import { KanbanShowcase } from "@/components/landing/kanban-showcase";
import {
  KanbanSquare,
  Building2,
  Receipt,
  UsersRound,
  FileText,
  Radio,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";

const features: Array<{
  icon: typeof KanbanSquare;
  title: string;
  body: string;
  tone: "blue" | "amber" | "emerald" | "rose" | "violet" | "orange" | "primary";
}> = [
  {
    icon: KanbanSquare,
    title: "Projects & tasks",
    body: "Status, priority, deadlines, owners — plus a kanban board so the work in flight is the work you can see.",
    tone: "blue",
  },
  {
    icon: UsersRound,
    title: "Organizations & contacts",
    body: "A real CRM under the hood. Parent/child organization hierarchy, multiple contacts per org, and per-organization project rollups.",
    tone: "emerald",
  },
  {
    icon: Receipt,
    title: "Billing & invoices",
    body: "Track billing amount, invoice number, payment status, billing date, and amount paid right on the project — no second tool.",
    tone: "amber",
  },
  {
    icon: Building2,
    title: "Client portal",
    body: "Invite a client to a private view of their projects. Share documents. Stay out of email.",
    tone: "violet",
  },
  {
    icon: FileText,
    title: "Document workspace",
    body: "Upload files, attach to projects or tasks, share with the right people. S3-compatible storage.",
    tone: "orange",
  },
  {
    icon: Radio,
    title: "Real-time collaboration",
    body: "WebSocket-driven updates across the team. When someone moves a card or marks a task done, every other tab catches up live.",
    tone: "rose",
  },
  {
    icon: MessageSquare,
    title: "Activity & comments",
    body: "Threaded comments on projects and tasks plus a unified activity feed — anyone can catch up in a glance.",
    tone: "blue",
  },
  {
    icon: ShieldCheck,
    title: "SSO + audit trail",
    body: "Sign in with Unicorn Commander SSO. Every change is logged with who, when, and what — exportable.",
    tone: "primary",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-border">
              <Image src="/projectops-mascot.png" alt="Project Ops" width={36} height={36} priority />
            </span>
            <div className="leading-tight">
              <div className="text-base font-semibold tracking-tight">Project Ops</div>
              <div className="text-[11px] uppercase tracking-wider text-foreground/55">
                by Magic Unicorn
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-1.5">
            <a href="#features" className="hidden px-3 py-1.5 text-sm text-foreground/70 transition-colors hover:text-foreground sm:inline-block">
              Features
            </a>
            <a href="#how-it-works" className="hidden px-3 py-1.5 text-sm text-foreground/70 transition-colors hover:text-foreground sm:inline-block">
              How it works
            </a>
            <ThemeToggle />
            <Link href="/auth/login">
              <Button size="sm" className="bg-foreground text-background hover:bg-foreground/90">
                Sign in
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero — centered, big, ambient multi-hue glow behind. The crew
          artwork moves to the trust band lower on the page; here we put
          the actual product (kanban) front-and-center underneath. */}
      <section className="relative overflow-hidden">
        {/* Multi-hue ambient glows — violet + amber + cyan. Each blurred
            heavily and used at very low opacity so they whisper rather
            than shout. The page reads as "deliberately neutral with a
            little energy" rather than "purple". */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[700px] overflow-hidden">
          <div className="absolute -top-32 left-1/4 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-violet-500/15 blur-[140px] dark:bg-violet-500/25" />
          <div className="absolute -top-20 right-1/4 h-[420px] w-[420px] translate-x-1/2 rounded-full bg-amber-400/10 blur-[140px] dark:bg-amber-400/15" />
          <div className="absolute top-40 left-1/2 h-[360px] w-[360px] -translate-x-1/2 rounded-full bg-cyan-400/10 blur-[120px] dark:bg-cyan-400/15" />
        </div>

        <div className="relative mx-auto max-w-5xl px-6 pt-24 pb-12 text-center md:pt-32">
          {/* Trust mark */}
          <Link
            href="https://unicorncommander.ai"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3.5 py-1.5 text-xs font-medium text-foreground/75 backdrop-blur transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            From the makers of Unicorn Commander
            <ArrowRight className="h-3 w-3 opacity-60" />
          </Link>

          {/* Headline */}
          <h1 className="mt-8 text-balance text-5xl font-semibold leading-[1.04] tracking-tight text-foreground sm:text-6xl md:text-[76px]">
            Project work,
            <br />
            <span className="bg-gradient-to-br from-violet-500 via-rose-500 to-amber-500 bg-clip-text text-transparent">
              delivered without the drama.
            </span>
          </h1>

          <p className="mx-auto mt-7 max-w-2xl text-balance text-lg leading-relaxed text-foreground/70 md:text-xl">
            CRM, project management, kanban, billing, and a built-in AI agent — for teams who'd
            rather ship than chase status updates.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/auth/login">
              <Button
                size="lg"
                className="bg-foreground text-background hover:bg-foreground/90 px-6 shadow-lg shadow-foreground/10"
              >
                <Image
                  src="/the-colonel.png"
                  alt=""
                  width={22}
                  height={22}
                  className="mr-2 h-[22px] w-[22px] shrink-0"
                />
                Sign in with Unicorn Commander
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
            <a href="#preview">
              <Button size="lg" variant="outline" className="px-7">
                See the board
              </Button>
            </a>
          </div>

          {/* Soft proof line */}
          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-foreground/55">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              SSO on day one
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              Self-hosted, your data
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              Billing built in
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              Live AI assistant
            </span>
          </div>
        </div>

        {/* Inline product showcase — real components, not a screenshot */}
        <div id="preview" className="relative mx-auto max-w-6xl px-6 pb-24 md:pb-32">
          <KanbanShowcase />
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-y border-border bg-foreground/[0.015]">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="mb-16 max-w-2xl">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-foreground/55">
              What's inside
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-5xl">
              Everything a working team needs.
              <br />
              <span className="text-foreground/45">Nothing it doesn't.</span>
            </h2>
          </div>

          {/* Spotlight: AI assistant — wide card with richer treatment */}
          <div className="relative mb-12 overflow-hidden rounded-2xl border border-border bg-card p-8 shadow-sm md:p-10">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl dark:bg-violet-500/20"
            />
            <div className="relative grid gap-8 md:grid-cols-12 md:items-center">
              <div className="md:col-span-7">
                <div className={`inline-flex h-10 w-10 items-center justify-center rounded-md ${iconWellClass("violet")}`}>
                  <Sparkles className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <h3 className="mt-5 text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
                  An AI agent that actually knows your work.
                </h3>
                <p className="mt-3 max-w-xl text-foreground/70">
                  Ask the embedded Magic Unicorn assistant about projects, tasks, and recent
                  activity. It reads your live data through a secure MCP connection — drafts
                  status updates, breaks scopes into tasks, and surfaces what changed today.
                </p>
                <ul className="mt-5 grid gap-2 text-sm text-foreground/75 sm:grid-cols-2">
                  <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    Per-user RBAC propagates into every tool call
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    Drafts comments, summaries, and task lists
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    Lives in a sidebar — never out of reach
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    Powered by Unicorn Brigade
                  </li>
                </ul>
              </div>
              {/* Faux chat panel — visualises what the assistant looks like */}
              <div className="md:col-span-5">
                <div className="relative rounded-xl border border-border bg-background p-4 shadow-md">
                  <div className="flex items-center gap-2 border-b border-border pb-3">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white ring-1 ring-border">
                      <Image src="/projectops-mascot.png" alt="" width={24} height={24} />
                    </span>
                    <div className="leading-tight">
                      <div className="text-xs font-semibold">Project Ops Assistant</div>
                      <div className="text-[10px] text-foreground/50">Powered by Unicorn Brigade</div>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2.5 text-[13px]">
                    <div className="ml-auto max-w-[80%] rounded-lg bg-foreground px-3 py-1.5 text-background">
                      what projects do I have right now?
                    </div>
                    <div className="mr-auto max-w-[90%] rounded-lg border border-border bg-card px-3 py-2 text-foreground/85">
                      You've got <span className="font-mono">2</span> active projects:
                      <div className="mt-1.5 space-y-0.5 text-[12px] text-foreground/70">
                        <div>· P-00001 — Brigade ↔ Project-Ops MCP integration</div>
                        <div>· P-00002 — Build In Public — Tuesday show prep</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Other features grid */}
          <div className="grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({ icon: Icon, title, body, tone }) => (
              <div key={title} className="group">
                <div className={`inline-flex h-10 w-10 items-center justify-center rounded-md transition-transform group-hover:scale-105 ${iconWellClass(tone)}`}>
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <h3 className="mt-5 text-base font-semibold text-foreground">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-foreground/65">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="mb-16 max-w-2xl">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-foreground/55">
              How it works
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-5xl">
              Set up in an afternoon.
              <br />
              <span className="text-foreground/45">Live for the next decade.</span>
            </h2>
          </div>

          <ol className="grid gap-10 sm:grid-cols-3">
            {[
              {
                n: "01",
                t: "Create a project",
                b: "Title, status, priority, owner. Optionally tie it to a client organization.",
              },
              {
                n: "02",
                t: "Break it into tasks",
                b: "Add tasks, assign, set deadlines. Watch the kanban board fill in.",
              },
              {
                n: "03",
                t: "Invite the right people",
                b: "Internal teammates via SSO. External clients via portal invite. Everyone sees only what they should.",
              },
            ].map((s) => (
              <li key={s.n} className="border-t border-border pt-6">
                <div className="text-xs font-mono text-foreground/50">{s.n}</div>
                <div className="mt-2 text-base font-semibold text-foreground">{s.t}</div>
                <p className="mt-2 text-sm leading-relaxed text-foreground/65">{s.b}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Built by — the crew artwork lives here, where it earns its place
          as identity rather than competing with the product showcase. */}
      <section className="relative overflow-hidden border-b border-border bg-foreground/[0.015]">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-24 md:grid-cols-12 md:gap-16">
          <div className="md:col-span-7">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-foreground/55">
              Built by Magic Unicorn
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Part of the Unicorn Commander suite.
            </h2>
            <p className="mt-5 max-w-xl text-foreground/70">
              Project Ops is one of the apps Magic Unicorn ships internally — alongside the
              Unicorn Brigade agent platform, the Ops-Center control plane, and our music,
              media, and player apps. One SSO, one audit trail, one shared identity model
              across everything.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="https://unicorncommander.ai" target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm">
                  Unicorn Commander
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </Link>
              <Link href="https://magicunicorn.dev" target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm">
                  Magic Unicorn
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </div>

          <div className="md:col-span-5">
            <div className="relative mx-auto aspect-square w-full max-w-md">
              <Image
                src="/projectops-crew-light.png"
                alt="Project Ops crew: a construction-helmet unicorn with blueprints, an exec unicorn with a tablet of charts, and an ops unicorn at a console — in front of a project Gantt board."
                fill
                sizes="(max-width: 768px) 80vw, 40vw"
                className="object-contain block dark:hidden"
              />
              <Image
                src="/projectops-crew-dark.png"
                alt=""
                fill
                sizes="(max-width: 768px) 80vw, 40vw"
                className="object-contain hidden dark:block"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Closing — bigger, bolder, with ambient kicker */}
      <section className="relative overflow-hidden border-b border-border">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute left-1/2 top-1/2 h-[420px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/10 blur-[140px] dark:bg-violet-500/20" />
        </div>
        <div className="mx-auto max-w-3xl px-6 py-28 text-center">
          <h2 className="text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl md:text-6xl">
            Ready when you are.
          </h2>
          <p className="mx-auto mt-5 max-w-md text-foreground/70">
            Sign in with your Magic Unicorn account to pick up where the team left off.
          </p>
          <div className="mt-9">
            <Link href="/auth/login">
              <Button
                size="lg"
                className="bg-foreground text-background hover:bg-foreground/90 px-6 shadow-lg shadow-foreground/10"
              >
                <Image
                  src="/the-colonel.png"
                  alt=""
                  width={22}
                  height={22}
                  className="mr-2 h-[22px] w-[22px] shrink-0"
                />
                Sign in with Unicorn Commander
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer>
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-10 text-sm text-foreground/60 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded bg-white ring-1 ring-border">
              <Image src="/projectops-mascot.png" alt="" width={20} height={20} />
            </span>
            <span>&copy; {new Date().getFullYear()} Magic Unicorn</span>
          </div>
          <div className="flex items-center gap-5">
            <a
              href="https://unicorncommander.ai"
              className="transition-colors hover:text-foreground"
              target="_blank"
              rel="noreferrer"
            >
              Unicorn Commander
            </a>
            <a
              href="https://magicunicorn.dev"
              className="transition-colors hover:text-foreground"
              target="_blank"
              rel="noreferrer"
            >
              Magic Unicorn
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
