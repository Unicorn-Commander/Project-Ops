import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Fingerprint,
  Gauge,
  MessageSquareText,
  Network,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { KanbanShowcase } from "@/components/landing/kanban-showcase";
import { RotatingHeadline } from "@/components/landing/rotating-headline";
import { ZoomableShot } from "@/components/landing/zoomable-shot";

const outcomes = [
  {
    icon: MessageSquareText,
    title: "No more retyping action items",
    body: "Meeting decisions and commitments become project work with the original source context attached.",
  },
  {
    icon: Fingerprint,
    title: "Every task remembers why it exists",
    body: "Trace work back to the meeting, client request, document, or requirement that created it.",
  },
  {
    icon: Bot,
    title: "Delegate to people or agents",
    body: "Give work to a person, an AI agent, an external collaborator, or a coordinated team.",
  },
  {
    icon: Building2,
    title: "Clients see progress, not internal chaos",
    body: "Share the right deliverables, decisions, documents, approvals, and billing in a scoped portal.",
  },
];

// Paired product shots for the "See it actually working" gallery. Each is a
// real interface, clickable to a full-screen view via <ZoomableShot>.
const gallery = [
  {
    src: "/product-shots/schedule-light.webp",
    title: "Every project on one timeline.",
    body: "Group the master schedule by customer, product, owner, or status. Bars carry live progress.",
  },
  {
    src: "/product-shots/reports-dark.webp",
    title: "Portfolio health, live.",
    body: "Active work, budget, billing, and completion across every project — not a spreadsheet in sight.",
  },
  {
    src: "/product-shots/projects-dark.webp",
    title: "Every project keeps its context.",
    body: "Status, priority, owner, client, and the source that created it — attached, not lost in a thread.",
  },
  {
    src: "/product-shots/agent-activity.webp",
    title: "Know what every agent did — and what it cost.",
    body: "Activity, tools, entities, duration, tokens, and billable cost stay visible and auditable.",
  },
  {
    src: "/product-shots/meeting-triage.webp",
    title: "A human approval gate on AI action items.",
    body: "Approve, route, group, or reject meeting-derived items before anything becomes project work.",
  },
  {
    src: "/product-shots/billing.webp",
    title: "Delivery straight through to billing.",
    body: "Project progress and financial status live in the same operating context — one tool, one truth.",
  },
];

const themes: Array<[string, string]> = [
  ["/product-shots/dashboard-light.webp", "Light"],
  ["/product-shots/dashboard-dark.webp", "Dark"],
  ["/product-shots/dashboard-vibrant.webp", "Vibrant"],
];

const suite = [
  ["Meeting-Ops", "Understands what was discussed."],
  ["Project-Ops", "Turns it into coordinated execution."],
  ["Contact-Ops + Customer-Ops", "Add the relationship context."],
  ["Unicorn Brigade", "Supplies the specialized agents."],
  ["Ops-Center", "Governs identity, models, and permissions."],
];

const faq = [
  ["Can I self-host Project-Ops?", "Yes. Project-Ops runs as a Docker Compose stack with Postgres, Redis, S3-compatible storage, a NestJS backend, and a Next.js frontend. Your data and deployment remain yours."],
  ["Does the AI agent need to be enabled?", "No. The project workspace works without it. Unicorn Brigade integration is optional and can point to your own installation."],
  ["How are permissions handled?", "Keycloak provides OpenID Connect SSO. ADMIN, MANAGER, and CLIENT roles are enforced through visibility filters that also scope MCP tool calls."],
  ["Can clients use it?", "Yes. Clients receive a private view of their organization’s projects, tasks, shared documents, comments, approvals, and billing information."],
  ["What can agents actually do?", "Through the secured MCP surface, agents can read permitted workspace context and create or update project work. Their activity, project footprint, token usage, and cost are recorded."],
  ["Will it still be mine in a decade?", "That’s the point. Self-host it, connect your own models, keep your data, and never rebuild your operating system because a vendor changed direction."],
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium uppercase tracking-[0.18em] text-foreground/60">{children}</div>;
}

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-border dark:bg-zinc-100">
              <Image src="/projectops-mascot.png" alt="Project-Ops" width={36} height={36} priority />
            </span>
            <div className="leading-tight">
              <div className="text-base font-semibold tracking-tight">Project-Ops</div>
              <div className="text-[11px] uppercase tracking-wider text-foreground/60">by Magic Unicorn</div>
            </div>
          </Link>
          <div className="flex items-center gap-1.5">
            <a href="#workflow" className="hidden px-3 py-1.5 text-sm text-foreground/70 hover:text-foreground md:inline-block">Workflow</a>
            <a href="#product" className="hidden px-3 py-1.5 text-sm text-foreground/70 hover:text-foreground md:inline-block">Product</a>
            <a href="#capabilities" className="hidden px-3 py-1.5 text-sm text-foreground/70 hover:text-foreground md:inline-block">Capabilities</a>
            <a href="#faq" className="hidden px-3 py-1.5 text-sm text-foreground/70 hover:text-foreground sm:inline-block">FAQ</a>
            <ThemeToggle />
            <Link href="/auth/login"><Button size="sm" className="bg-foreground text-background hover:bg-foreground/90">Open Project-Ops <ArrowRight className="ml-1.5 h-4 w-4" /></Button></Link>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[650px] overflow-hidden">
            <div className="absolute -top-32 left-1/4 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-violet-500/20 blur-[140px]" />
            <div className="absolute -top-20 right-1/4 h-[420px] w-[420px] translate-x-1/2 rounded-full bg-amber-400/15 blur-[140px]" />
            <div className="absolute top-36 left-1/2 h-[360px] w-[360px] -translate-x-1/2 rounded-full bg-cyan-400/10 blur-[120px]" />
          </div>
          <div className="mx-auto max-w-5xl px-6 pb-10 pt-16 text-center md:pt-20">
            <div className="mb-6 flex justify-center">
              <div className="relative">
                <div aria-hidden className="absolute inset-0 -z-10 scale-110 rounded-full bg-violet-500/25 blur-2xl" />
                <Image
                  src="/projectops-mascot.png"
                  alt="Project-Ops"
                  width={144}
                  height={144}
                  priority
                  className="h-28 w-28 drop-shadow-[0_8px_24px_rgba(139,92,246,0.35)] sm:h-32 sm:w-32 md:h-36 md:w-36"
                />
              </div>
            </div>
            <Link href="https://unicorncommander.ai" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3.5 py-1.5 text-xs font-medium text-foreground/75 backdrop-blur hover:text-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Built for human and AI teams <ArrowRight className="h-3 w-3 opacity-60" />
            </Link>
            <RotatingHeadline />
            <p className="mx-auto mt-6 max-w-3xl text-balance text-lg leading-relaxed text-foreground/75 md:text-xl">
              Project-Ops connects meetings, projects, people, AI agents, clients, documents, and billing in one operational system. Work keeps its context from discussion to delivery.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/auth/login"><Button size="lg" className="bg-foreground px-6 text-background shadow-lg shadow-foreground/10 hover:bg-foreground/90">Open Project-Ops <ArrowRight className="ml-1.5 h-4 w-4" /></Button></Link>
              <a href="#workflow"><Button size="lg" variant="outline" className="px-7">See how work flows</Button></a>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-foreground/65">
              <span>Self-hostable</span><span aria-hidden>·</span><span>SSO and RBAC</span><span aria-hidden>·</span><span>Human and AI teams</span><span aria-hidden>·</span><span>Your infrastructure or ours</span>
            </div>
            <p className="mt-5 text-sm font-medium text-foreground/60">Project work, delivered without the drama.</p>
          </div>
          <div id="preview" className="mx-auto max-w-6xl px-6 pb-20"><KanbanShowcase /></div>
        </section>

        <section id="workflow" className="border-y border-border bg-foreground/[0.015]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="mx-auto max-w-3xl text-center">
              <Eyebrow>Meeting-Ops → Project-Ops</Eyebrow>
              <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">From conversation to coordinated execution.</h2>
              <p className="mt-4 text-lg leading-relaxed text-foreground/70">The handoff is the product: decisions become traceable work without losing the conversation that made them matter.</p>
            </div>
            <div className="mt-12 grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1fr]">
              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center justify-between border-b border-border pb-4"><div><div className="text-sm font-semibold">Meeting-Ops</div><div className="text-xs text-foreground/55">Weekly product review · 42 min</div></div><span className="rounded-full bg-violet-500/15 px-2.5 py-1 text-xs text-violet-600 dark:text-violet-300">Understood</span></div>
                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border border-border bg-background p-4"><div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" /><div><div className="text-sm font-medium">Publish the revised launch page</div><div className="mt-1 text-xs leading-relaxed text-foreground/60">“Aaron will update the positioning before Friday.”</div></div></div></div>
                  <div className="rounded-xl border border-border bg-background p-4"><div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" /><div><div className="text-sm font-medium">Verify customer migration plan</div><div className="mt-1 text-xs leading-relaxed text-foreground/60">Decision and transcript context attached</div></div></div></div>
                </div>
              </div>
              <div className="flex items-center justify-center py-1 lg:px-2"><div className="flex h-12 w-12 rotate-90 items-center justify-center rounded-full border border-border bg-card shadow-sm lg:rotate-0"><ArrowRight className="h-5 w-5 text-violet-500" /></div></div>
              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center justify-between border-b border-border pb-4"><div><div className="text-sm font-semibold">Project-Ops</div><div className="text-xs text-foreground/55">Launch · In progress</div></div><span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-300">2 tasks created</span></div>
                <div className="mt-4 rounded-xl border border-violet-500/30 bg-background p-4 shadow-sm">
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-foreground/55"><span>P-00142</span><span className="text-amber-600">High</span></div>
                  <div className="mt-2 font-semibold">Publish the revised launch page</div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded-md bg-violet-500/10 px-2 py-1 text-violet-600 dark:text-violet-300">Source: Weekly product review</span><span className="rounded-md bg-blue-500/10 px-2 py-1 text-blue-600 dark:text-blue-300">Executor: Aaron</span></div>
                  <div className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-xs text-foreground/60"><Network className="h-3.5 w-3.5" /> Transcript, decision, client, and project stay connected</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Real product — big, clickable screenshots. */}
        <section id="product" className="border-b border-border">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
              <div className="lg:col-span-7">
                <Eyebrow>Real product, real work</Eyebrow>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">See it actually working.</h2>
              </div>
              <p className="text-base leading-relaxed text-foreground/70 lg:col-span-5">
                Live Project-Ops interfaces — not concept art. Click any screen to open it full-size.
              </p>
            </div>

            {/* Flagship board */}
            <figure className="mt-12">
              <ZoomableShot
                src="/product-shots/kanban-dark.webp"
                alt="Project-Ops kanban board with Pending, In Progress, Waiting for Client, and Completed columns full of status-coloured task cards"
                caption="The board — every task, every status, drag-and-drop."
                width={1920}
                height={1080}
                sizes="(max-width: 1200px) 100vw, 1152px"
                priority
                className="rounded-2xl border border-border bg-card shadow-2xl shadow-foreground/5"
              />
              <figcaption className="mt-4 flex flex-col justify-between gap-2 sm:flex-row">
                <span className="font-semibold">The work in flight is the work you can see.</span>
                <span className="text-sm text-foreground/60">Filter by org, project, assignee, or priority — then drag to update status.</span>
              </figcaption>
            </figure>

            <div className="mt-10 grid gap-x-8 gap-y-12 md:grid-cols-2">
              {gallery.map((shot) => (
                <figure key={shot.src}>
                  <ZoomableShot
                    src={shot.src}
                    alt={shot.title}
                    caption={shot.title}
                    width={1920}
                    height={1080}
                    sizes="(max-width: 768px) 100vw, 560px"
                    className="rounded-xl border border-border bg-card shadow-lg shadow-foreground/5"
                  />
                  <figcaption className="mt-4">
                    <div className="font-semibold">{shot.title}</div>
                    <p className="mt-1 text-base leading-relaxed text-foreground/65">{shot.body}</p>
                  </figcaption>
                </figure>
              ))}
            </div>

            {/* Theme showcase */}
            <div className="mt-16 border-t border-border pt-12">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                <div><Eyebrow>Your workspace, your way</Eyebrow><h3 className="mt-2 text-2xl font-semibold tracking-tight">Light, dark, or vibrant.</h3></div>
                <p className="max-w-md text-sm leading-relaxed text-foreground/65">Three complete themes, the same information hierarchy and controls in each. Click to compare full-size.</p>
              </div>
              <div className="mt-7 grid gap-5 sm:grid-cols-3">
                {themes.map(([src, label]) => (
                  <figure key={src}>
                    <ZoomableShot
                      src={src}
                      alt={`Project-Ops dashboard in the ${label.toLowerCase()} theme`}
                      caption={`Dashboard — ${label} theme`}
                      width={1200}
                      height={675}
                      sizes="(max-width: 640px) 100vw, 370px"
                      className="rounded-xl border border-border bg-card shadow-md"
                    />
                    <figcaption className="mt-3 text-sm font-medium">{label} theme</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-border bg-foreground/[0.015]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
              <div className="lg:col-span-5">
                <Eyebrow>Human + agent execution</Eyebrow>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Every task has an executor, not just an assignee.</h2>
                <p className="mt-4 text-lg leading-relaxed text-foreground/70">Plan the work, preserve its context, assign it to a person or agent, and see exactly what happened.</p>
                <p className="mt-5 border-l-2 border-violet-500 pl-4 font-medium">Not merely an assistant that talks about your projects. An agent that can work inside them.</p>
              </div>
              <div className="lg:col-span-7">
                <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                  <div className="flex items-center justify-between border-b border-border px-5 py-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/15"><Bot className="h-5 w-5 text-violet-500" /></span><div><div className="text-sm font-semibold">Gunny · Unicorn Brigade</div><div className="text-xs text-foreground/55">Agent executor · working</div></div></div><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /></div>
                  <div className="grid gap-px bg-border sm:grid-cols-3">
                    {[["Context supplied", "Meeting notes, project brief, 3 linked documents"], ["Tools permitted", "Projects, tasks, comments, documents"], ["Approval gate", "Required before publishing"]].map(([a,b]) => <div key={a} className="bg-card p-4"><div className="text-xs text-foreground/55">{a}</div><div className="mt-1 text-sm font-medium">{b}</div></div>)}
                  </div>
                  <div className="p-5">
                    <div className="space-y-3 text-sm">
                      <div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" /><span>Read the source meeting and linked requirements</span></div>
                      <div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" /><span>Created implementation tasks and drafted the project update</span></div>
                      <div className="flex gap-3"><Gauge className="mt-0.5 h-4 w-4 text-amber-500" /><span>Waiting for human approval to publish</span></div>
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4 text-xs text-foreground/60"><span className="rounded-md bg-foreground/5 px-2 py-1">Full audit record</span><span className="rounded-md bg-foreground/5 px-2 py-1">Artifacts attached</span><span className="rounded-md bg-foreground/5 px-2 py-1">Usage + cost tracked</span></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Real proof: capacity planning treats people and agents as one team. */}
            <figure className="mt-12">
              <ZoomableShot
                src="/product-shots/capacity-dark.webp"
                alt="Project-Ops capacity planning showing committed hours versus capacity across people and AI agents on the same team"
                caption="Capacity planning — people and agents on one team."
                width={1920}
                height={1080}
                sizes="(max-width: 1200px) 100vw, 1152px"
                className="rounded-2xl border border-border bg-card shadow-xl shadow-foreground/5"
              />
              <figcaption className="mt-4 flex flex-col justify-between gap-2 sm:flex-row">
                <span className="font-semibold">Plan the whole team — human and agent alike.</span>
                <span className="text-sm text-foreground/60">Committed hours against real capacity, so nothing gets silently over-allocated.</span>
              </figcaption>
            </figure>
          </div>
        </section>

        <section id="capabilities" className="border-b border-border">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="max-w-3xl"><Eyebrow>Connected project memory</Eyebrow><h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">Everything required to move work from discussion to delivery.</h2></div>
            <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {outcomes.map(({icon: Icon,title,body}) => <div key={title} className="bg-card p-6"><Icon className="h-6 w-6 text-violet-500" strokeWidth={1.7} /><h3 className="mt-5 font-semibold">{title}</h3><p className="mt-2 text-base leading-relaxed text-foreground/70">{body}</p></div>)}
            </div>
            <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[[UsersRound,"CRM + organizations"],[FileText,"Documents + activity"],[CircleDollarSign,"Billing + client portal"],[ShieldCheck,"SSO, RBAC + audit"]].map(([Icon,label]) => { const C = Icon as typeof UsersRound; return <div key={label as string} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium"><C className="h-4 w-4 text-foreground/55" />{label as string}</div>; })}
            </div>

            {/* SSO + RBAC proof */}
            <div className="mt-14 grid gap-8 lg:grid-cols-12 lg:items-center">
              <div className="lg:col-span-5">
                <Eyebrow>Federated identity, real roles</Eyebrow>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Sign in once. See exactly what you should.</h3>
                <p className="mt-4 text-base leading-relaxed text-foreground/70">Team members appear automatically the first time they sign in through Unicorn Commander SSO. Admin, staff, and client roles are enforced everywhere — including every agent tool call.</p>
              </div>
              <div className="lg:col-span-7">
                <ZoomableShot
                  src="/product-shots/users-light.webp"
                  alt="Project-Ops user management with SSO federation, roles, and status across the team"
                  caption="User management — federated SSO with Admin, Staff, and Client roles."
                  width={1920}
                  height={1080}
                  sizes="(max-width: 1024px) 100vw, 660px"
                  className="rounded-2xl border border-border bg-card shadow-lg shadow-foreground/5"
                />
              </div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="border-b border-border bg-foreground/[0.015]">
          <div className="mx-auto max-w-6xl px-6 py-20"><div className="max-w-2xl"><Eyebrow>The operational loop</Eyebrow><h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Context moves with the work.</h2></div><ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-5">{[["01","Capture the work","Create it directly or pull it from meetings, conversations, clients, and documents."],["02","Add the context","Connect decisions, people, organizations, files, dependencies, and source conversations."],["03","Assign the executor","Give it to a person, an AI agent, an external collaborator, or a human-agent team."],["04","Observe and approve","Follow activity, artifacts, cost, blockers, and approval gates without chasing updates."],["05","Deliver and remember","Share the result, update the client, track billing, and preserve what happened."]].map(([n,t,b]) => <li key={n} className="border-t border-border pt-5"><div className="font-mono text-xs text-foreground/50">{n}</div><h3 className="mt-2 font-semibold">{t}</h3><p className="mt-2 text-sm leading-relaxed text-foreground/70">{b}</p></li>)}</ol></div>
        </section>

        {/* Ecosystem — crew illustration removed in favour of an architecture map. */}
        <section className="border-b border-border">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="mx-auto max-w-3xl text-center">
              <Eyebrow>One operational loop</Eyebrow>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Across the Unicorn Commander suite.</h2>
              <p className="mt-4 text-lg leading-relaxed text-foreground/70">One account, one audit trail, and shared organizational memory across everything.</p>
            </div>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {suite.map(([name, role]) => {
                const you = name === "Project-Ops";
                return (
                  <div key={name} className={`rounded-2xl border p-5 ${you ? "border-violet-500/50 bg-violet-500/[0.06] shadow-sm" : "border-border bg-card"}`}>
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${you ? "bg-violet-500" : "bg-foreground/30"}`} />
                      <div className="text-sm font-semibold">{name}</div>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-foreground/65">{role}</p>
                    {you && <div className="mt-3 text-[11px] font-medium uppercase tracking-wider text-violet-600 dark:text-violet-300">You are here</div>}
                  </div>
                );
              })}
            </div>
            <div className="mt-10 flex justify-center">
              <Link href="https://unicorncommander.ai" target="_blank" rel="noreferrer"><Button variant="outline">Explore Unicorn Commander <ArrowRight className="ml-1.5 h-4 w-4" /></Button></Link>
            </div>
          </div>
        </section>

        <section id="faq" className="border-b border-border bg-foreground/[0.015]"><div className="mx-auto max-w-4xl px-6 py-20"><Eyebrow>FAQ</Eyebrow><h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">The honest answers.</h2><div className="mt-10 divide-y divide-border rounded-xl border border-border bg-card">{faq.map(([q,a]) => <details key={q} className="group px-5 py-4 [&[open]>summary>svg]:rotate-180"><summary className="flex cursor-pointer list-none items-start justify-between gap-4"><span className="font-semibold">{q}</span><ArrowRight className="mt-1 h-4 w-4 shrink-0 rotate-90 text-foreground/55 transition-transform" /></summary><p className="mt-3 max-w-3xl text-base leading-relaxed text-foreground/70">{a}</p></details>)}</div></div></section>

        <section className="relative overflow-hidden border-b border-border"><div aria-hidden className="absolute inset-0 -z-10"><div className="absolute left-1/2 top-1/2 h-[380px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/15 blur-[140px]" /></div><div className="mx-auto max-w-3xl px-6 py-24 text-center"><Sparkles className="mx-auto h-6 w-6 text-violet-500" /><h2 className="mt-5 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">Move work from conversation to completion.</h2><p className="mx-auto mt-5 max-w-xl text-lg text-foreground/70">Set up in an afternoon. Built to remain yours for the long haul.</p><div className="mt-8"><Link href="/auth/login"><Button size="lg" className="bg-foreground px-6 text-background hover:bg-foreground/90">Open Project-Ops <ArrowRight className="ml-1.5 h-4 w-4" /></Button></Link></div></div></section>
      </main>

      <footer><div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-foreground/60 sm:flex-row"><div className="flex items-center gap-2.5"><Image src="/projectops-mascot.png" alt="" width={22} height={22} className="rounded bg-white" /><span>Project-Ops · © {new Date().getFullYear()} Magic Unicorn</span></div><nav className="flex gap-5"><a href="https://git.unicorncommander.ai/MagicUnicorn/Project-Ops" target="_blank" rel="noreferrer" className="hover:text-foreground">Source</a><a href="https://magicunicorn.dev" target="_blank" rel="noreferrer" className="hover:text-foreground">Magic Unicorn</a></nav></div></footer>
    </div>
  );
}
