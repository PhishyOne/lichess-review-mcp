export class AppError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = this.constructor.name;
    this.code = code;
    this.status = options.status ?? 500;
    this.expose = options.expose ?? true;
  }
}

export class ValidationError extends AppError {
  constructor(message) {
    super('INVALID_ARGUMENT', message, { status: 400 });
  }
}

export class LiveGameError extends AppError {
  constructor(status) {
    super(
      'GAME_NOT_COMPLETED',
      `The game status is ${JSON.stringify(status)}. Only completed games can be returned.`,
      { status: 409 }
    );
  }
}

export class UnknownGameStatusError extends AppError {
  constructor(status) {
    super(
      'UNKNOWN_GAME_STATUS',
      `The game status ${JSON.stringify(status)} is missing or not recognized, so the game is refused.`,
      { status: 409 }
    );
  }
}

export class UpstreamError extends AppError {
  constructor(code, message, options = {}) {
    super(code, message, { status: options.status ?? 502, expose: true, cause: options.cause });
  }
}

export class QueueFullError extends AppError {
  constructor() {
    super('QUEUE_FULL', 'The bounded Lichess request queue is full. Try again later.', { status: 503 });
  }
}
