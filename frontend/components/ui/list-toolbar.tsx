"use client";

import * as React from "react";
import { Search, ArrowUpDown, X, Check, BookmarkPlus, Bookmark, Trash2 as TrashIcon } from "lucide-react";
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
  loadUserViews,
  saveUserViews,
} from "@/lib/saved-views";
import { useState, useEffect, useCallback } from "react";

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
  /** localStorage scope id ("projects" / "tasks" / etc). */
  scope: string;
  /** Current state snapshot to store when the user clicks "Save view". */
  current: Record<string, string>;
  /** Called with the saved view's state when the user clicks one. */
  onApply: (state: Record<string, string>) => void;
}

interface ListToolbarProps {
  search?: {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
  };
  filters?: FilterControl[];
  sort?: SortControl;
  views?: ListViewsControl;
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

function ViewsDropdown({ views }: { views: ListViewsControl }) {
  const [tick, setTick] = useState(0);
  const [allViews, setAllViews] = useState<SavedView[]>(() => getAllViews(views.scope));

  // Re-pull when the user adds or deletes a view.
  useEffect(() => {
    setAllViews(getAllViews(views.scope));
  }, [tick, views.scope]);

  const handleSave = useCallback(() => {
    if (typeof window === "undefined") return;
    const name = window.prompt("Name this view:");
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const userViews = loadUserViews(views.scope);
    const id = `u-${Date.now().toString(36)}`;
    saveUserViews(views.scope, [...userViews, { id, name: trimmed, state: views.current }]);
    setTick((t) => t + 1);
  }, [views.current, views.scope]);

  const handleDelete = useCallback(
    (id: string) => {
      const userViews = loadUserViews(views.scope);
      saveUserViews(views.scope, userViews.filter((v) => v.id !== id));
      setTick((t) => t + 1);
    },
    [views.scope],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Bookmark className="mr-1.5 h-3.5 w-3.5" />
          <span className="text-xs">Views</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground px-2 py-1.5">
          Saved views
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {allViews.length === 0 && (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            No views yet. Configure filters + click below.
          </div>
        )}
        {allViews.map((v) => (
          <DropdownMenuItem
            key={v.id}
            onSelect={() => views.onApply(v.state)}
            className="flex items-center gap-2 cursor-pointer"
          >
            <Bookmark className={`h-3.5 w-3.5 ${v.builtIn ? "text-muted-foreground" : "text-primary"}`} />
            <span className="flex-1">{v.name}</span>
            {!v.builtIn && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDelete(v.id);
                }}
                className="opacity-50 hover:opacity-100 hover:text-rose-600"
                title="Delete view"
                aria-label="Delete view"
              >
                <TrashIcon className="h-3 w-3" />
              </button>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleSave} className="cursor-pointer">
          <BookmarkPlus className="h-3.5 w-3.5 text-primary" />
          <span>Save current as view…</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ListToolbar({
  search,
  filters,
  sort,
  views,
  rightSlot,
}: ListToolbarProps) {
  const visibleFilters = (filters ?? []).filter((f) => !f.hidden);
  const activeFilters = visibleFilters.filter((f) => f.value !== "ALL");
  const hasAnyActive = activeFilters.length > 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {search && (
          <div className="relative flex-1 min-w-[14rem]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder={search.placeholder ?? "Search…"}
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              className="w-full rounded-md border border-input bg-background pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )}
        {visibleFilters.map((f) => (
          <FilterDropdown key={f.key} control={f} />
        ))}
        {sort && <SortDropdown control={sort} />}
        {views && <ViewsDropdown views={views} />}
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
