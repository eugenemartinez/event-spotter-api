import Fastify, {
  FastifyInstance,
  FastifyBaseLogger,
  RawServerDefault,
  FastifyServerOptions, // Import FastifyServerOptions
} from 'fastify';
import { ZodTypeProvider, validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { z } from 'zod';
import sensible from '@fastify/sensible';
import Redis from 'ioredis';
import { IncomingMessage, ServerResponse } from 'http';
import pino, { LoggerOptions as PinoLoggerOptions, DestinationStream } from 'pino';

// Import plugin setup functions
import { registerErrorHandler } from './lib/errorHandler';
import corsSetup from './plugins/cors';
import jwtAuthSetup from './plugins/jwtAuth';
import rateLimitSetup from './plugins/rateLimit';
import swaggerSetup from './plugins/swagger';
import staticSetup from './plugins/static';
import prismaPlugin from './plugins/prisma';

// Import route handlers
import authRoutes from './api/auth/auth.routes';
import eventRoutes from './api/events/event.routes';

// Assuming defaultFastifyOptions is an object of FastifyServerOptions
import { defaultFastifyOptions } from './config/logger';

const pinoTestConfig: PinoLoggerOptions = {
  level: 'silent',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l o',
      ignore: 'pid,hostname,reqId,req,res,responseTime',
    },
  },
  // base is optional, omit if no specific base properties for tests
  // base: {},
};

const pinoDefaultConfig: PinoLoggerOptions = {
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l o',
      ignore: 'pid,hostname',
    },
  },
  // base is optional, omit if no specific base properties for default
  // base: {},
};

const pinoConfig: PinoLoggerOptions =
  process.env.NODE_ENV === 'test' ? pinoTestConfig : pinoDefaultConfig;

// Define a more specific type for opts based on the Fastify factory's generics
type AppFastifyServerOptions = FastifyServerOptions<RawServerDefault, FastifyBaseLogger>;

export async function build(opts: Partial<AppFastifyServerOptions> = {}): Promise<FastifyInstance> {
  const app = Fastify<
    RawServerDefault,
    IncomingMessage,
    ServerResponse,
    FastifyBaseLogger,
    ZodTypeProvider
  >({
    // Spread defaultFastifyOptions first so they can be overridden by pinoConfig or opts
    ...(defaultFastifyOptions || {}), // Ensure defaultFastifyOptions is an object, or provide empty if undefined
    logger: pinoConfig, // Explicitly set logger, overrides any logger in defaultFastifyOptions
    ...opts, // Spread specific opts for this build, overrides defaults and pinoConfig if keys match
    requestIdHeader: 'X-Request-Id', // Ensure these are not overridden if they are critical
    requestIdLogLabel: 'reqId',
    disableRequestLogging: false,
  });

  // --- Core Fastify Setup (Synchronous) ---
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app); // Error handler

  // --- Redis (Optional, based on your server.ts) ---
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const globalRedisClient = new Redis(redisUrl);
    globalRedisClient.on('connect', () => {
      app.log.info('Global Redis client connected for app instance.');
    });
    globalRedisClient.on('error', (err) => {
      app.log.error({ err }, 'Global Redis client connection error for app instance.');
    });
    app.addHook('onClose', async (instance) => {
      await globalRedisClient.quit();
      instance.log.info('Global Redis client disconnected for app instance.');
    });
    // You might want to decorate redis client onto app if needed by plugins/routes
    // app.decorate('redis', globalRedisClient);
  } else {
    app.log.warn('REDIS_URL not found. Redis-dependent features might be affected.');
  }

  // --- Register Plugins ---
  await app.register(sensible);
  await app.register(corsSetup);
  await app.register(jwtAuthSetup);
  await app.register(staticSetup);
  await app.register(rateLimitSetup);
  await app.register(swaggerSetup);
  await app.register(prismaPlugin); // Register Prisma plugin

  // --- Register API Routes ---
  app.log.info('Registering authRoutes...');
  await app.register(authRoutes, { prefix: '/api/auth' });
  app.log.info('Registering eventRoutes...');
  await app.register(eventRoutes, { prefix: '/api/events' });

  // API Base Route
  app.get(
    '/api',
    {
      schema: {
        description: 'API base information',
        tags: ['Health'], // Or a new tag like 'General' or 'API Info'
        summary: 'Provides basic API information and links to main categories',
        response: {
          200: z.object({
            message: z.string(),
            available_endpoints: z.array(z.string()),
            documentation: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      let apiHostBase: string;

      if (process.env.NODE_ENV === 'production') {
        const productionUrl = process.env.PUBLIC_DOMAIN_URL || process.env.VERCEL_URL;
        if (productionUrl) {
          apiHostBase = productionUrl.startsWith('http')
            ? productionUrl
            : `https://${productionUrl}`;
        } else {
          // Fallback for production if no specific URL is set, though unlikely for Vercel
          apiHostBase = `${request.protocol}://${request.hostname}`;
          app.log.warn(
            'Production environment detected, but PUBLIC_DOMAIN_URL or VERCEL_URL not set for /api route. Using request-derived host.',
          );
        }
      } else {
        // For local development, use localhost or request-derived host
        const port = process.env.PORT || '3000';
        // Prefer localhost for consistency with openapi.yaml local dev server
        apiHostBase = `http://localhost:${port}`;
        // Alternatively, could use: apiHostBase = `${request.protocol}://${request.hostname}`;
      }

      return reply.send({
        message: 'Welcome to the EventSpotter API. Please use specific endpoints.',
        available_endpoints: [
          `${apiHostBase}/api/auth`,
          `${apiHostBase}/api/events`,
          `${apiHostBase}/api/events/categories`,
          `${apiHostBase}/api/events/tags`,
        ],
        documentation: `${apiHostBase}/documentation`,
      });
    },
  );
  app.log.info('Registered /api base route.');

  app.get(
    '/api/ping',
    {
      // Changed from /ping to /api/ping
      schema: {
        description: 'Ping endpoint',
        tags: ['Health'],
        summary: 'Responds with pong',
        response: { 200: z.object({ pong: z.string() }) },
      },
    },
    async (_request, reply) => {
      return reply.send({ pong: 'it works!' });
    },
  );
  app.log.info('Registered /api/ping test route.'); // Updated log message

  // Ensure all plugins are loaded before returning
  await app.ready();

  return app;
}
