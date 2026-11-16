import type { ReactElement } from 'react';
import type { QrStreamError } from '../core/errors.js';
import { defaultFormatError } from './strings.js';

export interface ErrorTextProps {
  error: QrStreamError | null;
  /** Host translation; defaults to the error's own message. */
  formatError?(error: QrStreamError): string;
  className?: string;
}

/**
 * The one error surface for the packaged components.
 *
 * `role="alert"` makes the announcement, so a camera failure, a decoder failure,
 * and a writer failure are all reported to assistive technology the same way.
 */
export function ErrorText({ error, formatError, className }: ErrorTextProps): ReactElement | null {
  if (error === null) return null;
  const format = formatError ?? defaultFormatError;
  return (
    <p className={className ? `qrs__error ${className}` : 'qrs__error'} role="alert">
      {format(error)}
    </p>
  );
}
