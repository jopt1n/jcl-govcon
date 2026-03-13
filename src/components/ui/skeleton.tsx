import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded bg-[var(--border-subtle)] dark:bg-[var(--border)]",
        className
      )}
    />
  );
}
