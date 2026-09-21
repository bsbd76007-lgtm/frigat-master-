/**
 * Slot machine — injected stylesheet.
 *
 * This project ships no utility CSS framework, so the cabinet carries its own
 * rules and `useInjectedStyles` mounts them once per page.
 */

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────

export const STYLE_ID = 'fg-slot-machine-styles';

export const CSS = `
.slot { display: flex; flex-direction: column; align-items: center; gap: 24px;
  width: 100%; max-width: 1180px; margin-inline: auto; padding: 10px;
  box-sizing: border-box; color: var(--fg-text);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (min-width: 1024px) {
  .slot { flex-direction: row; align-items: flex-start; justify-content: center; }
}

/* ── Cabinet ───────────────────────────────── */
.slot__cabinet { position: relative; width: 100%; max-width: 760px; min-width: 0;
  padding: 12px; box-sizing: border-box; border-radius: var(--fg-r-lg);
  background: linear-gradient(180deg, #1b2735 0%, #0d141c 100%);
  border: 1px solid #253243;
  box-shadow: 0 30px 60px -20px rgba(0,0,0,.75), inset 0 1px 0 rgba(255,255,255,.06); }

.slot__marquee { display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin-bottom: 14px; padding: 0 4px; }
/* Solid gold, not clipped gradient text. At 15px with .18em tracking a three-stop
   gradient reads as a muddy shimmer rather than as gilding, and a transparent colour
   leaves the marquee invisible anywhere background-clip is unavailable or
   overridden (forced-colors, older WebKit). Same call the header lockup already
   made when its gilding moved into the SVG. */
.slot__title { margin: 0; font-size: 15px; font-weight: 900; letter-spacing: .18em;
  text-transform: uppercase; color: var(--fg-gold); }
.slot__meta { display: flex; gap: 8px; }
.slot__chip { padding: 4px 6px; font-size: 11px; font-weight: 800; letter-spacing: .06em;
  text-transform: uppercase; color: var(--fg-muted); background: rgba(148,163,184,.12);
  border: 1px solid rgba(148,163,184,.2); border-radius: var(--fg-r);
  font-variant-numeric: tabular-nums; }
.slot__chip--win { color: var(--fg-bg); background: var(--fg-accent); border-color: var(--fg-accent); }

.slot__screen { position: relative; width: 100%; aspect-ratio: 5 / 3;
  border-radius: var(--fg-r-lg); overflow: hidden; background: #070b11;
  border: 3px solid #2c3a4c;
  box-shadow: inset 0 0 44px rgba(0,0,0,.85); }
.slot__canvas { display: block; width: 100%; height: 100%; }

/* Win banner rides over the reels without stealing a click from SPIN. */
.slot__flash { position: absolute; inset: auto 0 0 0; padding: 10px;
  text-align: center; font-size: 15px; font-weight: 900; letter-spacing: .04em;
  color: var(--fg-bg); background: linear-gradient(90deg, rgba(250,204,21,.94), rgba(34,197,94,.94));
  pointer-events: none; animation: slot-flash-in .35s ease both; }
@keyframes slot-flash-in { from { transform: translateY(100%); } to { transform: translateY(0); } }

/* ── Panel ─────────────────────────────────── */
.slot__panel { display: flex; flex-direction: column; gap: 16px; width: 100%;
  max-width: 760px; min-width: 0; flex: 0 0 auto; padding: 16px; box-sizing: border-box;
  background: var(--fg-panel); border: var(--fg-edge); border-radius: var(--fg-r-lg); }
@media (min-width: 1024px) { .slot__panel { width: 340px; } }

.slot__label { display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 8px; font-size: 11px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: var(--fg-dim); }
.slot__label b { font-size: 13px; color: var(--fg-gold); letter-spacing: 0;
  font-variant-numeric: tabular-nums; }

.slot__inputs { display: flex; gap: 6px; }
.slot__input { flex: 1 1 auto; min-width: 0; width: 100%; box-sizing: border-box;
  padding: 8px 8px; font-family: inherit; font-size: 15px; font-weight: 700;
  font-variant-numeric: tabular-nums; color: var(--fg-text); background: var(--fg-sunken);
  border: 1px solid var(--fg-line); border-radius: var(--fg-r-lg); outline: none;
  transition: border-color var(--fg-t), box-shadow var(--fg-t); }
.slot__input:focus-visible { border-color: var(--fg-accent); box-shadow: var(--fg-ring); }
.slot__input:disabled { opacity: .5; cursor: not-allowed; }

.slot__quick { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;
  margin-top: 8px; }
.slot__mod { padding: 10px 4px; font-family: inherit; font-size: 12px; font-weight: 800;
  color: var(--fg-muted); background: var(--fg-sunken); border: 1px solid var(--fg-line); border-radius: var(--fg-r-lg);
  cursor: pointer; transition: background var(--fg-t), color var(--fg-t), transform var(--fg-t); }
.slot__mod:hover:not(:disabled) { color: #fff; background: var(--fg-line); }
.slot__mod:active:not(:disabled) { transform: translateY(1px); }
.slot__mod:focus-visible { outline: none; box-shadow: var(--fg-ring); }
.slot__mod:disabled { opacity: .45; cursor: not-allowed; }

/* ── SPIN ──────────────────────────────────── */
.slot__spin { position: relative; width: 100%; padding: 12px; overflow: hidden;
  font-family: inherit; font-size: 18px; font-weight: 900; letter-spacing: .12em;
  text-transform: uppercase; color: var(--fg-bg);
  background: linear-gradient(90deg, var(--fg-accent), var(--fg-accent-deep)); border: none;
  border-radius: var(--fg-r-lg); cursor: pointer;
  box-shadow: 0 12px 24px -6px rgba(34,197,94,.5);
  transition: background var(--fg-t), box-shadow var(--fg-t), transform var(--fg-t); }
.slot__spin:hover:not(:disabled) { background: linear-gradient(90deg, var(--fg-pos), var(--fg-accent));
  box-shadow: 0 16px 30px -6px rgba(34,197,94,.7); }
.slot__spin:active:not(:disabled) { transform: translateY(2px); }
.slot__spin:focus-visible { outline: none; box-shadow: var(--fg-ring); }
.slot__spin:disabled { color: var(--fg-muted);
  background: linear-gradient(90deg, var(--fg-line), #142029); box-shadow: none; cursor: not-allowed; }
/* Sheen sweeps only while the button is live, so "armed" reads at a glance. */
.slot__spin::after { content: ''; position: absolute; top: 0; bottom: 0; width: 40%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent);
  transform: translateX(-150%); }
.slot__spin:not(:disabled)::after { animation: slot-sheen 2.6s ease-in-out infinite; }
@keyframes slot-sheen {
  0%, 55% { transform: translateX(-150%); }
  100% { transform: translateX(320%); }
}
.slot__spin--busy { animation: slot-pulse 1s ease-in-out infinite; }
@keyframes slot-pulse { 50% { opacity: .72; } }

.slot__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.slot__toggle { padding: 8px 8px; font-family: inherit; font-size: 12px; font-weight: 800;
  color: var(--fg-muted); background: var(--fg-sunken); border: 1px solid var(--fg-line); border-radius: var(--fg-r-lg);
  cursor: pointer; }
.slot__toggle:hover { color: #fff; background: var(--fg-line); }
.slot__toggle:focus-visible { outline: none; box-shadow: var(--fg-ring); }
.slot__toggle[aria-pressed="true"] { color: var(--fg-bg); background: var(--fg-accent); border-color: var(--fg-accent); }

.slot__error { display: flex; align-items: center; justify-content: space-between; gap: 10px;
  margin: 0; padding: 10px; font-size: 12px; font-weight: 700; text-align: left;
  color: #d69199; background: rgba(239,68,68,.14); border: 1px solid rgba(239,68,68,.4);
  border-radius: var(--fg-r-lg); }
.slot__deposit { flex: 0 0 auto; padding: 6px 8px; font-family: inherit; font-size: 11px;
  font-weight: 800; letter-spacing: .04em; color: var(--fg-bg); background: var(--fg-accent); border: 0;
  border-radius: var(--fg-r); cursor: pointer; }
.slot__deposit:hover { filter: brightness(1.08); }
.slot__deposit:focus-visible { outline: none; box-shadow: var(--fg-ring); }

/* ── Win list & paytable ───────────────────── */
.slot__lines { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0;
  list-style: none; }
.slot__line { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 10px; font-size: 12px; font-weight: 700; border-radius: var(--fg-r);
  background: rgba(250,204,21,.1); border: 1px solid rgba(250,204,21,.28); }
.slot__line-name { display: flex; align-items: center; gap: 8px; color: #fde68a; }
.slot__swatch { width: 10px; height: 10px; border-radius: var(--fg-r-sm); }
.slot__line-pay { color: var(--fg-accent); font-variant-numeric: tabular-nums; }

.slot__paytable { border-top: 1px solid #1e293b; padding-top: 14px; }
.slot__paytable-grid { display: grid; grid-template-columns: 1fr auto auto auto; gap: 4px 10px;
  font-size: 11px; font-variant-numeric: tabular-nums; }
.slot__paytable-head { font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
  color: var(--fg-dim); }
.slot__paytable-sym { display: flex; align-items: center; gap: 6px; color: var(--fg-muted);
  font-weight: 700; }
.slot__paytable-val { text-align: right; color: var(--fg-muted); }
.slot__foot { margin: 0; font-size: 10px; line-height: 1.5; color: var(--fg-line-2); }
`;

