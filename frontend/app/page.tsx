import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  KanbanSquare,
  Users,
  FileText,
  Bell,
  Building2,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";

const features = [
  {
    icon: KanbanSquare,
    title: "Projects & tasks",
    body: "Status, priority, deadlines, milestones — and a kanban board for in-flight work.",
  },
  {
    icon: Users,
    title: "Roles for real teams",
    body: "Admin, manager, staff, and client. Each sees what they should — no toggles, no accidents.",
  },
  {
    icon: Building2,
    title: "Client portal",
    body: "Invite a client to a private view of their projects. Share documents. Stay out of email.",
  },
  {
    icon: FileText,
    title: "Document workspace",
    body: "Upload files, attach to projects or tasks, share with the right people. S3-compatible storage.",
  },
  {
    icon: Bell,
    title: "Quiet notifications",
    body: "Email when work is assigned, status changes, or a deadline is near. Quiet otherwise.",
  },
  {
    icon: ShieldCheck,
    title: "SSO + audit trail",
    body: "Sign in with Unicorn Commander SSO. Every change is logged with who, when, and what.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
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
              <Button variant="ghost" size="sm">
                Sign in
              </Button>
            </Link>
            <Link href="/auth/login" className="hidden sm:inline-flex">
              <Button
                size="sm"
                className="bg-foreground text-background hover:bg-foreground/90"
              >
                Open dashboard
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-24 md:grid-cols-12 md:gap-16 md:py-32">
          <div className="md:col-span-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground/70">
              Part of the Unicorn Commander suite
            </div>
            <h1 className="mt-6 text-5xl font-semibold leading-[1.02] tracking-tight text-foreground sm:text-6xl md:text-[68px]">
              Project work,
              <br />
              <span className="text-foreground/55">delivered without the drama.</span>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-foreground/70">
              Project Ops keeps your team's work, your clients' visibility, and your operational
              paper trail in one calm, well-lit place.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link href="/auth/login">
                <Button
                  size="lg"
                  className="bg-foreground text-background hover:bg-foreground/90 px-7"
                >
                  Sign in
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              </Link>
              <a href="#features">
                <Button size="lg" variant="outline" className="px-7">
                  See what's inside
                </Button>
              </a>
            </div>
          </div>

          <div className="md:col-span-5">
            <div className="relative mx-auto aspect-square w-full max-w-md">
              <Image
                src="/projectops-crew-light.png"
                alt="Project Ops crew: a construction-helmet unicorn with blueprints, an exec unicorn with a tablet of charts, and an ops unicorn at a console — all in front of a project Gantt board."
                fill
                priority
                sizes="(max-width: 768px) 80vw, 40vw"
                className="object-contain block dark:hidden"
              />
              <Image
                src="/projectops-crew-dark.png"
                alt=""
                fill
                priority
                sizes="(max-width: 768px) 80vw, 40vw"
                className="object-contain hidden dark:block"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="mb-16 max-w-2xl">
            <div className="text-xs font-medium uppercase tracking-wider text-foreground/55">
              What's inside
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Everything a working team needs.
              <br />
              <span className="text-foreground/55">Nothing it doesn't.</span>
            </h2>
          </div>

          <div className="grid gap-x-12 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, body }) => (
              <div key={title} className="group">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors group-hover:border-foreground/30">
                  <Icon className="h-5 w-5" strokeWidth={1.5} />
                </div>
                <h3 className="mt-5 text-base font-semibold text-foreground">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-foreground/65">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-b border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="mb-16 max-w-2xl">
            <div className="text-xs font-medium uppercase tracking-wider text-foreground/55">
              How it works
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Set up in an afternoon.
              <br />
              <span className="text-foreground/55">Live for the next decade.</span>
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

      {/* Closing */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-3xl px-6 py-24 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Ready when you are.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-foreground/70">
            Sign in with your Magic Unicorn account to pick up where the team left off.
          </p>
          <div className="mt-8">
            <Link href="/auth/login">
              <Button
                size="lg"
                className="bg-foreground text-background hover:bg-foreground/90 px-7"
              >
                Sign in
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
