import type { Config } from 'drizzle-kit';

export default {
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.VIP_DB_PATH ?? '../../data/app.db',
  },
} satisfies Config;
