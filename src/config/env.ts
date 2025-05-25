import dotenv from 'dotenv';
import path from 'path';

export function loadEnv() {
  const envPath =
    process.env.NODE_ENV === 'production'
      ? undefined // In production, Vercel handles env vars
      : path.resolve(process.cwd(), '.env'); // For local development

  if (envPath) {
    dotenv.config({ path: envPath });
  }
  // You can add more robust validation for required env vars here if needed
}
