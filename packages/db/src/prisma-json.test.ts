import { describe, expect, it } from 'vitest';

import { toInputJson } from './prisma-json.js';

describe('toInputJson', () => {
  it('preserves ordinary JSON-safe values', () => {
    expect(toInputJson({
      plain: 'hello',
      nested: { count: 2, ok: true },
      items: ['a', 'b'],
    })).toEqual({
      plain: 'hello',
      nested: { count: 2, ok: true },
      items: ['a', 'b'],
    });
  });

  it('decodes hex-escaped utf-8 byte runs before JSON persistence', () => {
    expect(toInputJson({
      text: 'quoted \\xe2\\x80\\x99 text',
    })).toEqual({
      text: 'quoted ’ text',
    });
  });

  it('removes null bytes and escapes incomplete hex sequences', () => {
    expect(toInputJson({
      text: `bad \u0000 value \\xE`,
    })).toEqual({
      text: 'bad  value \\\\xE',
    });
  });

  it('repairs lone surrogate code units before JSON persistence', () => {
    expect(toInputJson({
      text: 'caption \uD835',
    })).toEqual({
      text: 'caption \uFFFD',
    });
  });
});
