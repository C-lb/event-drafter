import type { Config } from 'drizzle-kit';

export default {
  schema: './src/schema/*.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.ED_DB_PATH ?? '../../data/app.db',
  },
} satisfies Config;
