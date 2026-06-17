import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

// Mirrors the billing page in-page loading skeleton.
export default function BillingLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-72" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
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
      <Card className="space-y-3 p-6">
        <Skeleton className="h-5 w-40" />
        {[1, 2, 3].map((i) => (
          <SkeletonText key={i} lines={2} />
        ))}
      </Card>
    </div>
  );
}
