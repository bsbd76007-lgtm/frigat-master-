/**
 * Chicken Road — injected stylesheet.
 *
 * This project ships no utility CSS framework, so the board carries its own
 * rules and `useInjectedStyles` mounts them once per page.
 */

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────

export const STYLE_ID = 'fg-chicken-road-styles';

export const CSS = `
.chr { display: flex; flex-direction: column; align-items: center; gap: 24px;
  width: 100%; max-width: 1100px; margin-inline: auto; padding: 10px;
  box-sizing: border-box; color: var(--fg-text);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (min-width: 1024px) {
  .chr { flex-direction: row; align-items: flex-start; justify-content: center; }
}

/* ── Canvas ────────────────────────────────────────── */
/* Horizontal board: the crossing reads left → right, so the stage is wider
   than it is tall. */
/* --chr-chick-x / --chr-chick-y follow the sprite so its hit target rides
   along with it; the render loop writes them every frame. */
.chr__stage { position: relative; width: 100%; max-width: 700px; min-width: 0;
  aspect-ratio: 3 / 2; background: #7c8b9e; border: 4px solid #e5a059;
  border-radius: var(--fg-r-lg); overflow: hidden;
  --chr-chick-x: 0px; --chr-chick-y: 0px; }
/* One canvas: road, covers, barriers, cars and the chicken are all painted
   into it, back to front — see the renderer in ChickenRoad.tsx. */
.chr__canvas { display: block; width: 100%; height: 100%; }

/* The chicken itself is the step control: a hit target pinned to the sprite. */
.chr__chick { position: absolute; left: var(--chr-chick-x); top: var(--chr-chick-y);
  width: 76px; height: 76px; margin: -38px 0 0 -38px; padding: 0;
  background: transparent; border: 0; border-radius: var(--fg-r-pill); cursor: pointer;
  z-index: 2; }
.chr__chick::after { content: ''; position: absolute; inset: 6px; border-radius: var(--fg-r-pill);
  border: 2px dashed rgba(255,255,255,.35); opacity: 0;
  transition: opacity var(--fg-t); }
.chr__chick:hover::after { opacity: .9; }
.chr__chick:focus-visible { outline: none; }
.chr__chick:focus-visible::after { opacity: 1; border-color: var(--fg-accent); border-style: solid; }
.chr__chick:disabled { cursor: default; pointer-events: none; }
.chr__chick:disabled::after { opacity: 0; }

.chr__hud { position: absolute; left: 12px; right: 12px; top: 12px; display: flex;
  justify-content: space-between; gap: 8px; pointer-events: none; }
/* Dark glass rather than the old light pill: the panel below is #121c24, and
   a white chip was the one light surface in the component. Translucent dark
   over the grey-blue road keeps contrast well past 4.5:1 for both the label
   and the value, which a light pill did not manage against the pale verges. */
.chr__chip { display: flex; flex-direction: column; gap: 1px; min-width: 84px;
  padding: 6px 8px; background: rgba(11, 20, 27, .72); border: 1px solid rgba(148, 163, 184, .18);
  border-radius: var(--fg-r-lg); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.chr__chip--profit { text-align: right; }
/* Label / value pair, matching the panel: slate-300 label, white value. */
.chr__chip i { font-size: 9.5px; font-weight: 700; font-style: normal;
  letter-spacing: .1em; text-transform: uppercase; color: var(--fg-muted); }
.chr__chip b { font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums;
  letter-spacing: -.01em; color: #fff; }
.chr__chip--profit b { color: var(--fg-gold); }

/* ── Panel ─────────────────────────────────────────── */
.chr__panel { display: flex; flex-direction: column; gap: 16px; width: 100%;
  max-width: 700px; min-width: 0; flex: 0 0 auto; padding: 16px; box-sizing: border-box;
  background: var(--fg-panel); border: var(--fg-edge); border-radius: var(--fg-r-lg); }
@media (min-width: 1024px) { .chr__panel { width: 320px; } }

.chr__label { display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 8px; font-size: 11px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: var(--fg-dim); }
.chr__label b { font-size: 13px; color: var(--fg-gold); letter-spacing: 0; }

.chr__inputs { display: flex; gap: 6px; }
.chr__input { flex: 1 1 auto; min-width: 0; width: 100%; box-sizing: border-box;
  padding: 8px 8px; font-family: inherit; font-size: 15px; font-weight: 700;
  font-variant-numeric: tabular-nums; color: var(--fg-text); background: var(--fg-sunken);
  border: 1px solid var(--fg-line); border-radius: var(--fg-r-lg); outline: none;
  transition: border-color var(--fg-t), box-shadow var(--fg-t); }
.chr__input:focus-visible { border-color: var(--fg-accent); box-shadow: var(--fg-ring); }
.chr__input:disabled { opacity: .5; cursor: not-allowed; }
.chr__mod { flex: 0 0 auto; min-width: 42px; padding: 0 8px; font-family: inherit;
  font-size: 12px; font-weight: 800; color: var(--fg-muted); background: var(--fg-sunken);
  border: 1px solid var(--fg-line); border-radius: var(--fg-r-lg); cursor: pointer;
  transition: background var(--fg-t), color var(--fg-t), transform var(--fg-t); }
.chr__mod:hover:not(:disabled) { color: #fff; background: var(--fg-line); }
.chr__mod:active:not(:disabled) { transform: translateY(1px); }
.chr__mod:focus-visible { outline: none; box-shadow: var(--fg-ring); }
.chr__mod:disabled { opacity: .45; cursor: not-allowed; }

/* ── Traffic density selector ──────────────────────── */
.chr__modes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.chr__mode { padding: 10px 4px; font-family: inherit; font-size: 13px; font-weight: 800;
  font-variant-numeric: tabular-nums; color: var(--fg-muted); background: var(--fg-sunken);
  border: 1px solid var(--fg-line); border-radius: var(--fg-r-lg); cursor: pointer;
  transition: background var(--fg-t), border-color var(--fg-t), color var(--fg-t); }
.chr__mode:hover:not(:disabled) { color: #fff; background: var(--fg-line); }

/* Touch targets.
 *
 * The ½ / 2x / Max modifiers sit at min-width 42px with their height coming
 * from the input row, and the four density buttons are 10px of vertical
 * padding around 13px text — both land under the 44px WCAG 2.5.5 asks for.
 *
 * These cannot use the transparent ::after overlay that globals.css applies to
 * the icon buttons: these are laid out in a flex row and a 4-column grid, so
 * an overlay wider than the box would spill across the neighbouring control
 * and steal its taps. Growing the box itself is correct here — the row simply
 * gets taller, which is what a thumb needs anyway.
 *
 * Gated on pointer, not width, for the same reason as the globals.css block:
 * the input device is what decides, not the viewport. */
@media (pointer: coarse) {
  .chr__mod { min-width: 52px; min-height: 44px; }
  .chr__mode { min-height: 44px; }
  .chr__input { min-height: 44px; }
}
.chr__mode:focus-visible { outline: none; box-shadow: var(--fg-ring); }
.chr__mode:disabled { opacity: .45; cursor: not-allowed; }
.chr__mode--on { color: var(--fg-bg); background: var(--fg-accent); border-color: var(--fg-accent); }
.chr__mode--on:hover:not(:disabled) { color: var(--fg-bg); background: var(--fg-pos); }

.chr__banner { padding: 6px; text-align: center; font-size: 13px; font-weight: 700;
  border-radius: var(--fg-r-lg); }
.chr__banner--lost { color: #d69199; background: rgba(239,68,68,.14);
  border: 1px solid rgba(239,68,68,.4); }
.chr__banner--won { color: var(--fg-pos-soft); background: color-mix(in srgb, var(--fg-pos) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--fg-pos) 40%, transparent); }
.chr__error { margin: 0; font-size: 12px; font-weight: 600; color: #c25560;
  text-align: center; }

.chr__action { width: 100%; padding: 10px; font-family: inherit; font-size: 17px;
  font-weight: 900; color: var(--fg-bg);
  background: linear-gradient(90deg, var(--fg-accent), var(--fg-accent-deep)); border: none;
  border-radius: var(--fg-r-lg); cursor: pointer; box-shadow: 0 10px 20px -5px rgba(34,197,94,.4);
  transition: background var(--fg-t), box-shadow var(--fg-t), transform var(--fg-t); }
.chr__action:hover:not(:disabled) { background: linear-gradient(90deg, var(--fg-pos), var(--fg-accent));
  box-shadow: 0 14px 28px -6px rgba(34,197,94,.6); }
.chr__action:active:not(:disabled) { transform: translateY(1px); }
.chr__action:focus-visible { outline: none; box-shadow: var(--fg-ring); }
.chr__action:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }
.chr__action--cash { color: #422006;
  background: linear-gradient(90deg, var(--fg-gold), var(--fg-gold-deep));
  box-shadow: 0 10px 20px -5px rgba(250,204,21,.4); }
.chr__action--cash:hover:not(:disabled) { background: linear-gradient(90deg, var(--fg-gold-soft), var(--fg-gold)); }
.chr__hint { margin: 0; font-size: 11px; text-align: center; color: var(--fg-line-2); }
`;

