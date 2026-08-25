/**
 * Application error hierarchy.
 * All service-layer errors extend `AppError` so the error-handler plugin (T-11)
 * can map them to the standard `{ error: { code, message } }` response format.
 */

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends AppError {
  constructor(code: string, message: string) {
    super(400, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(code: string, message: string) {
    super(404, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(409, code, message);
  }
}

export class InternalError extends AppError {
  constructor(message = 'An unexpected error occurred') {
    super(500, 'INTERNAL_ERROR', message);
  }
}
