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
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/logo-mark.svg" alt="Project Ops" width={36} height={36} priority />
            <div className="leading-tight">
              <div className="text-base font-semibold tracking-tight">Project Ops</div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                by Magic Unicorn
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/auth/login">
              <Button variant="ghost">Sign in</Button>
            </Link>
            <Link href="/auth/login">
              <Button className="hidden sm:inline-flex">
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
          className="pointer-events-none absolute inset-0 -z-10 opacity-70 dark:opacity-50"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 0%, color-mix(in oklab, var(--color-primary) 28%, transparent) 0%, transparent 70%)",
          }}
        />
        <div className="mx-auto max-w-5xl px-6 py-24 md:py-32 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Part of the Unicorn Commander suite
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl">
            Run projects without losing the thread.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Project Ops keeps your team's work, your clients' visibility, and your operational paper trail
            in one calm, well-lit place. Built by Magic Unicorn for teams that deliver.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
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
      </section>

      {/* Features */}
      <section id="features" className="border-t border-border/60 bg-muted/30">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Everything a working team needs. Nothing it doesn't.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Six primitives that cover real project work — set up to stay out of your way until
              they earn your attention.
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="group rounded-xl border border-border/70 bg-card p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/5 hover:border-primary/40"
              >
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Closing band */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-5xl px-6 py-20 text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Designed to be the calm in your operations.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
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
      <footer className="border-t border-border/60 bg-muted/30">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <Image src="/logo-mark.svg" alt="" width={18} height={18} />
            <span>
              &copy; {new Date().getFullYear()} Magic Unicorn. Built with care.
            </span>
          </div>
          <div className="flex items-center gap-5">
            <a
              href="https://unicorncommander.ai"
              className="hover:text-foreground transition-colors"
              target="_blank"
              rel="noreferrer"
            >
              Unicorn Commander
            </a>
            <a
              href="https://magicunicorn.dev"
              className="hover:text-foreground transition-colors"
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
