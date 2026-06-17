"use client";

import * as React from "react";
import {
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
  Check,
  BookmarkPlus,
  Bookmark,
  Users as UsersIcon,
  Trash2 as TrashIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  type SavedView,
  getAllViews,
  syncUserViews,
  createUserView,
  deleteUserView,
} from "@/lib/saved-views";
import { useState, useEffect, useCallback, useRef } from "react";

/**
 * One entry in a filter dropdown. `tone` (optional) drives a coloured
 * dot in the menu so STATUS / PRIORITY menus visually mirror the badge
 * palette used on the cards themselves.
 */
export interface FilterOption {
  value: string;
  label: string;
  /** Tailwind class for the colour dot, e.g. `"bg-amber-500"`. */
  dot?: string;
}

export interface FilterControl {
  key: string;
  label: string;
  /** Currently selected value. The string `"ALL"` is reserved for "no filter". */
  value: string;
  onChange: (next: string) => void;
  options: FilterOption[];
  /** Hide entirely if no choices to make (e.g. zero users). */
  hidden?: boolean;
}

export interface SortControlOption {
  value: string;
  label: string;
}

export interface SortControl {
  value: string;
  onChange: (next: string) => void;
  options: SortControlOption[];
}

export interface ListViewsControl {
  /** saved-views scope id ("projects" / "tasks" / etc). */
  scope: string;
  /** Current state snapshot to store when the user clicks "Save view". */
  current: Record<string, string>;
  /** Called with the saved view's state when the user clicks one. */
  onApply: (state: Record<string, string>) => void;
}

/** Legacy object form of the search prop (fires on every keystroke). */
export interface SearchControl {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

/** One sort field for the flat sort control. */
export interface SortFieldOption {
  value: string;
  label: string;
}

/**
 * ListToolbar props. Two equivalent ways to drive search + sort:
 *
 *  1. Legacy "object" form (used by the existing list pages, unchanged):
 *     `search={{ value, onChange, placeholder }}` and
 *     `sort={{ value, onChange, options }}` where `value` is a combined
 *     "field-dir" string. Search fires on every keystroke.
 *
 *  2. Flat form (recommended for server-driven lists). Provide a string
 *     `search` + `onSearchChange` (debounced before the callback fires), and
 *     `sortBy` + `sortDir` + `sortOptions` + `onSortChange` to separate the
 *     field from the direction. The page owns the state; the toolbar never
 *     does. Pass `searchDebounceMs` to tune the debounce (default 300ms).
 *
 * Both forms are backward-compatible — pages that pass neither get no search
 * / sort UI. `scope` (or `views.scope`) enables the DB-synced saved-views
 * dropdown; the `views` object supplies the apply handler + current snapshot.
 */
interface ListToolbarProps {
  /** Legacy object form OR (flat form) the current search string. */
  search?: SearchControl | string;
  /** Flat form: called with the (debounced) new search string. */
  onSearchChange?: (next: string) => void;
  /** Flat form: placeholder for the search input. */
  searchPlaceholder?: string;
  /** Flat form: debounce window in ms before `onSearchChange` fires (default 300). */
  searchDebounceMs?: number;

  filters?: FilterControl[];

  /** Legacy object form of the sort control (combined field-dir value). */
  sort?: SortControl;
  /** Flat form: current sort field. */
  sortBy?: string;
  /** Flat form: current sort direction. */
  sortDir?: "asc" | "desc";
  /** Flat form: selectable sort fields. */
  sortOptions?: SortFieldOption[];
  /** Flat form: called with the next field + direction. */
  onSortChange?: (sortBy: string, sortDir: "asc" | "desc") => void;

  /** DB-synced saved views: object form (apply handler + snapshot). */
  views?: ListViewsControl;
  /**
   * Flat convenience: saved-views scope. When `views` is also provided its
   * `scope` wins. Provided on its own it enables the dropdown read/apply but
   * the page must still supply `views` to save/apply (no state bridge here).
   */
  scope?: string;

  /** Optional right-aligned slot, e.g. a "View toggle" button group. */
  rightSlot?: React.ReactNode;
}

/**
 * Tinted single-select dropdown. The trigger shows the current label;
 * the menu shows checkmarks beside the active option. Falls back to a
 * dot-prefixed item when an option supplies one (status/priority menus).
 */
function FilterDropdown({ control }: { control: FilterControl }) {
  if (control.hidden) return null;
  const current = control.options.find((o) => o.value === control.value);
  const isActive = control.value !== "ALL";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={
            isActive
              ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
              : ""
          }
        >
          <span className="text-xs font-medium">{control.label}:</span>
          <span className="ml-1.5 text-xs">
            {current?.label ?? "All"}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[10rem]">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground px-2 py-1.5">
          Filter by {control.label.toLowerCase()}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {control.options.map((opt) => {
          const selected = opt.value === control.value;
          return (
            <DropdownMenuItem
              key={opt.value}
              onSelect={() => control.onChange(opt.value)}
              className="flex items-center gap-2 cursor-pointer"
            >
              {opt.dot ? (
                <span className={`inline-block h-2 w-2 rounded-full ${opt.dot}`} />
              ) : (
                <span className="inline-block h-2 w-2" />
              )}
              <span className="flex-1">{opt.label}</span>
              {selected && <Check className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortDropdown({ control }: { control: SortControl }) {
  const current = control.options.find((o) => o.value === control.value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <ArrowUpDown className="mr-1.5 h-3.5 w-3.5" />
          <span className="text-xs">{current?.label ?? "Sort"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground px-2 py-1.5">
          Sort by
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {control.options.map((opt) => {
          const selected = opt.value === control.value;
          return (
            <DropdownMenuItem
              key={opt.value}
              onSelect={() => control.onChange(opt.value)}
              className="flex items-center gap-2 cursor-pointer"
            >
              <span className="flex-1">{opt.label}</span>
              {selected && <Check className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Search input that debounces before calling back. Keeps its own immediate
 * value for a responsive field, then fires `onChange` once typing settles.
 * Used by the flat form (server-driven lists) so we don't fire a query per
 * keystroke. Stays in sync if the parent resets `value` externally (e.g. a
 * "clear filters" button or an applied saved view).
 */
function DebouncedSearchInput({
  value,
  onChange,
  placeholder,
  debounceMs = 300,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  debounceMs?: number;
}) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync if the parent changes `value` out from under us (saved view
  // applied, filters cleared). Guard against clobbering an in-flight edit:
  // only adopt the external value when it differs from what we'd emit.
  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const handle = useCallback(
    (next: string) => {
      setLocal(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => onChange(next), debounceMs);
    },
    [onChange, debounceMs],
  );

  const clear = useCallback(() => {
    setLocal("");
    if (timer.current) clearTimeout(timer.current);
    onChange("");
  }, [onChange]);

  return (
    <div className="relative flex-1 min-w-[14rem]">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        placeholder={placeholder ?? "Search…"}
        value={local}
        onChange={(e) => handle(e.target.value)}
        className="w-full rounded-md border border-input bg-background pl-10 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {local && (
        <button
          type="button"
          onClick={clear}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Flat sort control: a field dropdown plus an asc/desc toggle. Separates the
 * sort field from its direction (the legacy SortDropdown bakes both into one
 * combined value). Renders nothing if there are no options.
 */
function FlatSortControl({
  sortBy,
  sortDir,
  options,
  onChange,
}: {
  sortBy: string;
  sortDir: "asc" | "desc";
  options: SortFieldOption[];
  onChange: (sortBy: string, sortDir: "asc" | "desc") => void;
}) {
  if (options.length === 0) return null;
  const current = options.find((o) => o.value === sortBy);
  return (
    <div className="inline-flex items-center">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="rounded-r-none border-r-0">
            <ArrowUpDown className="mr-1.5 h-3.5 w-3.5" />
            <span className="text-xs">{current?.label ?? "Sort"}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[14rem]">
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground px-2 py-1.5">
            Sort by
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {options.map((opt) => {
            const selected = opt.value === sortBy;
            return (
              <DropdownMenuItem
                key={opt.value}
                onSelect={() => onChange(opt.value, sortDir)}
                className="flex items-center gap-2 cursor-pointer"
              >
                <span className="flex-1">{opt.label}</span>
                {selected && <Check className="h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="outline"
        size="sm"
        className="rounded-l-none px-2"
        onClick={() => onChange(sortBy, sortDir === "asc" ? "desc" : "asc")}
        title={sortDir === "asc" ? "Ascending — click for descending" : "Descending — click for ascending"}
        aria-label={sortDir === "asc" ? "Sort ascending" : "Sort descending"}
      >
        {sortDir === "asc" ? (
          <ArrowUp className="h-3.5 w-3.5" />
        ) : (
          <ArrowDown className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}

/** Best-effort current user id from the persisted session (UI ownership hint only). */
function currentUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("user");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.id === "string" ? parsed.id : null;
  } catch {
    return null;
  }
}

/**
 * Saved-views dropdown, backed by the DB-synced store. Paints instantly from
 * the localStorage cache (built-ins + cached user views), then refreshes from
 * the API on open. "Save current as view" prompts for a name and offers a
 * "shared" toggle (visible to the whole workspace). Owner-only views show a
 * delete affordance; built-ins and others' shared views don't.
 */
function ViewsDropdown({ views }: { views: ListViewsControl }) {
  const [allViews, setAllViews] = useState<SavedView[]>(() => getAllViews(views.scope));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const uid = currentUserId();

  const refresh = useCallback(() => {
    // Re-read built-ins + cache synchronously, then reconcile with the API.
    setAllViews(getAllViews(views.scope));
    syncUserViews(views.scope, uid).then((userViews) => {
      setAllViews([...getAllViews(views.scope).filter((v) => v.builtIn), ...userViews]);
    });
  }, [views.scope, uid]);

  // Refresh from the backend whenever the dropdown is opened (cheap, and
  // picks up views shared by teammates since last open).
  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleSave = useCallback(async () => {
    if (typeof window === "undefined") return;
    const name = window.prompt("Name this view:");
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    // Ask whether to share with the workspace (default = the last choice).
    const shared = window.confirm(
      "Share this view with everyone in the workspace?\n\nOK = shared · Cancel = just me",
    );
    setBusy(true);
    const created = await createUserView(views.scope, trimmed, views.current, {
      shared,
      currentUserId: uid,
    });
    setBusy(false);
    if (created) {
      setAllViews([...getAllViews(views.scope).filter((v) => v.builtIn), ...(await syncUserViews(views.scope, uid))]);
    } else if (typeof window !== "undefined") {
      window.alert("Couldn't save this view — the server was unreachable. Try again.");
    }
  }, [views.current, views.scope, uid]);

  const handleDelete = useCallback(
    async (id: string) => {
      setBusy(true);
      const ok = await deleteUserView(views.scope, id);
      setBusy(false);
      if (ok) {
        setAllViews([...getAllViews(views.scope).filter((v) => v.builtIn), ...(await syncUserViews(views.scope, uid))]);
      }
    },
    [views.scope, uid],
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Bookmark className="mr-1.5 h-3.5 w-3.5" />
          <span className="text-xs">Views</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[15rem]">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground px-2 py-1.5">
          Saved views
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {allViews.length === 0 && (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            No views yet. Configure filters + click below.
          </div>
        )}
        {allViews.map((v) => {
          // Deletable only when the caller owns it. ownedByMe is undefined
          // when we couldn't resolve the current user — in that case fall
          // back to "non-built-in" so owners aren't locked out (the server
          // still enforces owner-only delete).
          const canDelete = !v.builtIn && (v.ownedByMe ?? true);
          return (
            <DropdownMenuItem
              key={v.id}
              onSelect={() => views.onApply(v.state)}
              className="flex items-center gap-2 cursor-pointer"
            >
              <Bookmark className={`h-3.5 w-3.5 ${v.builtIn ? "text-muted-foreground" : "text-primary"}`} />
              <span className="flex-1 truncate">{v.name}</span>
              {v.shared && (
                <span title="Shared with the workspace">
                  <UsersIcon className="h-3 w-3 text-muted-foreground" />
                </span>
              )}
              {canDelete && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDelete(v.id);
                  }}
                  className="opacity-50 hover:opacity-100 hover:text-rose-600 disabled:opacity-30"
                  title="Delete view"
                  aria-label="Delete view"
                >
                  <TrashIcon className="h-3 w-3" />
                </button>
              )}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={busy}
          onSelect={(e) => {
            // Keep the menu open through the prompt flow.
            e.preventDefault();
            void handleSave();
          }}
          className="cursor-pointer"
        >
          <BookmarkPlus className="h-3.5 w-3.5 text-primary" />
          <span>{busy ? "Saving…" : "Save current as view…"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ListToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  searchDebounceMs,
  filters,
  sort,
  sortBy,
  sortDir,
  sortOptions,
  onSortChange,
  views,
  scope,
  rightSlot,
}: ListToolbarProps) {
  const visibleFilters = (filters ?? []).filter((f) => !f.hidden);
  const activeFilters = visibleFilters.filter((f) => f.value !== "ALL");
  const hasAnyActive = activeFilters.length > 0;

  // Normalize the search prop: a string means the flat form (debounced via
  // onSearchChange); an object is the legacy form (fires per keystroke).
  const flatSearch = typeof search === "string";
  const legacySearch = !flatSearch ? (search as SearchControl | undefined) : undefined;

  // Flat sort is active only when the field + handler are both provided.
  const hasFlatSort =
    sortBy !== undefined && onSortChange !== undefined && (sortOptions?.length ?? 0) > 0;

  // The saved-views control needs the object form (apply handler + snapshot).
  // A bare `scope` prop is accepted for the contract but can't drive save/apply
  // on its own; `views.scope` (when present) is authoritative.
  const viewsControl: ListViewsControl | undefined = views
    ? { ...views, scope: views.scope ?? scope ?? "" }
    : undefined;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {flatSearch && onSearchChange && (
          <DebouncedSearchInput
            value={search as string}
            onChange={onSearchChange}
            placeholder={searchPlaceholder}
            debounceMs={searchDebounceMs}
          />
        )}
        {legacySearch && (
          <div className="relative flex-1 min-w-[14rem]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder={legacySearch.placeholder ?? "Search…"}
              value={legacySearch.value}
              onChange={(e) => legacySearch.onChange(e.target.value)}
              className="w-full rounded-md border border-input bg-background pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )}
        {visibleFilters.map((f) => (
          <FilterDropdown key={f.key} control={f} />
        ))}
        {sort && <SortDropdown control={sort} />}
        {hasFlatSort && (
          <FlatSortControl
            sortBy={sortBy as string}
            sortDir={sortDir ?? "desc"}
            options={sortOptions as SortFieldOption[]}
            onChange={onSortChange as (s: string, d: "asc" | "desc") => void}
          />
        )}
        {viewsControl && <ViewsDropdown views={viewsControl} />}
        {rightSlot && <div className="ml-auto">{rightSlot}</div>}
      </div>

      {hasAnyActive && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground">Active:</span>
          {activeFilters.map((f) => {
            const opt = f.options.find((o) => o.value === f.value);
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => f.onChange("ALL")}
                className="group inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary border border-primary/30 px-2 py-0.5 text-[11px] font-medium hover:bg-primary/15 transition-colors"
                title={`Clear ${f.label} filter`}
              >
                <span className="text-muted-foreground/80">{f.label}:</span>
                <span>{opt?.label ?? f.value}</span>
                <X className="h-3 w-3 opacity-60 group-hover:opacity-100" />
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => activeFilters.forEach((f) => f.onChange("ALL"))}
            className="text-[11px] text-muted-foreground underline-offset-2 hover:underline px-1"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
