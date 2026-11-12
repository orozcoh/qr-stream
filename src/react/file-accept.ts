/**
 * Validate a file against the same syntax as the HTML `accept` attribute.
 *
 * The attribute only filters the native picker — drag-and-drop and "All files"
 * walk straight past it — so the restriction has to be enforced here too, or
 * the component quietly sends something the host said it did not want.
 */
export function matchesAccept(file: File, accept: string | undefined): boolean {
  if (accept === undefined || accept.trim() === '') return true;

  const rules = accept
    .split(',')
    .map((rule) => rule.trim().toLowerCase())
    .filter((rule) => rule.length > 0);
  if (rules.length === 0) return true;

  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  return rules.some((rule) => {
    if (rule === '*/*') return true;
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

/** Human-readable form of an `accept` value, for helper text. */
export function describeAccept(accept: string): string {
  const parts = accept
    .split(',')
    .map((rule) => rule.trim())
    .filter((rule) => rule.length > 0);
  return `Accepts ${parts.join(', ')}`;
}
