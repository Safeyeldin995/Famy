/**
 * Animated splash mark — the Y in Famy curves into a smile.
 * Uses CSS brand tokens so it stays in sync when the logo PNG is updated.
 */
export function FamySplashMark() {
  return (
    <div className="famy-splash-mark" aria-hidden="true">
      <svg viewBox="0 0 280 96" className="h-28 w-auto sm:h-32" role="img">
        <text
          x="0"
          y="72"
          className="famy-splash-word"
          fontFamily="Manrope, ui-sans-serif, system-ui, sans-serif"
          fontSize="72"
          fontWeight="800"
          fill="white"
        >
          Fam
        </text>
        <g className="famy-splash-y" transform="translate(168, 0)">
          <path
            className="famy-splash-y-stroke"
            d="M 28 8 L 14 72"
            fill="none"
            stroke="white"
            strokeWidth="14"
            strokeLinecap="round"
          />
          <path
            className="famy-splash-y-stroke famy-splash-y-stroke-delay"
            d="M 28 8 L 42 72"
            fill="none"
            stroke="white"
            strokeWidth="14"
            strokeLinecap="round"
          />
          <path
            className="famy-splash-smile"
            d="M 10 78 Q 28 96 46 78"
            fill="none"
            stroke="white"
            strokeWidth="10"
            strokeLinecap="round"
          />
        </g>
      </svg>
    </div>
  );
}
