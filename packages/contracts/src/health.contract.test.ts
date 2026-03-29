import { describe, expect, it } from 'vitest';

import { HealthResponseSchema, ReadyResponseSchema } from './health.contract.js';

describe('health contracts', () => {
  it('accepts valid health payload', () => {
    const parsed = HealthResponseSchema.parse({ status: 'ok' });

    expect(parsed.status).toBe('ok');
  });

  it('accepts valid ready payload', () => {
    const parsed = ReadyResponseSchema.parse({
      status: 'ready',
      db: 'ok',
      schema: {
        status: 'ok',
        missingTables: [],
        missingEnumValues: [],
        unexpectedTablePrivileges: [],
        unexpectedDefaultPrivileges: [],
      },
    });

    expect(parsed.status).toBe('ready');
    expect(parsed.db).toBe('ok');
    expect(parsed.schema.status).toBe('ok');
    expect(parsed.schema.unexpectedTablePrivileges).toEqual([]);
    expect(parsed.schema.unexpectedDefaultPrivileges).toEqual([]);
  });
});
