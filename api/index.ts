import { IncomingMessage, ServerResponse } from 'http';
import { FastifyInstance } from 'fastify';
import { build } from '../src/app'; // Import the build function from app.ts
import { loadEnv } from '../src/config/env';

loadEnv(); // Load environment variables for Vercel

let appInstance: FastifyInstance | null = null;

async function getApp() {
  if (!appInstance) {
    appInstance = await build(); // build() now calls app.ready() internally
    console.log('Fastify app built and ready for Vercel.');
  }
  return appInstance;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  app.server.emit('request', req, res);
}
