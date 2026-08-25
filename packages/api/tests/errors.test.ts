import { describe, it, expect } from 'vitest';
import {
  AppError,
  BadRequestError,
  NotFoundError,
  ConflictError,
  InternalError,
} from '../src/services/errors';

describe('AppError hierarchy', () => {
  it('AppError base class sets statusCode, code, message, and name', () => {
    const err = new AppError(418, 'TEAPOT', 'I am a teapot');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(418);
    expect(err.code).toBe('TEAPOT');
    expect(err.message).toBe('I am a teapot');
    expect(err.name).toBe('AppError');
  });

  it('BadRequestError is an AppError with status 400', () => {
    const err = new BadRequestError('VALIDATION_ERROR', 'Bad input');
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.name).toBe('BadRequestError');
  });

  it('NotFoundError is an AppError with status 404', () => {
    const err = new NotFoundError('USER_NOT_FOUND', 'User not found');
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('USER_NOT_FOUND');
    expect(err.message).toBe('User not found');
  });

  it('ConflictError is an AppError with status 409', () => {
    const err = new ConflictError('VERSION_CONFLICT', 'Optimistic lock failed');
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('VERSION_CONFLICT');
  });

  it('InternalError is an AppError with status 500 and default code/message', () => {
    const err = new InternalError();
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(InternalError);
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.message).toBe('An unexpected error occurred');
  });

  it('InternalError accepts a custom message', () => {
    const err = new InternalError('database connection refused');
    expect(err.message).toBe('database connection refused');
  });

  it('errors are instanceof Error after being thrown (prototype chain intact)', () => {
    try {
      throw new NotFoundError('TASK_NOT_FOUND', 'No task');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(AppError);
      expect(e).toBeInstanceOf(NotFoundError);
      const appErr = e as AppError;
      expect(appErr.statusCode).toBe(404);
    }
  });
});
