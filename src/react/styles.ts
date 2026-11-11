/**
 * Component styles, injected once.
 *
 * Every rule is wrapped in `:where()` so it has zero specificity: a host
 * application can restyle any part of this component with a plain class or tag
 * selector and never have to fight back. Colours are `--qrs-*` custom
 * properties, so re-theming is one variable on any ancestor.
 *
 * There is deliberately no webfont. This app runs offline, and a font request
 * that fails silently is the same class of bug as a missing WASM decoder.
 */

const CSS = `
:where(.qrs) {
  --qrs-bg: #0f172a;
  --qrs-surface: #1e293b;
  --qrs-fg: #f8fafc;
  --qrs-muted: #94a3b8;
  --qrs-border: #334155;
  --qrs-accent: #22c55e;
  --qrs-on-accent: #052e16;
  --qrs-danger: #f87171;
  --qrs-radius: 12px;
  --qrs-width: 360px;
  --qrs-font: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;

  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  min-height: 100%;
  padding: 24px;
  background: var(--qrs-bg);
  color: var(--qrs-fg);
  font-family: var(--qrs-font);
  font-size: 16px;
  line-height: 1.5;
  text-align: center;
  border-radius: var(--qrs-radius);
}

:where(.qrs *), :where(.qrs *::before), :where(.qrs *::after) { box-sizing: border-box; }

:where(.qrs__title) {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

:where(.qrs__stage) {
  display: grid;
  place-items: center;
  width: min(70vw, 420px, 50dvh);
  aspect-ratio: 1 / 1;
  padding: 12px;
  background: #fff;
  border: 1px solid transparent;
  border-radius: 10px;
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.35);
}

:where(.qrs__stage[data-empty='true']) {
  width: min(70vw, 260px);
  background: transparent;
  border: 1px dashed var(--qrs-border);
  box-shadow: none;
}

:where(.qrs__canvas) {
  grid-area: 1 / 1;
  /* Intrinsic size only. Stretching it with CSS re-introduces the fractional
     module scaling the renderer works to avoid, which is what makes a code
     stop reading. */
  max-width: 100%;
  max-height: 100%;
  display: block;
  image-rendering: pixelated;
  border-radius: 4px;
}

:where(.qrs__placeholder) {
  grid-area: 1 / 1;
  font-size: 14px;
  color: var(--qrs-muted);
  padding: 0 12px;
}

:where(.qrs__settings) {
  display: grid;
  gap: 14px;
  width: 100%;
  max-width: var(--qrs-width);
}

:where(.qrs__field) {
  display: grid;
  gap: 6px;
  width: 100%;
  text-align: left;
}

:where(.qrs__label) {
  font-size: 13px;
  font-weight: 500;
  color: var(--qrs-muted);
}

:where(.qrs__hint) {
  font-size: 12px;
  font-weight: 400;
  color: var(--qrs-muted);
}

:where(.qrs__input), :where(.qrs__select) {
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  font: inherit;
  font-size: 15px;
  color: var(--qrs-fg);
  background: var(--qrs-surface);
  border: 1px solid var(--qrs-border);
  border-radius: 10px;
  appearance: none;
}

:where(.qrs__input[type='file']) {
  padding: 10px 12px;
  font-size: 14px;
}

:where(.qrs__input[type='file'])::file-selector-button {
  margin-right: 10px;
  padding: 6px 12px;
  font: inherit;
  font-size: 13px;
  color: var(--qrs-fg);
  background: var(--qrs-border);
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}

:where(.qrs__range) {
  width: 100%;
  accent-color: var(--qrs-accent);
}

:where(.qrs__button) {
  min-height: 48px;
  min-width: 44px;
  padding: 0 20px;
  font: inherit;
  font-size: 15px;
  font-weight: 500;
  color: var(--qrs-fg);
  background: var(--qrs-surface);
  border: 1px solid var(--qrs-border);
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 150ms ease, border-color 150ms ease;
}

:where(.qrs__button--primary) {
  width: 100%;
  max-width: var(--qrs-width);
  color: var(--qrs-on-accent);
  background: var(--qrs-accent);
  border-color: transparent;
  font-weight: 600;
}

:where(.qrs__button--ghost) {
  background: transparent;
}

:where(.qrs__button:hover:not(:disabled)) { border-color: var(--qrs-muted); }

:where(.qrs__button--primary:hover:not(:disabled)) {
  background: color-mix(in srgb, var(--qrs-accent) 88%, white);
  border-color: transparent;
}

:where(.qrs__button:disabled) {
  opacity: 0.45;
  cursor: not-allowed;
}

:where(.qrs__button:focus-visible),
:where(.qrs__input:focus-visible),
:where(.qrs__select:focus-visible),
:where(.qrs__range:focus-visible) {
  outline: 2px solid var(--qrs-accent);
  outline-offset: 2px;
}

:where(.qrs__feed) {
  display: grid;
  place-items: center;
  width: min(100%, var(--qrs-width));
}

:where(.qrs__feed > .qrs__placeholder) {
  grid-area: 1 / 1;
  pointer-events: none;
}

:where(.qrs__video) {
  grid-area: 1 / 1;
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  background: #000;
  border-radius: 10px;
  object-fit: cover;
}

:where(.qrs__progress) {
  width: 100%;
  max-width: var(--qrs-width);
  height: 8px;
  appearance: none;
  border: 0;
  border-radius: 999px;
  overflow: hidden;
  background: var(--qrs-surface);
}

:where(.qrs__progress)::-webkit-progress-bar { background: var(--qrs-surface); }
:where(.qrs__progress)::-webkit-progress-value { background: var(--qrs-accent); }
:where(.qrs__progress)::-moz-progress-bar { background: var(--qrs-accent); }

:where(.qrs__readout) {
  display: grid;
  gap: 8px;
  width: 100%;
  max-width: var(--qrs-width);
}

:where(.qrs__meta) {
  margin: 0;
  font-size: 13px;
  color: var(--qrs-muted);
  font-variant-numeric: tabular-nums;
}

:where(.qrs__error) {
  margin: 0;
  max-width: var(--qrs-width);
  font-size: 13px;
  color: var(--qrs-danger);
}

:where(.qrs__details) {
  width: 100%;
  max-width: var(--qrs-width);
  text-align: left;
  font-size: 12px;
  color: var(--qrs-muted);
}

:where(.qrs__summary) { cursor: pointer; }

:where(.qrs__table) {
  width: 100%;
  margin-top: 8px;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}

:where(.qrs__table th), :where(.qrs__table td) {
  padding: 4px 6px;
  text-align: left;
  border-bottom: 1px solid var(--qrs-border);
}

@media (prefers-reduced-motion: reduce) {
  :where(.qrs *), :where(.qrs *::before), :where(.qrs *::after) {
    transition: none !important;
    animation: none !important;
  }
}
`;

const STYLE_ID = 'qr-stream-styles';

let injected = false;

export function ensureQrStreamStyles(): void {
  if (injected) return;
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID) !== null) {
    injected = true;
    return;
  }
  const element = document.createElement('style');
  element.id = STYLE_ID;
  element.textContent = CSS;
  document.head.appendChild(element);
  injected = true;
}
