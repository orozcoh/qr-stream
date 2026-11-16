import { expect } from 'vitest';
import { DEFAULT_QR_STREAM_STRINGS, type QrStreamStrings } from '../../src/react/strings';

const KEYS = Object.keys(DEFAULT_QR_STREAM_STRINGS) as (keyof QrStreamStrings)[];

export const STRING_KEYS = KEYS;

/**
 * A value that contains none of the default copy.
 *
 * Indexed rather than keyed: `⟦chooseFile⟧` would contain `File`, which is also
 * a default value, and the absence assertions would fail on their own sentinel.
 */
export function sentinelValue(key: keyof QrStreamStrings): string {
  return `⟦${KEYS.indexOf(key)}⟧`;
}

export function sentinelStrings(): QrStreamStrings {
  return Object.fromEntries(KEYS.map((key) => [key, sentinelValue(key)])) as unknown as QrStreamStrings;
}

/**
 * The English chunks of a default, with placeholders removed.
 *
 * A templated default is never rendered with its braces, so comparing markup
 * against the raw template can never fail. Its literal chunks (`Speed — `,
 * `fps · `, `to receive`) are what a hardcoded, interpolated default would
 * actually put on screen. A string without placeholders is compared whole.
 */
export function defaultFragments(key: keyof QrStreamStrings): readonly string[] {
  const template = DEFAULT_QR_STREAM_STRINGS[key];
  if (!template.includes('{')) return [template];

  return template
    .split(/\{[^{}]*\}/)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length >= 4 && /[A-Za-z]/.test(fragment));
}

/** Keys whose sentinel value must be visible in the default SSR sender. */
export const SSR_SENDER_KEYS = [
  'qrCode',
  'chooseFile',
  'start',
  'file',
  'accepts',
  'density',
  'densityOption',
  'passphrase',
  'optional',
  'passphraseHint',
] as const satisfies readonly (keyof QrStreamStrings)[];

/** Keys whose sentinel value must be visible in the default SSR receiver. */
export const SSR_RECEIVER_KEYS = [
  'cameraPreview',
  'progress',
  'progressAria',
  'diagnostics',
  'tableNumber',
  'tableLabel',
  'tableFacing',
  'tableGroup',
  'diagnosticsHint',
  'rescan',
] as const satisfies readonly (keyof QrStreamStrings)[];

/**
 * Keys only reachable after an effect or a user event; each is asserted by a
 * jsdom state test in `tests/react-a11y.test.tsx`.
 */
export const STATE_KEYS = [
  'ready',
  'stop',
  'preparing',
  'speed',
  'stopToChange',
  'passphraseInput',
  'fileTypeRejected',
  'fileTooLarge',
  'cameraUnavailable',
  'switchCamera',
  'switching',
  'camera',
  'zoom',
  'torchOn',
  'torchOff',
  'stale',
  'switchToNew',
  'passphraseLabel',
  'unlock',
  'verified',
  'saveFile',
  'receiveAnother',
  'scanning',
  'activeCamera',
  'unnamed',
  'wrongKey',
] as const satisfies readonly (keyof QrStreamStrings)[];

/** Every key the sentinel gate does not check. Empty means full coverage. */
export function coverageGaps(covered: readonly (keyof QrStreamStrings)[]): (keyof QrStreamStrings)[] {
  return KEYS.filter((key) => !covered.includes(key));
}

/**
 * Assert no default copy survived: whole non-templated values and the literal
 * chunks of templated ones (never the braces, which markup cannot contain).
 */
export function expectNoDefaultCopy(markup: string): void {
  for (const key of KEYS) {
    for (const fragment of defaultFragments(key)) {
      expect(markup, `${key} still renders its default copy: ${JSON.stringify(fragment)}`).not.toContain(fragment);
    }
  }
}

/** Assert each key's sentinel value is on screen. */
export function expectSentinels(markup: string, keys: readonly (keyof QrStreamStrings)[]): void {
  for (const key of keys) {
    expect(markup, `missing sentinel for ${key}`).toContain(sentinelValue(key));
  }
}
