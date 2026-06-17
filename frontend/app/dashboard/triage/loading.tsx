import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

// Route-level loading skeleton — shown the instant a navigation to Triage
// starts, before the client component mounts and runs its own fetch. Mirrors
// the in-page layout (header + hero "Needs a project" card) so there's no
// layout shift when the real data arrives.
export default function TriageLoading() {
  return (
    <div className="space-y-6">
      {/* Header — icon well + title/subtitle + refresh */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-start gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-80" />
          </div>
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>

      {/* Hero section card */}
      <Card className="space-y-4 p-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-72" />
          </div>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-2 rounded-xl border border-border/70 p-4">
            <Skeleton className="h-4 w-2/3" />
            <SkeletonText lines={2} />
            <Skeleton className="h-8 w-64" />
          </div>
        ))}
      </Card>
    </div>
  );
}
