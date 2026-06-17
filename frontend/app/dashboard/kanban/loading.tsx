import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Route-level loading skeleton — shown the instant a navigation to the Kanban
// board starts, before the client component mounts and runs its own fetch.
// Mirrors the in-page `loading` skeleton (filter bar + four columns of cards)
// so there's no layout shift when the real data arrives.
export default function KanbanLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-64" />
      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((col) => (
          <div key={col} className="space-y-3">
            <Skeleton className="h-9" />
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="p-3 space-y-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-24" />
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
