import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

// Mirrors the projects page in-page loading skeleton.
export default function ProjectsLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-64" />
      <Card className="p-4">
        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-10 flex-1 min-w-[200px]" />
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-40" />
        </div>
      </Card>
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
            <SkeletonText lines={2} />
          </Card>
        ))}
      </div>
    </div>
  );
}
