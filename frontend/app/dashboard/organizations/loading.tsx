import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Route-level loading skeleton — shown the instant a navigation to the
// Organizations page starts, before the client component mounts and runs
// its own fetch. Mirrors the real page chrome (header, stat cards,
// toolbar, table) so there's no layout shift when data arrives.
export default function OrganizationsLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-10 w-28" />
          <Skeleton className="h-10 w-44" />
        </div>
      </div>

      {/* Statistics cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <Card key={i} className="p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-8 w-12" />
              </div>
              <Skeleton className="h-12 w-12 rounded-lg" />
            </div>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-10 flex-1 min-w-[200px]" />
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-40" />
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="divide-y divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-6 py-4">
              {/* checkbox */}
              <Skeleton className="h-5 w-5 rounded shrink-0" />
              {/* icon + name */}
              <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
              <div className="flex-1 min-w-0 space-y-2">
                <Skeleton className="h-4 w-48 max-w-[70%]" />
              </div>
              {/* type pill */}
              <Skeleton className="h-6 w-20 rounded-full shrink-0" />
              {/* industry / contacts / projects — secondary, hidden on mobile */}
              <Skeleton className="hidden md:block h-4 w-24" />
              <Skeleton className="hidden lg:block h-4 w-12" />
              <Skeleton className="hidden lg:block h-4 w-12" />
              {/* status pill */}
              <Skeleton className="h-6 w-16 rounded-full shrink-0" />
              {/* actions */}
              <Skeleton className="h-8 w-24 shrink-0" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
