/** Original WAR CATS line icons. Decorative SVGs inherit their accessible button label. */
const paths = {
  building:'<path d="M4 22V4h16v18M2 22h20M9 22v-6h6v6M8 8h2m4 0h2M8 12h2m4 0h2"/>',
  build:'<path d="M2 5h20v5H2zM2 10h20v5H2zM2 15h20v5H2zM9 5v5m7 0v5M9 15v5"/>',
  supply:'<path d="m3 7 9-4 9 4v13H3V7Zm0 0 9 4 9-4M12 11v9M8 5l9 4"/>',
  map:'<path d="m2 6 6-3 8 3 6-3v15l-6 3-8-3-6 3V6Zm6-3v15m8-12v15"/>',
  move:'<path d="M12 2v20M2 12h20m-13-7 3-3 3 3m-10 4-3 3 3 3m4 4 3 3 3-3m4-10 3 3-3 3"/>',

  transport: '<path d="M3 16V9h11l4 4h3v6H3v-3Zm1-7 2-4h7l2 4M7 9v5m7-5v5H3"/><circle cx="7" cy="19" r="2"/><circle cx="17" cy="19" r="2"/>',
  helicopter: '<path d="M8 10h8l4 4v3H8l-4-3V9L1 6m10 4V6M4 5h17M9 20h12M11 17v3m7-3v3M16 10v7M8 14H3"/>',
  palette: '<path d="M3 6 12 2l9 4v12l-9 4-9-4V6Zm0 0 9 5 9-5M12 11v11"/><path d="m7 4 10 5M6 12l3 2m6 1 3-2"/>',
  settings: '<path d="M5 3v18M12 3v18M19 3v18"/><path d="M2 8h6M9 16h6M16 7h6" stroke-width="3"/>',
  arrow: '<path d="M5 19 19 5M6 5h13v13"/>',
  enter: '<path d="M19 4v10H5m5-5-5 5 5 5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  target: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/><circle cx="12" cy="12" r="1"/>',
  terrain: '<path d="m2 19 6-12 4 7 3-10 7 15H2Z"/><path d="m5 13 3 2 2-2m3-2 2 2 2-2"/>',
  rifle: '<path d="M2 10h5V8h8v2h7v3h-8l-1 5h-3l1-5H7l-5 3v-6Zm7-2V5h5v3m1 2v3"/>',
  shield: '<path d="m12 2 8 3v6c0 5-4 8-8 11-4-3-8-6-8-11V5l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  medical: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z"/>',
  pause: '<path d="M8 4v16M16 4v16" stroke-width="3"/>',
  jump: '<path d="m5 10 7-7 7 7M12 3v15M4 21h16"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
  wallet: '<path d="M20 8V5H4a2 2 0 0 0-2 2v12h18V8H4a2 2 0 0 1 0-4"/><path d="M15 11h7v5h-7z"/><circle cx="18" cy="13.5" r=".5"/>',
  hammer: '<path d="m3 21 9-9 3 3-9 9m4-14 5-5 7 7-3 3-3-3-3 3-3-3Z"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  rotate: '<path d="M20 8a9 9 0 1 0 1 8M20 3v6h-6"/>',
  lock: '<rect x="5" y="10" width="14" height="12" rx="1"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v3"/>',
  flag: '<path d="M5 22V3h14l-3 5 3 5H5"/>',
  skull: '<path d="M8 21v-4a8 8 0 1 1 8 0v4H8Z"/><path d="M10 18v3m4-3v3"/><circle cx="9" cy="11" r="1"/><circle cx="15" cy="11" r="1"/>',
} as const;
export type IconName = keyof typeof paths;
export const icon = (name: IconName, className = '') => `<svg class="ui-icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;

export function scopeReticle() {
  const marks = Array.from({ length: 6 }, (_, i) => {
    const n = (i + 1) * 30, h = i % 2 ? 8 : 5;
    return `<path d="M${500 - h} ${500 + n}h${h * 2}M${500 - h} ${500 - n}h${h * 2}M${500 + n} ${500 - h}v${h * 2}M${500 - n} ${500 - h}v${h * 2}"/>`;
  }).join('');
  return `<div id="scope-overlay" class="scope-overlay" hidden><svg class="scope-glass" viewBox="0 0 1000 1000" aria-hidden="true"><circle class="scope-edge" cx="500" cy="500" r="485"/><g class="scope-reticle" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M15 500h470m30 0h470M500 15v470m0 30v470"/>${marks}<circle cx="500" cy="500" r="1.7" fill="currentColor" stroke="none"/></g><g class="scope-numbers" fill="currentColor"><text x="516" y="564">2</text><text x="516" y="624">4</text><text x="516" y="684">6</text></g></svg><div class="scope-readout"><span id="scope-zoom">6×</span><span id="scope-steady">SHIFT · ESTABILIZAR</span><span>RODA DO MOUSE · ZOOM</span></div></div>`;
}

/** Side profiles are drawn separately so an operator can recognize the kit at a glance. */
export function weaponIcon(id: string, className = '') {
  const common = '<path d="M43 24h52M49 21h39" opacity=".5"/>';
  const profiles: Record<string, string> = {
    ar: '<path d="M8 21h22l8-5h45v2h30v7H83l-15 3-4 13H54l3-14H38L8 35V21Z"/><path d="M83 18v7m8-7v7m7-7v7m7-7v7m8-5h27v3h-27M39 17v-4h38v4M45 28v7h9M66 28l-1 10h12l3-11"/><path d="M8 20v17m131-19v7M58 13V8h10v5"/>',
    smg: '<path d="M18 21h20v-5h53v9H65l-3 18H51l3-17H38l-20 8V21Z"/><path d="M91 18h28v5H91m-47-7v-4h17v4m-20 9v9h12M17 19v16m104-18v7M66 17v8m8-8v8m8-8v8"/>',
    dmr: '<path d="M7 22h27l6-5h47v2h26v5H87l-15 4-3 12H58l3-14H37L7 35V22Z"/><path d="M113 20h36v3h-36M48 11h28v5H48V11Zm-7-3h10v10H41V8Zm35 1h8v8h-8M47 28v7h10m15-8v11h12V26m-77-6v17"/>',
    ak: '<path d="M6 23h25l10-6h50l10 3h23v5H88l-22 2-4 13H52l3-14H36L6 35V23Z"/><path d="M69 27q4 11 14 17l9-5q-9-8-10-13M98 18v9m5-8v7m8-7v7m13-5h24v3h-24M46 17l3-6h10m-20 16v8h13M6 21v16m140-21v8"/>',
    lmg: '<path d="M6 22h26l9-7h51v3h25v7H91l-17 3-5 13H58l3-14H39L6 34V22Z"/><path d="M69 29h25v14H69V29Zm48-10h29v5h-29m-42-9V8H51v7m67 10-7 17m12-17 7 17M49 27v8h8M6 20v16m136-20v9"/>',
    m40: '<path d="M7 22h32l9-4h41l8 3h33v5H78l-8 5-5 11H55l3-15H37L7 37V22Z"/><path d="M130 22h24v3h-24M48 10h35v7H48V10Zm-6-2h9v11h-9V8Zm41 0h11v11H83M69 18v-5m7 9 8 6m-36 0v8h8M7 20v19m112-13-6 17m11-17 7 17"/>',
    awm: '<path d="M5 20h24v-5h17v5h52v2h29v5H81l-11 5-3 10H55l3-15H38L5 37V20Z"/><path d="M11 25h16v5H11V25Zm36-15h36v7H47V10Zm-7-3h10v13H40V7Zm43 0h12v13H83M127 23h28v3h-28M73 29v11h15V28m-37-1v8h5m65-8-7 16m12-16 7 16m-76-23v9"/>',
    shotgun: '<path d="M7 22h27l11-5h34l10 3h46v8H80l-15-1-5 13H50l4-14H36L7 36V22Z"/><path d="M81 21v7m6-7v7m6-7v7m6-7v7m6-7v7m6-7v7m6-7v7m6-7v7m12-8h15v4h-15M43 27v8h7M7 20v18m137-22v6"/>',
    pistol: '<path d="M40 11h62v11H77l-6 23H51l7-23H40V11Z"/><path d="M40 12v8m5-8v8m5-8v8m5-8v8m-7-9V7h5v4m43 0V8h5v3M77 23v13H74m-16-5h12m-13 5h12m-14 5h13"/>',
    rpg: '<path d="M8 22h28v-6h18v6h62v8H54l-8 14H32l6-14H8V22Z"/><path d="M116 20h28v6h-28M54 16V9h22v7M22 18v16m94-16-6 18m14-18 6 18"/>',
    knife: '<path d="M18 28h28l8-4 72-3v8L54 32H18Z"/><path d="M18 24v12m10-12v12m8-4 6 10M118 24l18-8v20l-18-8"/>',
  };
  return `<svg class="weapon-profile ${className}" viewBox="0 0 160 50" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true" focusable="false">${profiles[id] ?? profiles.ar}${id === 'pistol' ? '' : common}</svg>`;
}
