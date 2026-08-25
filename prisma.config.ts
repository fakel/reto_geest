import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'packages/api/prisma/schema.prisma',
  migrations: {
    path: 'packages/api/prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
