import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Mirrors the utilization page in-page loading skeleton.
export default function UtilizationLoading() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-9 w-80" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-16" />
              </div>
              <Skeleton className="h-10 w-10 rounded-lg" />
            </div>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2].map((i) => (
          <Card key={i} className="p-6 space-y-4">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-64 w-full" />
          </Card>
        ))}
      </div>
      <Card className="p-6 space-y-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-72 w-full" />
      </Card>
    </div>
  );
}
