/**
 * Typed application errors. Handlers and schemas throw these; `route()` (errors/route.ts)
 * turns them into responses in one place. `message` is shown to the client, so it must
 * never contain a secret or a raw internal error.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Extra response headers, e.g. `Retry-After`. */
    readonly headers: Readonly<Record<string, string>> = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, message);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message: string) {
    super(413, message);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message: string) {
    super(415, message);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message: string, retryAfterSeconds: number) {
    super(429, message, { 'Retry-After': String(retryAfterSeconds) });
  }
}

/** A failure the client cannot fix. `cause` is logged; only `message` is returned. */
export class UnavailableError extends AppError {
  constructor(message: string, cause: unknown) {
    super(500, message, {}, { cause });
  }
}
