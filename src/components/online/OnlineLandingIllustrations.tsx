/**
 * Flat illustrations for the /online landing. Inline SVG only (no external
 * images), coloured from the brand tokens so they follow the site palette.
 */

const SKIN_A = "#E7B48F";
const SKIN_B = "#C68B63";
const SKIN_C = "#F0C8A6";
const HAIR = "#2B1D18";
const INK = "var(--ink)";
const BRAND = "var(--brand)";
const LAVENDER = "var(--lavender)";

type Props = { className?: string };

/** Short-haired man with a trimmed beard, head-and-shoulders, centred at (cx, cy). */
function Man({ cx, cy, s = 1, skin = SKIN_A, shirt = LAVENDER }: { cx: number; cy: number; s?: number; skin?: string; shirt?: string }) {
  return (
    <g transform={`translate(${cx} ${cy}) scale(${s})`}>
      <path d="M-46 70c4-30 22-44 46-44s42 14 46 44z" fill={shirt} />
      <path d="M-10 26h20v12a10 10 0 0 1-20 0z" fill={skin} />
      <circle cx="0" cy="0" r="28" fill={skin} />
      <path d="M-28-4c0-20 12-31 28-31s28 11 28 31c-5-9-14-14-28-14s-23 5-28 14z" fill={HAIR} />
      <path d="M-22 8c3 14 12 21 22 21s19-7 22-21c-6 6-13 8-22 8s-16-2-22-8z" fill={HAIR} opacity="0.85" />
      <circle cx="-10" cy="0" r="2.6" fill={INK} />
      <circle cx="10" cy="0" r="2.6" fill={INK} />
      <path d="M-6 13c4 3 8 3 12 0" stroke="#fff" strokeWidth="2" strokeLinecap="round" fill="none" />
    </g>
  );
}

/** Young man (student), no beard, centred at (cx, cy). */
function Boy({ cx, cy, s = 1, skin = SKIN_C, shirt = BRAND }: { cx: number; cy: number; s?: number; skin?: string; shirt?: string }) {
  return (
    <g transform={`translate(${cx} ${cy}) scale(${s})`}>
      <path d="M-42 66c4-28 20-40 42-40s38 12 42 40z" fill={shirt} />
      <path d="M-9 24h18v12a9 9 0 0 1-18 0z" fill={skin} />
      <circle cx="0" cy="0" r="26" fill={skin} />
      <path d="M-27 2c-3-22 10-33 27-33 15 0 27 8 27 25-8-8-18-12-30-10-9 1-17 7-24 18z" fill={HAIR} />
      <circle cx="-9" cy="3" r="2.4" fill={INK} />
      <circle cx="9" cy="3" r="2.4" fill={INK} />
      <path d="M-6 13c4 4 8 4 12 0" stroke={INK} strokeWidth="2" strokeLinecap="round" fill="none" />
    </g>
  );
}

/** Young woman in a hijab, centred at (cx, cy). */
function GirlHijab({ cx, cy, s = 1, skin = SKIN_B, scarf = BRAND, top = LAVENDER }: { cx: number; cy: number; s?: number; skin?: string; scarf?: string; top?: string }) {
  return (
    <g transform={`translate(${cx} ${cy}) scale(${s})`}>
      <path d="M-44 68c4-28 20-40 44-40s40 12 44 40z" fill={top} />
      <path d="M-33 2c0-21 15-35 33-35s33 14 33 35v20c0 12-14 22-33 22s-33-10-33-22z" fill={scarf} />
      <ellipse cx="0" cy="4" rx="20" ry="23" fill={skin} />
      <circle cx="-8" cy="3" r="2.4" fill={INK} />
      <circle cx="8" cy="3" r="2.4" fill={INK} />
      <path d="M-5 13c3 3 7 3 10 0" stroke={INK} strokeWidth="2" strokeLinecap="round" fill="none" />
    </g>
  );
}

/** Hero: a male teacher teaching on a laptop video call, with a student in the corner tile. */
export function OnlineHeroIllustration({ className = "h-auto w-full" }: Props) {
  return (
    <svg viewBox="0 0 480 380" className={className} role="img" aria-hidden="true" direction="ltr">
      <circle cx="250" cy="185" r="165" fill={LAVENDER} opacity="0.14" />
      <circle cx="400" cy="70" r="26" fill={BRAND} opacity="0.12" />
      <circle cx="78" cy="300" r="18" fill={LAVENDER} opacity="0.25" />
      {/* laptop */}
      <rect x="92" y="62" width="300" height="196" rx="16" fill={INK} />
      <rect x="104" y="74" width="276" height="172" rx="10" fill="#F7F1F5" />
      <path d="M60 262h364l-18 30H78z" fill="#D9CFD6" />
      <rect x="210" y="262" width="64" height="8" rx="4" fill="#BFB2BB" />
      {/* teacher tile with a small board */}
      <rect x="120" y="88" width="148" height="44" rx="6" fill="#FFFFFF" />
      <path d="M130 104h56M130 116h72" stroke={LAVENDER} strokeWidth="5" strokeLinecap="round" />
      <text x="226" y="122" fontSize="22" fontWeight="700" fill={BRAND} fontFamily="Manrope, sans-serif">x²</text>
      <clipPath id="famyHeroScreen">
        <rect x="104" y="74" width="276" height="172" rx="10" />
      </clipPath>
      <g clipPath="url(#famyHeroScreen)">
        <Man cx={196} cy={186} s={1.05} />
      </g>
      {/* student tile */}
      <rect x="290" y="150" width="78" height="84" rx="10" fill="#FFFFFF" stroke={BRAND} strokeWidth="3" />
      <clipPath id="famyHeroStudent">
        <rect x="290" y="150" width="78" height="84" rx="10" />
      </clipPath>
      <g clipPath="url(#famyHeroStudent)">
        <Boy cx={329} cy={196} s={0.62} />
      </g>
      {/* live badge */}
      <rect x="116" y="216" width="58" height="20" rx="10" fill={BRAND} />
      <circle cx="129" cy="226" r="4" fill="#fff" />
      <text x="138" y="230.5" fontSize="11" fontWeight="700" fill="#fff" fontFamily="Manrope, sans-serif">LIVE</text>
      {/* floating chat and star */}
      <g>
        <rect x="372" y="96" width="84" height="40" rx="14" fill="#FFFFFF" stroke="#EADDE5" />
        <circle cx="392" cy="116" r="5" fill={BRAND} />
        <circle cx="410" cy="116" r="5" fill={LAVENDER} />
        <circle cx="428" cy="116" r="5" fill={BRAND} opacity="0.5" />
      </g>
      <g transform="translate(46 132)">
        <circle r="24" fill="#FFFFFF" stroke="#EADDE5" />
        <path d="M0-12l3.6 7.4 8.2 1.2-5.9 5.8 1.4 8.1L0 6.6l-7.3 3.9 1.4-8.1-5.9-5.8 8.2-1.2z" fill="#F5B301" />
      </g>
    </svg>
  );
}

/** Step 1: choosing a tutor from a list. */
export function StepChooseTutor({ className = "h-28 w-auto" }: Props) {
  return (
    <svg viewBox="0 0 160 120" className={className} role="img" aria-hidden="true" direction="ltr">
      <circle cx="80" cy="60" r="56" fill={LAVENDER} opacity="0.14" />
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(26 ${18 + i * 30})`}>
          <rect width="108" height="24" rx="12" fill="#FFFFFF" stroke={i === 0 ? BRAND : "#EADDE5"} strokeWidth={i === 0 ? 2 : 1} />
          <rect x="34" y="7" width={i === 0 ? 50 : 40} height="4" rx="2" fill={i === 0 ? BRAND : "#D9CFD6"} />
          <rect x="34" y="14" width="28" height="3" rx="1.5" fill="#E6DDE3" />
        </g>
      ))}
      <clipPath id="famyStep1a"><circle cx="40" cy="30" r="10" /></clipPath>
      <g clipPath="url(#famyStep1a)"><circle cx="40" cy="30" r="10" fill="#F7F1F5" /><Man cx={40} cy={30} s={0.3} /></g>
      <clipPath id="famyStep1b"><circle cx="40" cy="60" r="10" /></clipPath>
      <g clipPath="url(#famyStep1b)"><circle cx="40" cy="60" r="10" fill="#F7F1F5" /><Man cx={40} cy={60} s={0.3} skin={SKIN_B} shirt={BRAND} /></g>
      <clipPath id="famyStep1c"><circle cx="40" cy="90" r="10" /></clipPath>
      <g clipPath="url(#famyStep1c)"><circle cx="40" cy="90" r="10" fill="#F7F1F5" /><GirlHijab cx={40} cy={91} s={0.3} /></g>
      <circle cx="128" cy="30" r="9" fill={BRAND} />
      <path d="M124 30l3 3 5-6" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/** Step 2: the tutor confirms, then the student pays. */
export function StepConfirmPay({ className = "h-28 w-auto" }: Props) {
  return (
    <svg viewBox="0 0 160 120" className={className} role="img" aria-hidden="true" direction="ltr">
      <circle cx="80" cy="60" r="56" fill={BRAND} opacity="0.08" />
      <rect x="30" y="34" width="86" height="56" rx="10" fill={INK} />
      <rect x="30" y="46" width="86" height="10" fill="#4A3A43" />
      <rect x="40" y="68" width="30" height="6" rx="3" fill="#8C7A85" />
      <rect x="92" y="66" width="14" height="10" rx="2" fill="#F5B301" />
      <circle cx="116" cy="38" r="18" fill="#FFFFFF" stroke="#EADDE5" />
      <path d="M108 38l6 6 10-11" stroke="#1F9D63" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/** Step 3: joining the live lesson from a phone (student in hijab) or a laptop. */
export function StepJoinLesson({ className = "h-28 w-auto" }: Props) {
  return (
    <svg viewBox="0 0 160 120" className={className} role="img" aria-hidden="true" direction="ltr">
      <circle cx="80" cy="60" r="56" fill={LAVENDER} opacity="0.14" />
      <rect x="20" y="30" width="78" height="52" rx="6" fill={INK} />
      <rect x="25" y="35" width="68" height="42" rx="3" fill="#F7F1F5" />
      <clipPath id="famyStep3a"><rect x="25" y="35" width="68" height="42" rx="3" /></clipPath>
      <g clipPath="url(#famyStep3a)"><Man cx={59} cy={66} s={0.42} /></g>
      <path d="M12 84h94l-6 8H18z" fill="#D9CFD6" />
      <rect x="104" y="34" width="38" height="66" rx="8" fill={INK} />
      <rect x="108" y="40" width="30" height="52" rx="4" fill="#F7F1F5" />
      <clipPath id="famyStep3b"><rect x="108" y="40" width="30" height="52" rx="4" /></clipPath>
      <g clipPath="url(#famyStep3b)"><GirlHijab cx={123} cy={68} s={0.36} /></g>
      <circle cx="123" cy="96" r="2" fill="#8C7A85" />
    </svg>
  );
}
