import { FastifyInstance } from 'fastify';
import corsPlugin from '@fastify/cors';
import fp from 'fastify-plugin';

async function corsSetup(server: FastifyInstance) {
  const allowedOriginsEnv = process.env.CORS_ALLOWED_ORIGINS;
  await server.register(corsPlugin, {
    origin: (origin, callback) => {
      if (!allowedOriginsEnv) {
        if (process.env.NODE_ENV !== 'production') {
          callback(null, true); // Allow all in dev if not configured
          return;
        }
        // In production, if not configured, disallow.
        callback(new Error('Not allowed by CORS (CORS_ALLOWED_ORIGINS not configured)'), false);
        return;
      }
      if (allowedOriginsEnv === '*') {
        callback(null, true);
        return;
      }
      const listOfAllowedOrigins = allowedOriginsEnv.split(',').map((item) => item.trim());
      if (origin && listOfAllowedOrigins.includes(origin)) {
        callback(null, true);
      } else if (!origin && process.env.NODE_ENV !== 'production') {
        // Allow requests with no origin (e.g. server-to-server, curl) in dev
        callback(null, true);
      } else {
        callback(new Error(`Not allowed by CORS (origin: ${origin || 'N/A'})`), false);
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });
  server.log.info('CORS plugin registered with dynamic origin validation.');
}

export default fp(corsSetup);
