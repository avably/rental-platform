/**
 * Chrome nakładki na tokenach Fazy 2 (docs/branding/2026-07-20-avably-faza-2-
 * system.html, sekcja 01) — wartości wpisane wprost, bo nakładka montuje się
 * także na osi marketingowej, która świadomie NIE ładuje arkuszy produktu
 * (ADR-068). Limonka zawsze z nośnikiem INK (nigdy goły neon), obrys BORDER,
 * promienie z tej samej skali co panel. Geist przez zmienną --font-geist-sans
 * tam, gdzie jest (panel/sklep); na marketingu spada na systemowy sans.
 */
export const REVIEW_CSS = `
.avb-rev, .avb-rev * { box-sizing: border-box; }
.avb-rev {
  --rev-ink: #0B1017;
  --rev-canvas: #F4F6F5;
  --rev-card: #FFFFFF;
  --rev-muted: #55616D;
  --rev-muted-bg: #E9ECEA;
  --rev-lime: #EAFFA4;
  --rev-lime-strong: #5F7500;
  --rev-border: #7E8994;
  --rev-destructive: #A93226;
  --rev-radius: 0.75rem;
  --rev-radius-sm: 0.625rem;
  font-family: var(--font-geist-sans, "Geist", ui-sans-serif, system-ui, -apple-system, sans-serif);
  font-size: 14px;
  line-height: 1.45;
  color: var(--rev-ink);
}

/* --- Warstwa dokumentu --- */
.avb-rev-layer {
  position: absolute;
  top: 0; left: 0; right: 0;
  z-index: 2147483000;
  pointer-events: none;
}
.avb-rev-layer.avb-rev-capturing { pointer-events: auto; cursor: crosshair; }

/* --- Pinezki --- */
.avb-rev-pin {
  position: absolute;
  transform: translate(-50%, -100%);
  width: 32px; height: 32px;
  border-radius: 50% 50% 50% 4px;
  border: 2px solid var(--rev-ink);
  background: var(--rev-lime);
  color: var(--rev-ink);
  font-weight: 700;
  font-size: 13px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  pointer-events: auto;
  box-shadow: 0 1px 2px rgba(11, 16, 23, 0.25);
  padding: 0;
}
.avb-rev-pin:focus-visible { outline: 3px solid var(--rev-ink); outline-offset: 2px; }
.avb-rev-pin.avb-rev-done {
  background: var(--rev-muted-bg);
  border-color: var(--rev-border);
  color: var(--rev-muted);
  font-weight: 600;
}
.avb-rev-pin.avb-rev-dim { opacity: 0.45; }
.avb-rev-area {
  position: absolute;
  border: 2px solid var(--rev-lime-strong);
  background: rgba(234, 255, 164, 0.18);
  border-radius: 4px;
  pointer-events: none;
}
.avb-rev-area.avb-rev-done { border-color: var(--rev-border); background: rgba(233, 236, 234, 0.25); }
.avb-rev-area.avb-rev-dim { opacity: 0.4; }
.avb-rev-draft-rect {
  position: absolute;
  border: 2px dashed var(--rev-lime-strong);
  background: rgba(234, 255, 164, 0.15);
  pointer-events: none;
}

/* --- Pasek narzędzi (pływający, kciukowy) --- */
.avb-rev-toolbar {
  position: fixed;
  right: 16px;
  bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  z-index: 2147483200;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.avb-rev-mode {
  min-height: 48px;
  display: inline-flex; align-items: center; gap: 10px;
  padding: 0 18px;
  border-radius: 999px;
  border: 2px solid var(--rev-ink);
  background: var(--rev-ink);
  color: var(--rev-canvas);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(11, 16, 23, 0.3);
}
.avb-rev-mode[data-active="true"] { background: var(--rev-lime); color: var(--rev-ink); }
.avb-rev-mode:focus-visible { outline: 3px solid var(--rev-lime-strong); outline-offset: 2px; }
.avb-rev-mode .avb-rev-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--rev-border);
}
.avb-rev-mode[data-active="true"] .avb-rev-dot { background: var(--rev-lime-strong); }
.avb-rev-chip {
  min-height: 44px;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1.5px solid var(--rev-border);
  background: var(--rev-card);
  color: var(--rev-muted);
  font: inherit; font-size: 13px; font-weight: 500;
  cursor: pointer;
}
.avb-rev-chip[data-active="true"] {
  border-color: var(--rev-ink);
  color: var(--rev-ink);
  background: var(--rev-lime);
}
.avb-rev-chip:focus-visible { outline: 3px solid var(--rev-lime-strong); outline-offset: 2px; }

/* --- Popover / bottom sheet --- */
.avb-rev-pop {
  position: absolute;
  z-index: 2147483300;
  width: min(360px, calc(100vw - 24px));
  background: var(--rev-card);
  border: 1.5px solid var(--rev-border);
  border-radius: var(--rev-radius);
  box-shadow: 0 8px 28px rgba(11, 16, 23, 0.22);
  padding: 14px;
  pointer-events: auto;
}
.avb-rev-pop h3 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--rev-muted);
  letter-spacing: 0.02em;
}
.avb-rev-pop textarea {
  width: 100%;
  min-height: 76px;
  resize: vertical;
  border: 1.5px solid var(--rev-border);
  border-radius: var(--rev-radius-sm);
  padding: 10px;
  font: inherit;
  color: var(--rev-ink);
  background: var(--rev-card);
}
.avb-rev-pop textarea:focus-visible { outline: 3px solid var(--rev-lime-strong); outline-offset: 1px; }
.avb-rev-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.avb-rev-label { font-size: 12px; font-weight: 600; color: var(--rev-muted); }

.avb-rev-prio { display: inline-flex; gap: 4px; }
.avb-rev-prio button {
  width: 44px; height: 44px;
  border-radius: var(--rev-radius-sm);
  border: 1.5px solid var(--rev-border);
  background: var(--rev-card);
  color: var(--rev-muted);
  font: inherit; font-weight: 700;
  cursor: pointer;
}
.avb-rev-prio button[data-active="true"] {
  background: var(--rev-ink);
  border-color: var(--rev-ink);
  color: var(--rev-lime);
}
.avb-rev-prio button:focus-visible { outline: 3px solid var(--rev-lime-strong); outline-offset: 1px; }

.avb-rev-btn {
  min-height: 44px;
  padding: 0 16px;
  border-radius: var(--rev-radius-sm);
  border: 2px solid var(--rev-ink);
  background: var(--rev-ink);
  color: var(--rev-canvas);
  font: inherit; font-weight: 600;
  cursor: pointer;
}
.avb-rev-btn.avb-rev-secondary { background: var(--rev-card); color: var(--rev-ink); border-color: var(--rev-border); }
.avb-rev-btn:disabled { opacity: 0.5; cursor: default; }
.avb-rev-btn:focus-visible { outline: 3px solid var(--rev-lime-strong); outline-offset: 2px; }

.avb-rev-thumbs { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.avb-rev-thumbs img {
  width: 64px; height: 64px;
  object-fit: cover;
  border-radius: var(--rev-radius-sm);
  border: 1.5px solid var(--rev-border);
  display: block;
}
.avb-rev-thumb { position: relative; }
.avb-rev-thumb button {
  position: absolute; top: -6px; right: -6px;
  width: 22px; height: 22px;
  border-radius: 50%;
  border: 1.5px solid var(--rev-ink);
  background: var(--rev-card);
  color: var(--rev-ink);
  font-size: 12px; line-height: 1;
  cursor: pointer;
  padding: 0;
}
.avb-rev-hint { margin-top: 8px; font-size: 12px; color: var(--rev-muted); }
.avb-rev-error { margin-top: 8px; font-size: 12px; color: var(--rev-destructive); font-weight: 600; }

.avb-rev-status-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px; font-weight: 600;
  border: 1.5px solid var(--rev-lime-strong);
  color: var(--rev-lime-strong);
  background: rgba(234, 255, 164, 0.35);
}
.avb-rev-status-pill.avb-rev-done { border-color: var(--rev-border); color: var(--rev-muted); background: var(--rev-muted-bg); }

.avb-rev-body { margin: 8px 0 0; white-space: pre-wrap; word-break: break-word; }
.avb-rev-meta { margin-top: 6px; font-size: 12px; color: var(--rev-muted); }

/* Bottom sheet na wąskich ekranach — popover nie wymaga kursora ani hoveru. */
@media (max-width: 640px) {
  .avb-rev-pop {
    position: fixed;
    left: 0; right: 0; bottom: 0; top: auto;
    width: 100%;
    max-height: 72vh;
    overflow-y: auto;
    border-radius: var(--rev-radius) var(--rev-radius) 0 0;
    border-bottom: none;
    padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px));
  }
}

@media (prefers-reduced-motion: no-preference) {
  .avb-rev-pin { transition: opacity 140ms ease, transform 140ms ease; }
  .avb-rev-mode, .avb-rev-chip { transition: background 140ms ease, color 140ms ease; }
}
`;
