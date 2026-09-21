/**
 * Avia Masters — injected stylesheet.
 *
 * This project ships no utility CSS framework, so the board carries its own
 * rules and `useInjectedStyles` mounts them once per page.
 */

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────

export const STYLE_ID = 'fg-avia-masters-styles';

export const CSS = `
.avia { display: flex; flex-direction: column; align-items: center; gap: 20px;
  width: 100%; max-width: 1180px; margin-inline: auto; padding: 10px;
  box-sizing: border-box; color: var(--fg-text);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (min-width: 1024px) {
  .avia { flex-direction: row; align-items: flex-start; justify-content: center; }
}

.avia__stage { position: relative; width: 100%; max-width: 820px; min-width: 0;
  aspect-ratio: 16 / 9; background: var(--fg-panel-2); border: var(--fg-edge);
  border-radius: var(--fg-r-lg); overflow: hidden; }
/* touch-action: none — the canvas is a steering surface, so a drag across it
   must not be interpreted as a page scroll or a pinch. cursor stays a pointer
   so it reads as interactive on desktop. */
.avia__canvas { display: block; width: 100%; height: 100%; touch-action: none;
  cursor: pointer; }

/* ── Telemetry ── */
.avia__hud { position: absolute; left: 12px; right: 12px; top: 12px; display: flex;
  flex-wrap: wrap; gap: 8px; pointer-events: none; }
.avia__tile { flex: 1 1 auto; min-width: 84px; padding: 6px 6px;
  background: rgba(8,17,27,.72); border: 1px solid rgba(148,163,184,.22);
  border-radius: var(--fg-r-lg); backdrop-filter: blur(6px); }
.avia__tile-label { display: block; font-size: 9.5px; font-weight: 700;
  letter-spacing: .1em; text-transform: uppercase; color: var(--fg-dim); }
.avia__tile-value { display: block; margin-top: 2px; font-size: 15px; font-weight: 800;
  font-variant-numeric: tabular-nums; color: var(--fg-text); }
.avia__tile--mult .avia__tile-value { color: var(--fg-pos); }
.avia__tile--payout .avia__tile-value { color: var(--fg-gold); }

/* ── Steering, for touch ── */
.avia__banner { position: absolute; left: 50%; top: 46%; transform: translate(-50%,-50%);
  padding: 8px 16px; text-align: center; font-size: 17px; font-weight: 800;
  border-radius: var(--fg-r-lg); pointer-events: none; }
.avia__banner--won { color: var(--fg-bg); background: rgba(74,222,128,.94); }
.avia__banner--lost { color: #450a0a; background: rgba(248,113,113,.94); }
.avia__banner small { display: block; margin-top: 2px; font-size: 12px; font-weight: 700;
  opacity: .8; }

.avia__hint { position: absolute; left: 12px; bottom: 12px; margin: 0; font-size: 11px;
  color: rgba(226,232,240,.6); pointer-events: none; }

/* ── Panel ── */
.avia__panel { display: flex; flex-direction: column; gap: 14px; width: 100%;
  max-width: 820px; min-width: 0; flex: 0 0 auto; padding: 12px; box-sizing: border-box;
  background: var(--fg-panel); border: 1px solid var(--fg-line); border-radius: var(--fg-r-lg); }
@media (min-width: 1024px) { .avia__panel { width: 320px; } }

.avia__label { display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 6px; font-size: 10.5px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: var(--fg-dim); }
.avia__label b { font-size: 12.5px; color: var(--fg-muted); letter-spacing: 0; }

.avia__inputs { display: flex; gap: 6px; }
.avia__input { flex: 1 1 auto; min-width: 0; width: 100%; box-sizing: border-box;
  padding: 6px 8px; font-family: inherit; font-size: 15px; font-weight: 700;
  font-variant-numeric: tabular-nums; color: var(--fg-text); background: var(--fg-sunken);
  border: 1px solid var(--fg-line); border-radius: var(--fg-r-lg); outline: none; }
.avia__input:focus-visible { border-color: var(--fg-accent); box-shadow: var(--fg-ring); }
.avia__input:disabled { opacity: .5; cursor: not-allowed; }
.avia__mod { flex: 0 0 auto; min-width: 42px; padding: 0 8px; font-family: inherit;
  font-size: 12px; font-weight: 800; color: var(--fg-muted); background: var(--fg-sunken);
  border: 1px solid var(--fg-line); border-radius: var(--fg-r-lg); cursor: pointer;
  transition: background var(--fg-t), color var(--fg-t); }
.avia__mod:hover:not(:disabled) { color: #fff; background: var(--fg-line); }
.avia__mod:disabled { opacity: .45; cursor: not-allowed; }
.avia__mod:focus-visible { outline: none; box-shadow: var(--fg-ring); }

.avia__action { width: 100%; padding: 10px; font-family: inherit; font-size: 16px;
  font-weight: 900; color: var(--fg-bg);
  background: linear-gradient(90deg, var(--fg-accent), var(--fg-accent-deep)); border: none;
  border-radius: var(--fg-r-lg); cursor: pointer; box-shadow: 0 10px 20px -6px rgba(34,197,94,.45);
  transition: background var(--fg-t), transform var(--fg-t); }
.avia__action:hover:not(:disabled) { background: linear-gradient(90deg, var(--fg-pos), var(--fg-accent)); }
.avia__action:active:not(:disabled) { transform: translateY(1px); }
.avia__action:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }
.avia__action:focus-visible { outline: none; box-shadow: var(--fg-ring); }
/* In-flight standing. Replaces the old Land button: the deck banks the round,
   so this reports rather than offers. */
.avia__standing { display: flex; flex-direction: column; gap: 2px; width: 100%;
  padding: 8px 10px; text-align: center; border-radius: var(--fg-r-lg);
  background: rgba(250,204,21,.1); border: 1px solid rgba(250,204,21,.35); }
.avia__standing span { font-size: 10.5px; font-weight: 800; letter-spacing: .1em;
  text-transform: uppercase; color: var(--fg-gold); }
.avia__standing b { font-size: 19px; font-weight: 900; font-variant-numeric: tabular-nums;
  color: var(--fg-gold-soft); }
.avia__standing small { font-size: 11px; color: rgba(253,224,71,.75); }

.avia__error { margin: 0; font-size: 12px; font-weight: 600; color: #c25560;
  text-align: center; }
.avia__note { margin: 0; font-size: 10.5px; line-height: 1.5; color: var(--fg-line-2);
  text-align: center; }

.avia__legend { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.avia__chip { padding: 6px 4px; text-align: center; font-size: 11px; font-weight: 800;
  border-radius: var(--fg-r); background: color-mix(in srgb, var(--fg-pos) 12%, transparent); color: var(--fg-pos-soft);
  border: 1px solid color-mix(in srgb, var(--fg-pos) 30%, transparent); }
.avia__chip--bad { background: rgba(239,68,68,.12); color: #d69199;
  border-color: rgba(239,68,68,.3); }
`;

