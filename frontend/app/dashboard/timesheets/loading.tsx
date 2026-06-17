import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Mirrors the timesheets page in-page loading skeleton.
export default function TimesheetsLoading() {
  return (
    <div className="space-y-4">
      {[1, 2].map((i) => (
        <Card key={i} className="space-y-3 p-6">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-8 w-40" />
          </div>
          {[1, 2, 3].map((j) => (
            <Skeleton key={j} className="h-9 w-full" />
          ))}
        </Card>
      ))}
    </div>
  );
}
