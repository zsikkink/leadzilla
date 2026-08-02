export type RestCountPreference = 'exact' | 'none';

export function applyRestCountPreference(
  headers: Headers,
  countPreference: RestCountPreference,
): void {
  if (!headers.has('prefer') && countPreference === 'exact') {
    headers.set('prefer', 'count=exact');
  }
}
