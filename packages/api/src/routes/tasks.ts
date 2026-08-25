import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createTaskSchema, getTaskByIdSchema, listTasksSchema } from '../schemas/task.schema';
import { createTask, getAllTasks, getTaskById } from '../services/task.service';

/**
 * Task routes (US-02, US-05, US-08).
 *
 * Registered by the app factory under the `/tasks` prefix.
 *   POST /tasks                 → 201 | 400 | 409
 *   GET  /tasks                → 200 (supports ?status=open|archived)
 *   GET  /tasks/:idTask      → 200 | 404
 */

interface ListQuery {
  status?: string;
}

/**
 * The querystring schema does not constrain `status` to an enum, so we validate
 * it here and throw `INVALID_STATUS_FILTER` (400) for anything but open/archived.
 */
async function listTasksHandler(req: FastifyRequest): Promise<ReturnType<typeof getAllTasks>> {
  const query = req.query as ListQuery;
  const filter = query.status as 'open' | 'archived' | undefined;
  return getAllTasks(filter);
}

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.post('', { schema: createTaskSchema }, async (req, reply: FastifyReply) => {
    const body = req.body as { title: string; description?: string };
    const task = await createTask(body);
    return reply.status(201).send(task);
  });

  app.get('', { schema: listTasksSchema }, listTasksHandler);

  app.get('/:idTask', { schema: getTaskByIdSchema }, async (req) => {
    const { idTask } = req.params as { idTask: string };
    return getTaskById(idTask);
  });
}