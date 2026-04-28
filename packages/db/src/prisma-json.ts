import type { Prisma } from '@prisma/client';

const NULL_BYTE = String.fromCharCode(0);
const HEX_ESCAPED_BYTE_RUN_RE = /(?:\\x[0-9A-Fa-f]{2})+/g;
const INCOMPLETE_HEX_ESCAPE_RE = /\\x(?![0-9A-Fa-f]{2})/g;

function toWellFormedString(value: string): string {
  const maybeToWellFormed = (value as string & { toWellFormed?: () => string }).toWellFormed;
  return typeof maybeToWellFormed === 'function'
    ? maybeToWellFormed.call(value)
    : value;
}

function decodeHexEscapedUtf8ByteRun(match: string): string {
  const bytes = match.match(/[0-9A-Fa-f]{2}/g);
  if (!bytes || bytes.length === 0) {
    return match;
  }

  const percentEncoded = bytes.map((byte) => `%${byte}`).join('');

  try {
    return decodeURIComponent(percentEncoded);
  } catch {
    return match.replace(/\\/g, '\\\\');
  }
}

function sanitizeStringForJson(value: string): string {
  let sanitized = toWellFormedString(value).split(NULL_BYTE).join('');
  sanitized = sanitized.replace(HEX_ESCAPED_BYTE_RUN_RE, decodeHexEscapedUtf8ByteRun);
  sanitized = sanitized.replace(INCOMPLETE_HEX_ESCAPE_RE, '\\\\x');
  return sanitized;
}

export function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(
    value ?? null,
    (_key, nestedValue) => typeof nestedValue === 'string'
      ? sanitizeStringForJson(nestedValue)
      : nestedValue,
  )) as Prisma.InputJsonValue;
}
