/**
 * Fastify JSON Schemas for the task routes (US-02, US-05, US-08).
 */

const assignmentUserSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    lastName: { type: 'string' },
    email: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const assignmentSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    taskId: { type: 'string' },
    completed: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    user: assignmentUserSchema,
  },
};

const taskProperties = {
  id: { type: 'string' },
  title: { type: 'string' },
  description: { type: ['string', 'null'] },
  status: { type: 'string', enum: ['open', 'archived'] },
  version: { type: 'integer' },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
};

/** Task without nested relations (used for the 201 create response). */
const taskResponseSchema = {
  type: 'object',
  properties: taskProperties,
};

/** Task with assignments + user data (used for list and detail responses). */
const taskWithAssignmentsSchema = {
  type: 'object',
  properties: {
    ...taskProperties,
    taskAssignments: { type: 'array', items: assignmentSchema },
  },
};

/**
 * POST /tasks — body validation + 201 response.
 * Status filter enum is deliberately NOT enforced here so an invalid value can
 * be reported as `INVALID_STATUS_FILTER` (400) rather than `VALIDATION_ERROR`.
 */
export const createTaskSchema = {
  body: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
      description: { type: 'string', minLength: 1, maxLength: 5000 },
    },
    additionalProperties: false,
  },
  response: {
    201: taskResponseSchema,
  },
};

/** GET /tasks — querystring status filter (validated manually in the route). */
export const listTasksSchema = {
  querystring: {
    type: 'object',
    properties: {
      status: { type: 'string' },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'array',
      items: taskWithAssignmentsSchema,
    },
  },
};

/** GET /tasks/:idTask — 200 response with task + assignments + user data. */
export const getTaskByIdSchema = {
  params: {
    type: 'object',
    required: ['idTask'],
    properties: {
      idTask: { type: 'string' },
    },
  },
  response: {
    200: taskWithAssignmentsSchema,
  },
};