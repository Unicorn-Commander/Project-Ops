import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

// Route-level skeleton for the project detail page. Mirrors the in-page
// loading state in [id]/page.tsx so the navigation transition (before the
// client component mounts and fetches) shows the same shape — header,
// two-thirds main column, one-third sidebar.
export default function ProjectDetailLoading() {
  return (
    <div className="space-y-6">
      {/* Header: back button + title + action */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-md" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: project + client + budget + tasks */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6 space-y-3">
            <Skeleton className="h-5 w-40" />
            <SkeletonText lines={4} />
          </Card>
          {/* Budget panel placeholder — two bars */}
          <Card className="p-6 space-y-4">
            <Skeleton className="h-5 w-24" />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-10" />
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-10" />
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          </Card>
          <Card className="p-6 space-y-3">
            <Skeleton className="h-5 w-32" />
            {[1, 2, 3].map((i) => (
              <SkeletonText key={i} lines={2} />
            ))}
          </Card>
        </div>

        {/* Right: management + activity */}
        <div className="space-y-6">
          <Card className="p-6 space-y-3">
            <Skeleton className="h-5 w-24" />
            <SkeletonText lines={5} />
          </Card>
        </div>
      </div>
    </div>
  );
}
