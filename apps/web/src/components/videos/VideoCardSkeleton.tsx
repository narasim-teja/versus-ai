import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

export function VideoCardSkeleton() {
  return (
    <Card>
      <Skeleton className="h-40 w-full rounded-b-none rounded-t-xl" />
      <CardHeader className="pb-2 pt-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-14" />
        </div>
      </CardHeader>
      <CardContent className="pb-4 pt-0">
        <Skeleton className="mb-2 h-3 w-full" />
        <div className="flex gap-3">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-20" />
        </div>
      </CardContent>
    </Card>
  );
}
