import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Route-level loading skeleton — shown the instant a navigation to Timesheets
// starts, before the client component mounts and hydrates the auth store.
// Mirrors the default "My timesheet" layout (subtitle + week navigator +
// weekly grid) so there's no layout shift when the real data arrives.
export default function TimesheetsLoading() {
  return (
    <div className="space-y-6">
      {/* Subtitle + (manager) tab toggle */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-7 w-44 rounded-md" />
      </div>

      {/* Week navigator + submit */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-9 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-9 rounded-md" />
          <Skeleton className="ml-2 h-5 w-48" />
        </div>
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>

      {/* Weekly grid */}
      <Card className="space-y-3 overflow-hidden p-6">
        <div className="flex gap-2">
          <Skeleton className="h-4 w-40" />
          <div className="ml-auto flex gap-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-8" />
            ))}
          </div>
        </div>
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </Card>
    </div>
  );
}
