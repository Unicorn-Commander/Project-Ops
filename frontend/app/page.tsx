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
  Sparkles,
} from "lucide-react";

const features = [
  {
    icon: KanbanSquare,
    title: "Projects & tasks",
    body: "Track work end-to-end: project status, priority, due dates, milestones, and a kanban board for in-flight tasks.",
  },
  {
    icon: Users,
    title: "Roles that match real teams",
    body: "Admins, managers, staff, and clients each see exactly what they should — no toggling, no accidents.",
  },
  {
    icon: Building2,
    title: "Client portal",
    body: "Invite a client to a private portal to follow their project, share documents, and stay in the loop without email chaos.",
  },
  {
    icon: FileText,
    title: "Document workspace",
    body: "Upload files, attach them to projects or tasks, and share with the right people. Backed by S3-compatible storage.",
  },
  {
    icon: Bell,
    title: "Notifications that respect you",
    body: "Email when a task is assigned to you, a project changes status, or a deadline is near. Quiet otherwise.",
  },
  {
    icon: ShieldCheck,
    title: "SSO + audit trail",
    body: "Sign in with Unicorn Commander SSO. Every change is logged with who, when, and what — ready for review.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/logo-mark.svg" alt="Project Ops" width={36} height={36} priority />
            <div className="leading-tight">
              <div className="text-base font-semibold tracking-tight">Project Ops</div>
              <div className="text-[11px] uppercase tracking-wider text-foreground/60">
                by Magic Unicorn
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/auth/login">
              <Button variant="ghost">Sign in</Button>
            </Link>
            <Link href="/auth/login" className="hidden sm:inline-flex">
              <Button>
                Open dashboard
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-60 dark:opacity-40"
          style={{
            background:
              "radial-gradient(60% 50% at 70% 0%, color-mix(in oklab, var(--color-primary) 30%, transparent) 0%, transparent 70%)",
          }}
        />
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-20 md:grid-cols-12 md:gap-12 md:py-28">
          {/* Copy */}
          <div className="md:col-span-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground/70">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Part of the Unicorn Commander suite
            </div>
            <h1 className="mt-6 text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-5xl md:text-6xl">
              Run projects without losing the thread.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-foreground/75">
              Project Ops keeps your team's work, your clients' visibility, and your operational
              paper trail in one calm, well-lit place. Built by Magic Unicorn for teams that deliver.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/auth/login">
                <Button size="lg" className="px-7">
                  Sign in
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              </Link>
              <a href="#features">
                <Button size="lg" variant="outline" className="px-7">
                  Tour the features
                </Button>
              </a>
            </div>
          </div>

          {/* Illustration — light variant by default, dark variant in dark mode */}
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
      <section id="features" className="border-t border-border bg-muted/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Everything a working team needs. Nothing it doesn't.
            </h2>
            <p className="mt-4 text-foreground/70">
              Six primitives that cover real project work — set up to stay out of your way until
              they earn your attention.
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="group rounded-xl border border-border bg-card p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/10 hover:border-primary/40"
              >
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-foreground">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-foreground/70">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Closing band */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-20 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Designed to be the calm in your operations.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-foreground/70">
            Sign in with your Magic Unicorn account to pick up where the team left off.
          </p>
          <div className="mt-8">
            <Link href="/auth/login">
              <Button size="lg" className="px-7">
                Sign in
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-muted/40">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-foreground/65 sm:flex-row">
          <div className="flex items-center gap-2">
            <Image src="/logo-mark.svg" alt="" width={18} height={18} />
            <span>
              &copy; {new Date().getFullYear()} Magic Unicorn. Built with care.
            </span>
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
