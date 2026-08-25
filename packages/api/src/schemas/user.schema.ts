/**
 * Fastify JSON Schemas for the user routes (US-01, US-06, US-07).
 *
 * Email is validated with a regex `pattern` instead of the `format: 'email'`
 * keyword so it works with Fastify's default ajv (no `ajv-formats` plugin).
 */

/**
 * RFC-5322 style email pattern (dot-atom local part, dot-label domain). This
 * rejects consecutive dots, empty labels, and single-char TLDs that the lax
 * `^[^\s@]+@[^\s@]+\.[^\s@]+$` form would accept, while still working with
 * Fastify's default ajv (no `ajv-formats` plugin).
 */
const EMAIL_PATTERN = '^[a-zA-Z0-9!#$%&\'*+/=?^_`{|}~.-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$';

const userProperties = {
  id: { type: 'string' },
  name: { type: 'string' },
  lastName: { type: 'string' },
  email: { type: 'string' },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
};

/** A task item, possibly annotated with the requesting user's completion flag. */
const taskItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    description: { type: ['string', 'null'] },
    status: { type: 'string' },
    version: { type: 'integer' },
    completed: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

/** Single user response body. */
const userResponseSchema = {
  type: 'object',
  properties: {
    ...userProperties,
    pendingTasks: {
      type: 'array',
      items: taskItemSchema,
    },
  },
};

/** POST /users — body validation + 201 response. */
export const createUserSchema = {
  body: {
    type: 'object',
    required: ['name', 'lastName', 'email'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
      lastName: { type: 'string', minLength: 1, maxLength: 100 },
      email: { type: 'string', minLength: 3, maxLength: 254, pattern: EMAIL_PATTERN },
    },
    additionalProperties: false,
  },
  response: {
    201: userResponseSchema,
  },
};

/** GET /users — 200 response is an array of users with pending tasks. */
export const listUsersSchema = {
  response: {
    200: {
      type: 'array',
      items: userResponseSchema,
    },
  },
};

/** GET /users/:idUser/tasks — 200 response is an array of the user's tasks. */
export const getUserTasksSchema = {
  params: {
    type: 'object',
    required: ['idUser'],
    properties: {
      idUser: { type: 'string' },
    },
  },
  response: {
    200: {
      type: 'array',
      items: taskItemSchema,
    },
  },
};