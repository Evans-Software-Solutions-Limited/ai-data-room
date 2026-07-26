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

// Added for the upload modal (T-014).

export function UploadIcon({ className }: { className?: string }) {
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
      <path d="M8 10.5V2.5" />
      <path d="M4.8 5.7 8 2.5l3.2 3.2" />
      <path d="M2.5 10.5v1.8A1.7 1.7 0 0 0 4.2 14h7.6a1.7 1.7 0 0 0 1.7-1.7v-1.8" />
    </svg>
  );
}

export function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M4 4 12 12" />
      <path d="M12 4 4 12" />
    </svg>
  );
}

export function CheckIcon({ className }: { className?: string }) {
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
      <path d="M3.3 8.5 6.3 11.5 12.7 5" />
    </svg>
  );
}

// Added for opportunity create/rename/archive (T-015).

export function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 3v10" />
      <path d="M3 8h10" />
    </svg>
  );
}
