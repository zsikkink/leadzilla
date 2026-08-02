import { applyRestCountPreference } from './rest-count-preference.ts';

Deno.test('exact count preference is applied only when requested', () => {
  const exactHeaders = new Headers();
  applyRestCountPreference(exactHeaders, 'exact');
  if (exactHeaders.get('prefer') !== 'count=exact') {
    throw new Error('Expected exact list reads to request a count');
  }

  const countFreeHeaders = new Headers();
  applyRestCountPreference(countFreeHeaders, 'none');
  if (countFreeHeaders.has('prefer')) {
    throw new Error('Count-free reads must not request an exact count');
  }
});

Deno.test('existing write preferences are preserved', () => {
  const headers = new Headers({ prefer: 'return=representation' });
  applyRestCountPreference(headers, 'exact');
  if (headers.get('prefer') !== 'return=representation') {
    throw new Error('Write response preferences must not be overwritten');
  }
});
