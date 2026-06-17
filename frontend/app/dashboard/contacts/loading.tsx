import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Route-level loading skeleton — shown the instant a navigation to the
// Contacts page starts, before the client component mounts and runs its
// own fetch. Mirrors the real page chrome (full-width header bar, summary
// stats, toolbar, table) so there's no layout shift when data arrives.
export default function ContactsLoading() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Skeleton className="h-12 w-12 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-4 w-64" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-10 w-28" />
              <Skeleton className="h-12 w-36" />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-6 py-8">
        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-4 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-10" />
            </Card>
          ))}
        </div>

        {/* Toolbar */}
        <Card className="mb-6 p-4">
          <div className="flex flex-wrap gap-3">
            <Skeleton className="h-10 flex-1 min-w-[200px]" />
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-10 w-40" />
          </div>
        </Card>

        {/* Table */}
        <Card>
          <TableSkeleton />
        </Card>
      </div>
    </div>
  );
}

/**
 * Skeleton rows that mirror the real contacts table: a leading
 * avatar+name block (always visible) plus the secondary columns that the
 * real table hides below `md`.
 */
function TableSkeleton() {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-6 py-4">
          {/* checkbox */}
          <Skeleton className="h-5 w-5 rounded shrink-0" />
          {/* avatar + name */}
          <Skeleton className="h-9 w-9 rounded-full shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton className="h-4 w-40 max-w-[60%]" />
            <Skeleton className="h-3 w-56 max-w-[80%]" />
          </div>
          {/* company / projects — secondary, hidden on mobile */}
          <Skeleton className="hidden md:block h-4 w-32" />
          <Skeleton className="hidden lg:block h-4 w-12" />
          {/* status pill */}
          <Skeleton className="h-6 w-16 rounded-full shrink-0" />
          {/* actions */}
          <Skeleton className="h-8 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}
