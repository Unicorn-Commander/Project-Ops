import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

// Route-level skeleton for the projects list. Mirrors the real layout in
// page.tsx — action row, the five status stat cards, the filter toolbar,
// then a stack of project cards — so the navigation transition doesn't
// shift when the client component mounts and renders its own loading view.
export default function ProjectsLoading() {
  return (
    <div className="space-y-6">
      {/* Action row */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Skeleton className="h-4 w-64" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      {/* Stat cards — match the 2-up mobile / 5-up desktop grid + p-4 cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <Card key={i} className="p-4 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-10" />
          </Card>
        ))}
      </div>

      {/* Filter toolbar */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-10 flex-1 min-w-[200px]" />
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-40" />
        </div>
      </Card>

      {/* Project cards */}
      <div className="grid gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="p-6 space-y-3 border-l-4 border-l-foreground/10">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
            <Skeleton className="h-5 w-2/3" />
            <SkeletonText lines={2} />
          </Card>
        ))}
      </div>
    </div>
  );
}
