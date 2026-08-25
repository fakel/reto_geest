import type { FastifyInstance } from 'fastify';
import { assignUsersToTask } from '../services/assign.service';

/**
 * Assignment route (US-03).
 *
 * Registered by the app factory under the `/tasks` prefix.
 *   POST /tasks/:idTask/assign → 200 | 400 | 404 | 409
 */

const assignmentResponseItem = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    taskId: { type: 'string' },
    completed: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const assignUsersSchema = {
  params: {
    type: 'object',
    required: ['idTask'],
    properties: {
      idTask: { type: 'string' },
    },
  },
  body: {
    type: 'object',
    required: ['userIds'],
    properties: {
      userIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    },
    additionalProperties: false,
  },
  response: {
    200: { type: 'array', items: assignmentResponseItem },
  },
};

interface AssignBody {
  userIds: string[];
}

export async function assignmentRoutes(app: FastifyInstance): Promise<void> {
  app.post('/:idTask/assign', { schema: assignUsersSchema }, async (req, reply) => {
    const { idTask } = req.params as { idTask: string };
    const { userIds } = req.body as AssignBody;
    const assignments = await assignUsersToTask(idTask, userIds);
    return reply.status(200).send(assignments);
  });
}