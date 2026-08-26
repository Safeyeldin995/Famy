/** Flat mini-illustrations for category tiles — decorative, not line icons. */
export function CategoryIllustration({ slug, className = "h-16 w-16" }: { slug: string; className?: string }) {
  switch (slug) {
    case "home-cleaning":
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <rect x="8" y="28" width="48" height="24" rx="6" fill="#D8E8FF" />
          <rect x="14" y="34" width="10" height="14" rx="2" fill="#6BA3FF" />
          <path d="M36 38h14v10H36z" fill="#FF8A65" />
          <circle cx="22" cy="20" r="8" fill="#FFD59A" />
          <rect x="18" y="24" width="28" height="6" rx="3" fill="#9ADBC5" />
        </svg>
      );
    case "babysitting":
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <circle cx="32" cy="22" r="10" fill="#FFD59A" />
          <path d="M18 48c2-10 10-14 14-14s12 4 14 14" fill="#FFB4C4" />
          <circle cx="48" cy="40" r="8" fill="#D8E8FF" />
          <rect x="44" y="44" width="8" height="10" rx="2" fill="#6BA3FF" />
        </svg>
      );
    case "elderly-care":
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <circle cx="24" cy="20" r="9" fill="#E8D4FF" />
          <path d="M12 48c2-8 8-12 12-12s10 4 12 12" fill="#B388FF" />
          <rect x="38" y="30" width="16" height="18" rx="4" fill="#FFD59A" />
          <path d="M42 36h8v6h-8z" fill="#FF8A65" />
        </svg>
      );
    case "cooking":
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <ellipse cx="32" cy="40" rx="20" ry="10" fill="#FFE0B2" />
          <rect x="22" y="18" width="20" height="14" rx="4" fill="#FF8A65" />
          <path d="M26 14c0-4 4-6 6-6s6 2 6 6" stroke="#5D4037" strokeWidth="2" fill="none" />
          <circle cx="46" cy="36" r="4" fill="#9ADBC5" />
        </svg>
      );
    case "tutoring":
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <rect x="14" y="16" width="36" height="28" rx="4" fill="#D8E8FF" />
          <rect x="20" y="22" width="24" height="4" rx="2" fill="#6BA3FF" />
          <rect x="20" y="30" width="18" height="4" rx="2" fill="#9ADBC5" />
          <circle cx="48" cy="46" r="6" fill="#FFD59A" />
        </svg>
      );
    case "pet-care":
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <ellipse cx="32" cy="42" rx="18" ry="10" fill="#FFE0B2" />
          <circle cx="22" cy="24" r="5" fill="#8D6E63" />
          <circle cx="32" cy="18" r="5" fill="#8D6E63" />
          <circle cx="42" cy="24" r="5" fill="#8D6E63" />
          <circle cx="28" cy="30" r="3" fill="#FF8A65" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <rect x="12" y="20" width="40" height="32" rx="8" fill="#D8E8FF" />
          <path d="M20 32h24M20 40h16" stroke="#6BA3FF" strokeWidth="3" strokeLinecap="round" />
          <circle cx="32" cy="14" r="6" fill="#FFD59A" />
        </svg>
      );
  }
}
