import { describe, expect, it } from 'vitest';

import { APP_BASE_PATH, withAppBasePath } from './app-path.js';

describe('withAppBasePath', () => {
  it('prefixes application-relative paths', () => {
    expect(withAppBasePath('/dashboard')).toBe('/leadzilla/dashboard');
    expect(withAppBasePath('/api/admin/leads?page=1')).toBe(
      '/leadzilla/api/admin/leads?page=1',
    );
  });

  it('maps the application root and preserves already-prefixed paths', () => {
    expect(withAppBasePath('/')).toBe(APP_BASE_PATH);
    expect(withAppBasePath('/leadzilla/dashboard')).toBe('/leadzilla/dashboard');
  });

  it('rejects paths that are not application-relative', () => {
    expect(() => withAppBasePath('dashboard')).toThrow('App paths must start with "/"');
  });
});
