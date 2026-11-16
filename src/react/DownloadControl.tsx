import type { ReactElement } from 'react';

export interface DownloadControlProps {
  url: string;
  filename: string;
  label: string;
  className?: string;
}

/**
 * The save control for a completed transfer.
 *
 * One anchor, styled as a button: nesting a `<button>` inside an `<a>` produced
 * two focus stops and invalid content, and a `<button>` alone cannot download.
 */
export function DownloadControl({ url, filename, label, className }: DownloadControlProps): ReactElement {
  const classes = className ? `qrs__button qrs__button--primary ${className}` : 'qrs__button qrs__button--primary';
  return (
    <a className={classes} href={url} download={filename}>
      {label}
    </a>
  );
}
