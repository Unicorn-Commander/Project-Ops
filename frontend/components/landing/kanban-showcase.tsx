/**
 * Inline kanban showcase for the marketing site.
 *
 * This is a *visual replica* of the real kanban board, hand-built with the
 * same Card/Badge primitives so the landing page reflects the product
 * exactly — no separate screenshots to keep in sync, the styling drifts
 * when the app drifts.
 *
 * Static data (no fetching). The cards reference real ongoing Magic Unicorn
 * projects from memory, so anyone landing on the page sees what an actual
 * Project Ops board looks like in flight rather than placeholder text.
 */
import {
  statusBadgeClass,
  priorityTextClass,
} from "@/lib/badge-styles";

type Card = {
  number: string;
  title: string;
  client: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  due?: string;
  assignee: { initials: string; name: string };
};

type Column = {
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  label: string;
  cards: Card[];
};

const COLUMNS: Column[] = [
  {
    status: "PENDING",
    label: "New",
    cards: [
      {
        number: "P-00012",
        title: "Strix laptop sync model alignment",
        client: "Magic Unicorn",
        priority: "MEDIUM",
        due: "May 12",
        assignee: { initials: "AS", name: "Aaron" },
      },
      {
        number: "P-00009",
        title: "Migrate Project-Ops to GFL instance",
        client: "Brightwater Labs",
        priority: "HIGH",
        due: "May 8",
        assignee: { initials: "SK", name: "Shafen" },
      },
    ],
  },
  {
    status: "IN_PROGRESS",
    label: "In progress",
    cards: [
      {
        number: "P-00001",
        title: "Brigade ↔ Project-Ops MCP integration",
        client: "Magic Unicorn",
        priority: "HIGH",
        due: "May 5",
        assignee: { initials: "AS", name: "Aaron" },
      },
      {
        number: "P-00002",
        title: "Build In Public — Tuesday show prep",
        client: "Magic Unicorn",
        priority: "MEDIUM",
        due: "May 6",
        assignee: { initials: "SK", name: "Shafen" },
      },
      {
        number: "P-00007",
        title: "Majiks Music wedge content",
        client: "Majiks Music",
        priority: "MEDIUM",
        assignee: { initials: "AS", name: "Aaron" },
      },
    ],
  },
  {
    status: "COMPLETED",
    label: "Completed",
    cards: [
      {
        number: "P-00005",
        title: "Email-Ops v0.1 macOS notarization",
        client: "Magic Unicorn",
        priority: "LOW",
        assignee: { initials: "AS", name: "Aaron" },
      },
    ],
  },
];

const AVATAR_TONES: Record<string, string> = {
  AS: "bg-violet-500/20 text-violet-700 dark:text-violet-300",
  SK: "bg-amber-500/20  text-amber-700  dark:text-amber-300",
};

export function KanbanShowcase() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-foreground/5">
      {/* Window-chrome top strip — three dots + a fake address */}
      <div className="flex items-center gap-3 border-b border-border bg-foreground/[0.02] px-4 py-3">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
        </div>
        <div className="flex-1 truncate rounded-md bg-background px-3 py-1 text-center text-[11px] font-mono text-muted-foreground">
          projectops.magicunicorn.dev/dashboard/kanban
        </div>
        <div className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          live
        </div>
      </div>

      {/* Board */}
      <div className="bg-background">
        <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-3 md:gap-5">
          {COLUMNS.map((col) => (
            <div key={col.status} className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(col.status)}`}>
                    {col.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {col.cards.length}
                  </span>
                </div>
                <span className="text-foreground/30 text-base leading-none">＋</span>
              </div>
              <div className="space-y-2.5">
                {col.cards.map((card) => (
                  <div
                    key={card.number}
                    className="group cursor-default rounded-lg border border-border bg-card p-3.5 shadow-sm transition-shadow hover:shadow-md"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {card.number}
                      </span>
                      <span className={`text-[10px] font-semibold uppercase tracking-wider ${priorityTextClass(card.priority)}`}>
                        {card.priority}
                      </span>
                    </div>
                    <h4 className="mt-2 text-[13px] font-semibold leading-snug text-foreground">
                      {card.title}
                    </h4>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {card.client}
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ring-2 ring-card ${
                          AVATAR_TONES[card.assignee.initials] ??
                          "bg-foreground/10 text-foreground"
                        }`}
                        title={card.assignee.name}
                      >
                        {card.assignee.initials}
                      </span>
                      {card.due && (
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          Due {card.due}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
