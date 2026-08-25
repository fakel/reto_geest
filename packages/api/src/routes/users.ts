import type { FastifyInstance } from 'fastify';
import { createUserSchema, getUserTasksSchema, listUsersSchema } from '../schemas/user.schema';
import { createUser, getAllUsers, getUserTasks } from '../services/user.service';

/**
 * User routes (US-01, US-06, US-07).
 *
 * Registered by the app factory under the `/users` prefix.
 *   POST /users                      → 201 | 400 | 409
 *   GET  /users                     → 200
 *   GET  /users/:idUser/tasks      → 200 | 404
 */
export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.post('', { schema: createUserSchema }, async (req, reply) => {
    const body = req.body as { name: string; lastName: string; email: string };
    const user = await createUser(body);
    return reply.status(201).send(user);
  });

  app.get('', { schema: listUsersSchema }, async () => {
    return getAllUsers();
  });

  app.get('/:idUser/tasks', { schema: getUserTasksSchema }, async (req) => {
    const { idUser } = req.params as { idUser: string };
    return getUserTasks(idUser);
  });
}