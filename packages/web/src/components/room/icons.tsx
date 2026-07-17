// Inline SVG icons for the datum/room shell. No icon library is installed
// that covers this (no lucide-react in the repo; `@tabler/icons-react` and
// `radix-ui` icons exist but don't include a filled "ink" brand diamond),
// so these are hand-drawn to match the prototype's glyphs exactly, per the
// T-013 build spec's icon guidance.

export function BrandDiamond({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 1.2 14.8 8 8 14.8 1.2 8Z" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

export function StatusDot({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 8 8"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <circle cx="4" cy="4" r="4" />
    </svg>
  );
}
