import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

// Route-level loading skeleton — shown the instant a navigation to My Tasks
// starts, before the client component mounts and runs its own fetch. Mirrors
// the in-page `loading` skeleton (stat row + list card) so there's no layout
// shift when the real data arrives.
export default function MyTasksLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-64" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-7 w-10" />
              </div>
              <Skeleton className="h-10 w-10 rounded-lg" />
            </div>
          </Card>
        ))}
      </div>
      <Card className="p-6 space-y-3">
        <Skeleton className="h-5 w-40" />
        {[1, 2, 3].map((i) => (
          <SkeletonText key={i} lines={2} />
        ))}
      </Card>
    </div>
  );
}
