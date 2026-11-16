/**
 * Default English copy for the packaged components.
 *
 * Every user-visible literal in `QrStreamSender` and `QrStreamReceiver` comes
 * from here, so a host can translate the whole UI by passing `strings`. Values
 * are `{placeholder}` templates resolved with `formatQrString`; a duration such
 * as `~34 s` is substituted for `{estimate}` rather than translated, because it
 * is a formatted value and not a label.
 */
import type { QrStreamError } from '../core/errors.js';

export interface QrStreamStrings {
  /** Accessible name for the sender's QR canvas. */
  qrCode: string;
  chooseFile: string;
  ready: string;
  start: string;
  stop: string;
  preparing: string;
  /** `{fps}` and `{estimate}`; the estimate already carries its `~` prefix. */
  speed: string;
  stopToChange: string;
  file: string;
  density: string;
  passphrase: string;
  optional: string;
  /** Sender placeholder: the passphrase is spoken, not transferred. */
  passphraseHint: string;
  /** Receiver placeholder for the unlock input. */
  passphraseInput: string;
  /** File hint appended to the picker label: `{types}` comes from `accept`. */
  accepts: string;
  fileTypeRejected: string;
  fileTooLarge: string;
  densityOption: string;
  cameraPreview: string;
  cameraUnavailable: string;
  switchCamera: string;
  switching: string;
  camera: string;
  zoom: string;
  torchOn: string;
  torchOff: string;
  stale: string;
  switchToNew: string;
  /** Visible label for the receiver's unlock input. */
  passphraseLabel: string;
  unlock: string;
  verified: string;
  saveFile: string;
  receiveAnother: string;
  progress: string;
  progressAria: string;
  diagnostics: string;
  diagnosticsHint: string;
  rescan: string;
  scanning: string;
  tableNumber: string;
  tableLabel: string;
  tableFacing: string;
  tableGroup: string;
  activeCamera: string;
  unnamed: string;
  /** Shown when the transfer's passphrase does not unlock it. */
  wrongKey: string;
}

export const DEFAULT_QR_STREAM_STRINGS: Readonly<QrStreamStrings> = Object.freeze({
  qrCode: 'QR stream',
  chooseFile: 'Choose a file to begin',
  ready: 'Ready — press start',
  start: 'Start stream',
  stop: 'Stop stream',
  preparing: 'Preparing…',
  speed: 'Speed — {fps} fps · {estimate} to receive',
  stopToChange: 'Stop the stream to change the file, density, or passphrase.',
  file: 'File',
  density: 'Density',
  passphrase: 'Passphrase',
  optional: '— optional',
  passphraseHint: 'say it aloud, type it on both devices',
  passphraseInput: 'passphrase',
  accepts: '— {types}',
  fileTypeRejected: '{name} is not an accepted file type here.',
  fileTooLarge: 'That file is {kb} KB. The limit is {limit} KB.',
  densityOption: '{name} — v{version}',
  cameraPreview: 'Camera preview',
  cameraUnavailable: 'Camera unavailable',
  switchCamera: 'Switch camera',
  switching: 'Switching…',
  camera: 'Camera',
  zoom: 'Zoom — {value}×',
  torchOn: 'Torch on',
  torchOff: 'Torch off',
  stale: 'A different transfer is being sent. This one cannot finish from it.',
  switchToNew: 'Switch to the new transfer',
  passphraseLabel: 'Passphrase',
  unlock: 'Unlock',
  verified: '{filename} — SHA-256 verified',
  saveFile: 'Save file',
  receiveAnother: 'Receive another',
  progress: '{solved} / {k} blocks · {percent}% · {rate} frames/s',
  progressAria: '{solved} of {k} blocks, {percent} percent',
  diagnostics: 'Cameras reported by this browser ({count})',
  diagnosticsHint:
    'Some Android builds only list secondary rear cameras after the stream has been opened once. If your phone has more than the browser lists, that is a browser limit.',
  rescan: 'Rescan cameras',
  scanning: 'Scanning…',
  tableNumber: '#',
  tableLabel: 'Label',
  tableFacing: 'Facing',
  tableGroup: 'Group',
  activeCamera: 'Active: {label} · {width}×{height} @ {fps} fps · focus {focus}',
  unnamed: 'unnamed',
  wrongKey: 'That passphrase does not match. Try again — no need to rescan.',
});

const PLACEHOLDER = /\{([^{}]+)\}/g;

/**
 * Fill `{key}` placeholders from `values`.
 *
 * The replacement is a function, not a string: a value containing `$&` or `$1`
 * is copied literally instead of being interpreted as a replacement pattern.
 * Unknown placeholders stay visible — a missing translation shows up in the UI
 * rather than silently swallowing the word.
 */
export function formatQrString(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(PLACEHOLDER, (placeholder, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return placeholder;
    const value = values[key];
    return value === undefined ? placeholder : String(value);
  });
}

/** Default error presentation: the error's own message. */
export function defaultFormatError(error: QrStreamError): string {
  return error.message;
}

/**
 * Merge host overrides over the defaults, treating `undefined` as absent so
 * `{ start: undefined }` does not blank out "Start stream".
 *
 * @internal
 */
export function resolveQrStreamStrings(overrides?: Partial<QrStreamStrings>): QrStreamStrings {
  const resolved: QrStreamStrings = { ...DEFAULT_QR_STREAM_STRINGS };
  if (overrides === undefined) return resolved;

  for (const key of Object.keys(DEFAULT_QR_STREAM_STRINGS) as (keyof QrStreamStrings)[]) {
    const value = overrides[key];
    if (value !== undefined) resolved[key] = value;
  }
  return resolved;
}
