"use client";

/**
 * The Help center — a left topic-nav (categories) + a content panel, with a
 * search box on top that filters across every article client-side.
 *
 * Layout
 *   - Search empty  → browse mode: pick a category in the left rail, read its
 *     articles in the panel (the active category's articles render as expandable
 *     accordion cards; the first is open).
 *   - Search typed  → result mode: the panel shows matching articles (open),
 *     grouped under their category, with the matched count in the header.
 *
 * Deep links
 *   - `?c=<categoryId>`          selects a category in browse mode.
 *   - `?c=<cat>&a=<articleId>`   selects a category AND opens that article.
 *   These are written to the URL (replaceState) as the user navigates so a
 *   particular article is shareable. Other dashboard pages can therefore link
 *   straight to e.g. `/dashboard/help?c=webhooks&a=webhooks-overview`.
 *
 * Hydration: the URL params are read in a mount effect (never during render),
 * and the search box is uncontrolled-until-mounted via `useHydrated()`, so the
 * server render and the first client render agree (no React #418).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { iconWellClass } from "@/lib/badge-styles";
import { useHydrated } from "@/lib/use-hydrated";
import {
  HELP_CATEGORIES,
  HELP_ARTICLE_COUNT,
  searchHelp,
  type HelpCategory,
  type HelpArticle,
  type HelpIconName,
} from "@/lib/help-content";
import { HelpArticleBody } from "./help-article-body";
import {
  Search,
  X,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  LifeBuoy,
  // icons referenced by help-content categories:
  Rocket,
  FolderKanban,
  LayoutGrid,
  CalendarRange,
  Repeat,
  SlidersHorizontal,
  Zap,
  Webhook,
  LineChart,
  Gauge,
  Clock,
  Building2,
  Bell,
  Bookmark,
  UserCircle,
  KeyRound,
  Keyboard,
} from "lucide-react";

/** Map the content file's icon name → a lucide component. */
const ICONS: Record<HelpIconName, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  Rocket,
  FolderKanban,
  LayoutGrid,
  CalendarRange,
  Repeat,
  SlidersHorizontal,
  Zap,
  Webhook,
  LineChart,
  Gauge,
  Clock,
  Building2,
  Bell,
  Bookmark,
  UserCircle,
  KeyRound,
  Keyboard,
};

// A small, deterministic colour rotation for the category icon-wells so the
// rail reads as colourful without anyone hand-assigning a tone per category.
const TONES = ["blue", "violet", "emerald", "amber", "rose", "orange"] as const;
const toneFor = (i: number) => TONES[i % TONES.length];

/** One expandable article card (used in both browse and search modes). */
function ArticleCard({
  category,
  article,
  open,
  onToggle,
  showCategory = false,
}: {
  category: HelpCategory;
  article: HelpArticle;
  open: boolean;
  onToggle: () => void;
  showCategory?: boolean;
}) {
  return (
    <Card id={`a-${article.id}`} className="overflow-hidden scroll-mt-24">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/40"
      >
        <div className="min-w-0 flex-1">
          {showCategory && (
            <div className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {category.title}
            </div>
          )}
          <h3 className="text-[15px] font-semibold text-foreground">{article.title}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{article.summary}</p>
        </div>
        <ChevronDown
          className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="border-t border-border/60 px-5 py-4">
          <HelpArticleBody blocks={article.body} />
          {article.route && (
            <div className="mt-5 border-t border-border/60 pt-4">
              <Link
                href={article.route}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                {article.routeLabel ?? "Open"}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function HelpCenter() {
  const hydrated = useHydrated();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState<string>(HELP_CATEGORIES[0].id);
  const [openArticleId, setOpenArticleId] = useState<string | null>(null);
  // Remember the article the user explicitly opened in browse mode so it stays
  // open across re-renders; defaults to the active category's first article.
  const userPickedRef = useRef(false);

  // Read deep-link params once on mount (never during render → no hydration
  // mismatch). `?c=` selects a category, `?a=` opens an article within it.
  useEffect(() => {
    const c = searchParams.get("c");
    const a = searchParams.get("a");
    if (c && HELP_CATEGORIES.some((cat) => cat.id === c)) {
      setActiveCategoryId(c);
    }
    if (a) {
      setOpenArticleId(a);
      userPickedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const results = useMemo(() => searchHelp(query), [query]);
  const isSearching = query.trim().length > 0;

  const activeCategory =
    HELP_CATEGORIES.find((c) => c.id === activeCategoryId) ?? HELP_CATEGORIES[0];

  // In browse mode, default the open article to the active category's first,
  // unless the user has explicitly opened a different one.
  const browseOpenId =
    openArticleId && activeCategory.articles.some((a) => a.id === openArticleId)
      ? openArticleId
      : activeCategory.articles[0]?.id ?? null;

  // Keep the shareable URL in sync with browse state (replace, no history spam).
  // Guarded to browse mode + after hydration so we never touch the URL server-side.
  useEffect(() => {
    if (!hydrated || isSearching) return;
    const params = new URLSearchParams();
    params.set("c", activeCategoryId);
    if (userPickedRef.current && browseOpenId) params.set("a", browseOpenId);
    const next = `${pathname}?${params.toString()}`;
    window.history.replaceState(null, "", next);
  }, [hydrated, isSearching, activeCategoryId, browseOpenId, pathname]);

  function selectCategory(id: string) {
    setActiveCategoryId(id);
    setOpenArticleId(null);
    userPickedRef.current = false;
    // Bring the panel back to the top on a category switch.
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleBrowseArticle(id: string) {
    userPickedRef.current = true;
    setOpenArticleId((cur) => (cur === id ? "__none__" : id));
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className={`inline-flex h-10 w-10 items-center justify-center rounded-md ${iconWellClass("blue")}`}>
          <LifeBuoy className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Help center</h1>
          <p className="mt-1 text-muted-foreground">
            Learn how Project Ops works — {HELP_ARTICLE_COUNT} guides across{" "}
            {HELP_CATEGORIES.length} topics.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-2xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help — try “webhook”, “capacity”, “⌘K”, “invoice”…"
          aria-label="Search help articles"
          className="pl-9 pr-9"
        />
        {isSearching && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {isSearching ? (
        /* ── Search results ─────────────────────────────────────────────── */
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {results.length === 0
              ? "No matches."
              : `${results.length} result${results.length === 1 ? "" : "s"} for “${query.trim()}”`}
          </p>
          {results.length === 0 ? (
            <Card className="px-5 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                Nothing matched. Try a different word, or clear the search to browse all topics.
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {results.map(({ category, article }) => (
                <ArticleCard
                  key={`${category.id}/${article.id}`}
                  category={category}
                  article={article}
                  open
                  onToggle={() => {}}
                  showCategory
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ── Browse: topic rail + content panel ─────────────────────────── */
        <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
          {/* Topic nav */}
          <nav aria-label="Help topics" className="lg:sticky lg:top-20 lg:self-start">
            <Card className="overflow-hidden p-2">
              <div className="space-y-0.5">
                {HELP_CATEGORIES.map((cat, i) => {
                  const Icon = ICONS[cat.icon];
                  const isActive = cat.id === activeCategoryId;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => selectCategory(cat.id)}
                      aria-current={isActive ? "page" : undefined}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-foreground/[0.06] text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <span
                        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                          isActive ? iconWellClass(toneFor(i)) : "text-muted-foreground"
                        }`}
                      >
                        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                      </span>
                      <span className="flex-1 truncate">{cat.title}</span>
                      {isActive && <ChevronRight className="h-4 w-4 shrink-0 opacity-50" />}
                    </button>
                  );
                })}
              </div>
            </Card>
          </nav>

          {/* Content panel */}
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-foreground">{activeCategory.title}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{activeCategory.blurb}</p>
            </div>
            <div className="space-y-3">
              {activeCategory.articles.map((article) => (
                <ArticleCard
                  key={article.id}
                  category={activeCategory}
                  article={article}
                  open={browseOpenId === article.id}
                  onToggle={() => toggleBrowseArticle(article.id)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
