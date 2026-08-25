import { randomUUID } from 'node:crypto';
import type { Task, User } from '@prisma/client';
import { getPrisma } from '../config/database';
import { ConflictError, NotFoundError } from './errors';

/**
 * User service layer (US-01, US-06, US-07).
 *
 * Provides user CRUD, listing users (with their pending/open tasks), and
 * retrieving a specific user's tasks (with per-task completion status).
 */

export interface CreateUserData {
  name: string;
  lastName: string;
  email: string;
}

/** A task of a given user annotated with that user's completion flag. */
export interface UserTaskDto extends Task {
  /** Whether the requesting user has marked this task completed. */
  completed: boolean;
}

/** A user plus the tasks that are still pending (open + not completed). */
export interface UserWithPendingTasks extends User {
  pendingTasks: UserTaskDto[];
}

/** True if the thrown error was a database unique-constraint violation. */
function isUniqueViolation(e: unknown, field?: string): boolean {
  const err = e as { code?: string; message?: string };
  if (err?.code === 'P2002') return true;
  const message = err?.message ?? '';
  if (!/duplicate key|unique constraint/i.test(message)) return false;
  if (field && !message.toLowerCase().includes(field.toLowerCase())) return false;
  return true;
}

/** Normalize an email address for storage: trim whitespace and lowercase. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Create a user. Throws `EMAIL_ALREADY_EXISTS` (409) when the email is taken.
 * A UUIDv7 is generated at the application layer. The email is normalized
 * (trim + lowercase) before storage so uniqueness checks are case-insensitive.
 */
export async function createUser(data: CreateUserData): Promise<User> {
  const prisma = getPrisma();
  const email = normalizeEmail(data.email);
  try {
    return await prisma.user.create({
      data: {
        id: randomUUID(),
        name: data.name,
        lastName: data.lastName,
        email,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err, 'email')) {
      throw new ConflictError(
        'EMAIL_ALREADY_EXISTS',
        `User with email "${email}" already exists`,
      );
    }
    throw err;
  }
}

/**
 * List all users, each with their pending (open + not yet completed) tasks.
 * Returns an empty array when there are no users.
 */
export async function getAllUsers(): Promise<UserWithPendingTasks[]> {
  const prisma = getPrisma();
  const users = await prisma.user.findMany({
    include: {
      taskAssignments: {
        where: {
          completed: false,
          task: { status: 'open' },
        },
        include: { task: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  return users.map((user) => ({
    ...user,
    pendingTasks: user.taskAssignments.map((a) => ({ ...a.task, completed: a.completed })),
  }));
}

/** Fetch a single user by id, or null when it does not exist. */
export async function getUserById(id: string): Promise<User | null> {
  const prisma = getPrisma();
  return prisma.user.findUnique({ where: { id } });
}

/**
 * Fetch the tasks assigned to a user, each annotated with the completion
 * status. Throws `USER_NOT_FOUND` (404) when the user does not exist.
 */
export async function getUserTasks(userId: string): Promise<UserTaskDto[]> {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new NotFoundError('USER_NOT_FOUND', `User with id "${userId}" not found`);
  }

  const assignments = await prisma.taskAssignment.findMany({
    where: { userId },
    include: { task: true },
    orderBy: { createdAt: 'asc' },
  });

  return assignments.map((a) => ({ ...a.task, completed: a.completed }));
}