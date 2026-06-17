import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Route-level loading skeleton — shown the instant a navigation to Documents
// starts, before the client component mounts and runs its own fetch. Mirrors
// the in-page layout (header + 4 stat cards + toolbar + table) so there's no
// layout shift when the real data arrives.
export default function DocumentsLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-md" />
              <div className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-6 w-12" />
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-10 min-w-[200px] flex-1" />
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-40" />
        </div>
      </Card>

      {/* Document list */}
      <Card className="space-y-3 p-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-4 w-16 sm:block" />
            <Skeleton className="hidden h-4 w-20 md:block" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
        ))}
      </Card>
    </div>
  );
}
