/** Celebratory flat illustration for booking-confirmed milestone screens. */
export function BookingSuccessIllustration({ className = "h-40 w-40" }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 160" className={className} aria-hidden="true">
      <circle cx="80" cy="80" r="72" fill="oklch(0.94 0.04 25)" />
      <circle cx="80" cy="52" r="18" fill="#FFD59A" />
      <path d="M56 92c6-14 16-18 24-18s18 4 24 18" fill="#FFB4C4" />
      <rect x="58" y="98" width="44" height="34" rx="8" fill="oklch(0.74 0.16 25)" opacity="0.9" />
      <rect x="66" y="106" width="28" height="6" rx="3" fill="white" opacity="0.5" />
      <circle cx="108" cy="118" r="14" fill="#9ADBC5" />
      <path d="M104 118l3 3 7-8" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
