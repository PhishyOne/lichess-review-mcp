import { DEFAULT_RECENT_LIMIT, MAX_RECENT_LIMIT } from './constants.js';
import { ValidationError } from './errors.js';

const GAME_ID_PATTERN = /^[A-Za-z0-9]{8}$/;
const GAME_URL_SEGMENT_PATTERN = /^[A-Za-z0-9]{8}(?:[A-Za-z0-9]{4})?$/;
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{2,30}$/;

export function parseGameReference(input) {
  if (typeof input !== 'string') {
    throw new ValidationError('game must be an eight-character game ID or a Lichess URL.');
  }

  const value = input.trim();
  if (GAME_ID_PATTERN.test(value)) return value;

  const authority = value.match(/^https:\/\/([^/?#]+)/i)?.[1] ?? '';
  const rawHost = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority;
  if (rawHost.toLowerCase() !== 'lichess.org') {
    throw new ValidationError('Only exact-host https://lichess.org game URLs are accepted.');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError('game must be an eight-character game ID or an https://lichess.org game URL.');
  }

  if (url.protocol !== 'https:' || url.hostname !== 'lichess.org' || url.port !== '' || url.username !== '' || url.password !== '') {
    throw new ValidationError('Only exact-host https://lichess.org game URLs are accepted.');
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 1 || segments.length > 2 || !GAME_URL_SEGMENT_PATTERN.test(segments[0])) {
    throw new ValidationError('The Lichess URL must point directly to one game.');
  }

  if (segments.length === 2 && !['white', 'black'].includes(segments[1])) {
    throw new ValidationError('The Lichess URL contains an unsupported path suffix.');
  }

  return segments[0].slice(0, 8);
}

export function parseUsername(input) {
  if (typeof input !== 'string') {
    throw new ValidationError('username must be a string.');
  }

  const username = input.trim();
  if (!USERNAME_PATTERN.test(username)) {
    throw new ValidationError('username must be 2-30 characters using letters, numbers, underscores, or hyphens.');
  }
  return username;
}

export function parseRecentLimit(input) {
  if (input === undefined || input === null) return DEFAULT_RECENT_LIMIT;
  if (!Number.isInteger(input) || input < 1 || input > MAX_RECENT_LIMIT) {
    throw new ValidationError(`limit must be an integer from 1 through ${MAX_RECENT_LIMIT}.`);
  }
  return input;
}

export function assertPlainObject(value, label = 'arguments') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object.`);
  }
  return value;
}

export function rejectUnknownKeys(object, allowedKeys) {
  const unknown = Object.keys(object).filter((key) => !allowedKeys.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError(`Unknown argument${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`);
  }
}
