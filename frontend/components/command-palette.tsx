"use client";

/**
 * Cmd/Ctrl+K command palette — global jump-to + quick actions surface
 * for the dashboard. Searches Projects, Tasks, Contacts, and
 * Organizations from a single input; arrow keys navigate; Enter goes.
 *
 * Data is fetched lazily on first open (cheap when ranges are small;
 * we cap each query to 100 items). Results filter client-side as the
 * user types so latency is zero between keystrokes.
 *
 * Quick actions are always shown when the input is empty — give the
 * keyboard-first user a one-keystroke shortcut to the most-used
 * create flows.
 */

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  FolderKanban,
  CheckSquare,
  User as UserIcon,
  Building2,
  Plus,
  Loader2,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  Command as CommandIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import api from "@/lib/api";
import { projectColorClasses } from "@/lib/project-colors";
import { getRecent } from "@/lib/recently-visited";
import { useStarred } from "@/lib/starred";
import { Clock, Star as StarIcon } from "lucide-react";

interface PaletteResult {
  id: string;
  type: "project" | "task" | "contact" | "organization" | "action";
  title: string;
  subtitle?: string;
  href?: string;
  /** Optional click handler — taken instead of href when present. */
  onSelect?: () => void;
  /** lucide icon component */
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Tailwind colour class for the leading icon dot. */
  tone?: string;
  /** Search-match strings; not displayed. */
  match: string[];
}

const QUICK_ACTIONS_TONE = "text-violet-600 dark:text-violet-300";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [projects, setProjects] = useState<PaletteResult[]>([]);
  const [tasks, setTasks] = useState<PaletteResult[]>([]);
  const [contacts, setContacts] = useState<PaletteResult[]>([]);
  const [organizations, setOrganizations] = useState<PaletteResult[]>([]);
  const { starred } = useStarred();

  // Quick actions — always available, weight them after data when query
  // is non-empty so a bare-name search doesn't hide a real project.
  const quickActions: PaletteResult[] = useMemo(
    () => [
      {
        id: "new-project",
        type: "action",
        title: "New project",
        subtitle: "Open the Create Project modal",
        Icon: Plus,
        tone: QUICK_ACTIONS_TONE,
        match: ["new project", "create project", "add project"],
        onSelect: () => router.push("/dashboard/projects?new=1"),
      },
      {
        id: "new-task",
        type: "action",
        title: "New task",
        subtitle: "Open the Create Task modal on My Tasks",
        Icon: Plus,
        tone: QUICK_ACTIONS_TONE,
        match: ["new task", "create task", "add task"],
        onSelect: () => router.push("/dashboard/my-tasks?new=1"),
      },
      {
        id: "new-contact",
        type: "action",
        title: "New contact",
        subtitle: "Open the Create Contact modal",
        Icon: Plus,
        tone: QUICK_ACTIONS_TONE,
        match: ["new contact", "create contact", "add contact"],
        onSelect: () => router.push("/dashboard/contacts?new=1"),
      },
      {
        id: "go-schedule",
        type: "action",
        title: "Go to Schedule",
        subtitle: "Master Gantt timeline",
        Icon: CommandIcon,
        tone: QUICK_ACTIONS_TONE,
        match: ["schedule", "gantt", "timeline"],
        onSelect: () => router.push("/dashboard/schedule"),
      },
      {
        id: "go-kanban",
        type: "action",
        title: "Go to Kanban",
        subtitle: "Tasks board view",
        Icon: CommandIcon,
        tone: QUICK_ACTIONS_TONE,
        match: ["kanban", "board"],
        onSelect: () => router.push("/dashboard/kanban"),
      },
    ],
    [router],
  );

  // Lazy-load data on first open — and refresh every open so newly
  // created projects/tasks show up immediately.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      try {
        const [pRes, tRes, cRes, oRes] = await Promise.allSettled([
          api.get("/projects?page=1&limit=100"),
          api.get("/tasks/me?take=100").catch(() => api.get("/tasks?take=100")),
          api.get("/contacts?take=100"),
          api.get("/organizations"),
        ]);
        if (pRes.status === "fulfilled") {
          const items = pRes.value.data.data ?? pRes.value.data ?? [];
          setProjects(
            items.map((p: any) => ({
              id: `project-${p.id}`,
              type: "project" as const,
              title: p.title,
              subtitle: `${p.projectNumber} · ${p.clientName ?? ""}`.trim(),
              href: `/dashboard/projects/${p.id}`,
              Icon: FolderKanban,
              tone: projectColorClasses(p.id).badgeText,
              match: [p.title ?? "", p.projectNumber ?? "", p.clientName ?? ""],
            })),
          );
        }
        if (tRes.status === "fulfilled") {
          const items = Array.isArray(tRes.value.data)
            ? tRes.value.data
            : tRes.value.data.data ?? [];
          setTasks(
            items.slice(0, 100).map((t: any) => ({
              id: `task-${t.id}`,
              type: "task" as const,
              title: t.title,
              subtitle: t.project?.projectNumber
                ? `${t.project.projectNumber}${t.status ? " · " + t.status.replace(/_/g, " ").toLowerCase() : ""}`
                : t.status?.replace(/_/g, " ").toLowerCase() ?? undefined,
              href: t.projectId
                ? `/dashboard/projects/${t.projectId}`
                : "/dashboard/my-tasks",
              Icon: CheckSquare,
              tone: "text-amber-600 dark:text-amber-300",
              match: [t.title ?? "", t.description ?? "", t.project?.projectNumber ?? ""],
            })),
          );
        }
        if (cRes.status === "fulfilled") {
          const items = cRes.value.data.data ?? cRes.value.data ?? [];
          setContacts(
            items.slice(0, 100).map((c: any) => ({
              id: `contact-${c.id}`,
              type: "contact" as const,
              title: `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.email,
              subtitle: c.email,
              href: `/dashboard/contacts/${c.id}`,
              Icon: UserIcon,
              tone: "text-blue-600 dark:text-blue-300",
              match: [c.firstName ?? "", c.lastName ?? "", c.email ?? "", c.company ?? ""],
            })),
          );
        }
        if (oRes.status === "fulfilled") {
          const items = oRes.value.data.data ?? oRes.value.data ?? [];
          setOrganizations(
            items.slice(0, 100).map((o: any) => ({
              id: `org-${o.id}`,
              type: "organization" as const,
              title: o.name,
              subtitle: o.type ? o.type.toLowerCase() : undefined,
              href: `/dashboard/organizations/${o.id}`,
              Icon: Building2,
              tone: "text-emerald-600 dark:text-emerald-300",
              match: [o.name ?? "", o.taxId ?? "", o.industry ?? ""],
            })),
          );
        }
        setLoaded(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  // Reset query + active index when palette closes.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  // Compute filtered list per category. When query is empty, show top
  // few of each. When query is set, only return matches.
  const filteredAll = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (r: PaletteResult) =>
      q === "" || r.match.some((s) => s.toLowerCase().includes(q));

    const projectsHits = projects.filter(matches);
    const tasksHits = tasks.filter(matches);
    const contactsHits = contacts.filter(matches);
    const orgsHits = organizations.filter(matches);
    const actionsHits = quickActions.filter(matches);

    if (q === "") {
      // Empty query: Starred first (explicit pick), then Recent
      // (implicit jump-back), then Quick actions, then alphabetical
      // tail. Ordering matches user intent: "show me what I asked for,
      // then where I was, then what I can do."
      const starredItems: PaletteResult[] = projects
        .filter((p) => {
          // p.id is "project-<uuid>"; the actual project id is the
          // suffix used by the starred set.
          const pid = p.id.replace(/^project-/, "");
          return starred.has(pid);
        })
        .slice(0, 8)
        .map((p) => ({ ...p, id: `starred-${p.id}`, Icon: StarIcon, tone: "text-amber-500" }));
      const recent: PaletteResult[] = getRecent(undefined, 6).map((r) => ({
        id: `recent-${r.type}-${r.id}`,
        type: r.type as PaletteResult["type"],
        title: r.title,
        subtitle: r.subtitle,
        href: r.href,
        Icon: Clock,
        tone: "text-muted-foreground",
        match: [r.title ?? "", r.subtitle ?? ""],
      }));
      return [
        ...(starredItems.length > 0 ? [{ label: "Starred", items: starredItems }] : []),
        ...(recent.length > 0 ? [{ label: "Recent", items: recent }] : []),
        { label: "Quick actions", items: actionsHits },
        { label: "Projects", items: projectsHits.slice(0, 5) },
      ];
    }
    return [
      { label: "Projects", items: projectsHits.slice(0, 8) },
      { label: "Tasks", items: tasksHits.slice(0, 8) },
      { label: "Contacts", items: contactsHits.slice(0, 8) },
      { label: "Organisations", items: orgsHits.slice(0, 5) },
      { label: "Actions", items: actionsHits.slice(0, 5) },
    ].filter((s) => s.items.length > 0);
  }, [query, projects, tasks, contacts, organizations, quickActions]);

  // Flatten for keyboard navigation.
  const flatItems = useMemo(
    () => filteredAll.flatMap((s) => s.items),
    [filteredAll],
  );

  // Reset active index whenever the result set changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Keep the active item scrolled into view as ↑↓ moves through.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const select = useCallback(
    (item: PaletteResult) => {
      onOpenChange(false);
      if (item.onSelect) item.onSelect();
      else if (item.href) router.push(item.href);
    },
    [onOpenChange, router],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = flatItems[activeIndex];
        if (item) select(item);
      }
    },
    [flatItems, activeIndex, select],
  );

  // Build flat-index lookup so a section item can know its keyboard index.
  const indexMap = useMemo(() => {
    const m = new Map<string, number>();
    let i = 0;
    filteredAll.forEach((s) => {
      s.items.forEach((it) => {
        m.set(it.id, i);
        i += 1;
      });
    });
    return m;
  }, [filteredAll]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl p-0 gap-0 overflow-hidden"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search projects, tasks, contacts, or actions…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {loading && !loaded && (
            <Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />
          )}
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-2">
          {flatItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {loaded
                ? "No matches. Try a different search, or hit Esc to close."
                : "Loading…"}
            </div>
          ) : (
            filteredAll.map((section) => (
              <div key={section.label} className="mb-1">
                <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.label}
                </div>
                {section.items.map((item) => {
                  const idx = indexMap.get(item.id) ?? -1;
                  const isActive = idx === activeIndex;
                  const Icon = item.Icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-index={idx}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => select(item)}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                        isActive
                          ? "bg-primary/10 text-foreground"
                          : "hover:bg-muted/50 text-foreground"
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 ${item.tone ?? "text-muted-foreground"}`}
                        strokeWidth={1.75}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {item.title}
                        </div>
                        {item.subtitle && (
                          <div className="text-xs text-muted-foreground truncate">
                            {item.subtitle}
                          </div>
                        )}
                      </div>
                      {isActive && (
                        <CornerDownLeft className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-border px-4 py-2 flex items-center gap-4 text-[11px] text-muted-foreground bg-muted/30">
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded bg-background border border-border px-1 py-0.5 font-mono text-[10px]">
              <ArrowUp className="inline h-2.5 w-2.5" />
              <ArrowDown className="inline h-2.5 w-2.5" />
            </kbd>
            navigate
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded bg-background border border-border px-1.5 py-0.5 font-mono text-[10px]">
              ↵
            </kbd>
            select
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded bg-background border border-border px-1.5 py-0.5 font-mono text-[10px]">
              Esc
            </kbd>
            close
          </span>
          <span className="ml-auto">{flatItems.length} result{flatItems.length === 1 ? "" : "s"}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
