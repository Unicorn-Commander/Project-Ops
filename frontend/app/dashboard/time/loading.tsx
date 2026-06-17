import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Mirrors the time-entries page in-page loading skeleton.
export default function TimeLoading() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="p-4">
            <Skeleton className="mb-2 h-3 w-24" />
            <Skeleton className="h-7 w-16" />
          </Card>
        ))}
      </div>
      <Card className="space-y-3 p-6">
        <Skeleton className="h-5 w-40" />
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </Card>
    </div>
  );
}
