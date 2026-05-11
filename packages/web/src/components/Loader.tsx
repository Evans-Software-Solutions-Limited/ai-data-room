export function Loader() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex min-h-dvh items-center justify-center"
    >
      <span className="text-sm text-muted-foreground">Loading…</span>
    </div>
  );
}
