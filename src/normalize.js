import { LIVE_STATUSES, TERMINAL_STATUSES } from './constants.js';
import { LiveGameError, UnknownGameStatusError, UpstreamError } from './errors.js';

function asString(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asFiniteNumber(value) {
  return Number.isFinite(value) ? value : undefined;
}

function normalizePlayer(player) {
  if (!player || typeof player !== 'object') return { name: 'Anonymous' };
  const user = player.user && typeof player.user === 'object' ? player.user : undefined;
  return {
    name: asString(user?.name) ?? asString(user?.id) ?? asString(player.userId) ?? asString(player.name) ?? 'Anonymous',
    rating: asFiniteNumber(player.rating),
    ratingDiff: asFiniteNumber(player.ratingDiff),
    provisional: player.provisional === true || undefined,
    aiLevel: asFiniteNumber(player.aiLevel)
  };
}

export function assertTerminalStatus(status) {
  if (LIVE_STATUSES.has(status)) throw new LiveGameError(status);
  if (!TERMINAL_STATUSES.has(status)) throw new UnknownGameStatusError(status);
  return status;
}

export function normalizeCompletedGame(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new UpstreamError('INVALID_UPSTREAM_DATA', 'Lichess returned a non-object game record.');
  }

  const id = asString(raw.id)?.slice(0, 8);
  if (!id || !/^[A-Za-z0-9]{8}$/.test(id)) {
    throw new UpstreamError('INVALID_UPSTREAM_DATA', 'Lichess returned a game without a valid ID.');
  }

  const status = assertTerminalStatus(asString(raw.status));
  const players = raw.players && typeof raw.players === 'object' ? raw.players : {};
  const pgn = asString(raw.pgn);
  const moves = asString(raw.moves);

  return compact({
    id,
    url: `https://lichess.org/${id}`,
    status,
    winner: ['white', 'black'].includes(raw.winner) ? raw.winner : undefined,
    rated: typeof raw.rated === 'boolean' ? raw.rated : undefined,
    variant: asString(raw.variant),
    speed: asString(raw.speed),
    perf: asString(raw.perf),
    createdAt: asFiniteNumber(raw.createdAt),
    lastMoveAt: asFiniteNumber(raw.lastMoveAt),
    turns: asFiniteNumber(raw.turns),
    clock: raw.clock && typeof raw.clock === 'object' ? raw.clock : undefined,
    players: {
      white: normalizePlayer(players.white),
      black: normalizePlayer(players.black)
    },
    opening: raw.opening && typeof raw.opening === 'object' ? raw.opening : undefined,
    pgn,
    moves,
    clocks: Array.isArray(raw.clocks) ? raw.clocks : undefined,
    analysis: Array.isArray(raw.analysis) ? raw.analysis : undefined
  });
}

export function summarizeCompletedGame(raw) {
  const game = normalizeCompletedGame(raw);
  return compact({
    id: game.id,
    url: game.url,
    status: game.status,
    winner: game.winner,
    rated: game.rated,
    variant: game.variant,
    speed: game.speed,
    perf: game.perf,
    createdAt: game.createdAt,
    lastMoveAt: game.lastMoveAt,
    players: game.players,
    opening: game.opening
  });
}

export function compact(value) {
  if (Array.isArray(value)) return value.map(compact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, compact(item)])
  );
}
