// Pick Six — icons and surface illustrations. Inline SVG strings, drawn on a 24px grid
// with a 2px stroke (icons) so they sit evenly next to text.

const svg = (body, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICON = {
  picks: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.6 2.6L16.5 9"/>'),
  board: svg('<path d="M4 20V13h5v7M9 20V8h6v12M15 20v-5h5v5M3 20h18"/>'),
  bracket: svg('<path d="M3 5h5v6H3M3 13h5v6H3M8 8h4v8H8M12 12h4M16 9h5v6h-5z"/>'),
  predict: svg('<circle cx="12" cy="11" r="7"/><path d="M8 20h8M9.5 17.5 8 20M14.5 17.5 16 20"/><path d="M9.5 9.5a3 3 0 0 1 3-2"/>'),
  standings: svg('<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 6h2M4 12h2M4 18h2"/>'),
  trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>'),
  star: svg('<path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9l-5.4 2.9 1.1-6.1L3.2 9.4l6.1-.8z"/>'),
  medal: svg('<circle cx="12" cy="15" r="5"/><path d="M8.5 11 6 3h4l2 5 2-5h4l-2.5 8"/><path d="m12 13 .8 1.6 1.7.2-1.2 1.2.3 1.7-1.6-.8-1.6.8.3-1.7-1.2-1.2 1.7-.2z"/>'),
  chart: svg('<path d="M4 20V4M4 20h16"/><path d="m7 15 4-4 3 3 5-6"/>'),
  whistle: svg('<circle cx="9" cy="14" r="5"/><path d="M12.5 10.5 21 7v4l-6.5 2.5M9 14h.01"/>'),
  flame: svg('<path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-1.5-2-1.5-3C7 10 6 12.5 6 15a6 6 0 0 0 6 6z"/>'),
  heart: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  calendar: svg('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  search: svg('<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>'),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>'),
  share: svg('<path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  dice: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01"/>'),
  back: svg('<path d="m15 5-7 7 7 7"/>'),
};

// Award category → icon
export const CAT_ICON = {
  season: ICON.trophy, stats: ICON.chart, staff: ICON.whistle, post: ICON.flame, character: ICON.heart, events: ICON.calendar,
};

// ---------------------------------------------------------------------------
// Surfaces: line drawings behind position layouts. Lines use currentColor.
// ---------------------------------------------------------------------------

const art = (vb, body, ratio = 'none') =>
  `<svg class="surface-art" viewBox="${vb}" preserveAspectRatio="${ratio}" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true">${body}</svg>`;

export const SURFACE = {
  // Half court, basket at the top.
  court: art('0 0 500 470', `
    <rect x="6" y="6" width="488" height="458" rx="6"/>
    <rect x="170" y="6" width="160" height="190"/>
    <circle cx="250" cy="196" r="60"/>
    <path d="M36 6v134M464 6v134M36 140A237 237 0 0 0 464 140"/>
    <path d="M220 46h60"/><circle cx="250" cy="60" r="9"/>
    <path d="M190 464a60 60 0 0 1 120 0"/>`),
  // Half rink, own net at the bottom.
  rink: art('0 0 500 600', `
    <path d="M6 6h488v514a74 74 0 0 1-74 74H80a74 74 0 0 1-74-74z"/>
    <path d="M6 200h488" stroke-width="6"/>
    <path d="M6 520h488"/><path d="M215 520a35 35 0 0 0 70 0"/><rect x="230" y="520" width="40" height="22" rx="4"/>
    <circle cx="140" cy="390" r="60"/><circle cx="360" cy="390" r="60"/>
    <circle cx="140" cy="390" r="5"/><circle cx="360" cy="390" r="5"/>`),
  // A stretch of field; yard lines across.
  field: art('0 0 900 400', `
    <rect x="3" y="3" width="894" height="394"/>
    ${[50, 100, 150, 200, 250, 300, 350].map((y) => `<path d="M3 ${y}h894" stroke-width="2"/>`).join('')}`),
  // Diamond with the outfield fence at the top.
  diamond: art('0 0 500 520', `
    <path d="M6 250A320 320 0 0 1 494 250"/>
    <path d="M250 440 60 250M250 440l190-190"/>
    <path d="M250 440 345 345 250 250 155 345z"/>
    <path d="M160 300a130 130 0 0 1 180 0"/>
    <circle cx="250" cy="345" r="18"/>
    <rect x="243" y="433" width="14" height="14" transform="rotate(45 250 440)"/>`),
};

// Small illustrations for empty states and the intro.
export const ILLO = {
  leagues: `<svg class="illo" viewBox="0 0 160 110" aria-hidden="true">
    <rect x="10" y="22" width="140" height="78" rx="12" fill="var(--lilac)"/>
    <rect x="26" y="38" width="54" height="10" rx="5" fill="var(--grape)"/>
    <rect x="26" y="56" width="92" height="8" rx="4" fill="var(--line-strong)"/>
    <rect x="26" y="72" width="70" height="8" rx="4" fill="var(--line-strong)"/>
    <circle cx="122" cy="26" r="16" fill="var(--gold)"/><path d="M114 26.5l5.5 5.5 9-10" stroke="var(--night)" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  picks: `<svg class="illo" viewBox="0 0 160 110" aria-hidden="true">
    <rect x="8" y="28" width="62" height="56" rx="10" fill="var(--lilac)" stroke="var(--grape)" stroke-width="3"/>
    <rect x="90" y="28" width="62" height="56" rx="10" fill="var(--surface-2)" stroke="var(--line-strong)" stroke-width="3"/>
    <circle cx="39" cy="50" r="12" fill="var(--grape)"/><circle cx="121" cy="50" r="12" fill="var(--line-strong)"/>
    <rect x="25" y="68" width="28" height="6" rx="3" fill="var(--grape)"/><rect x="107" y="68" width="28" height="6" rx="3" fill="var(--line-strong)"/>
    <text x="80" y="62" text-anchor="middle" font-family="var(--display)" font-weight="800" font-size="16" fill="var(--muted)">at</text>
  </svg>`,
};
