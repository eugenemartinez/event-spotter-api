import { FastifyInstance } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit'; // Correct import name
import Redis from 'ioredis';
import fp from 'fastify-plugin';

async function rateLimitSetup(server: FastifyInstance) {
  // 1. Disable for test environment
  if (process.env.NODE_ENV === 'test') {
    server.log.warn('Rate limiting is DISABLED for NODE_ENV=test.');
    return;
  }

  const redisUrl = process.env.REDIS_URL;
  const defaultMax = parseInt(process.env.DEFAULT_RATE_LIMIT_MAX || '100', 10);
  const defaultTimeWindow = process.env.DEFAULT_RATE_LIMIT_TIME_WINDOW || '1 minute';

  if (redisUrl) {
    let redisClientInstance: Redis | undefined;
    try {
      redisClientInstance = new Redis(redisUrl, {
        maxRetriesPerRequest: 3, // Optional: sensible default
        connectTimeout: 5000, // Optional: sensible default
        // Add any other Redis options you need
      });

      redisClientInstance.on('connect', () => {
        server.log.info('Rate limit Redis client connected.');
      });

      redisClientInstance.on('error', (err) => {
        server.log.error(
          { err },
          'Rate limit Redis client connection error. Rate limiting might fall back or fail.',
        );
        // Depending on how critical Redis is, you might want to handle this more gracefully,
        // e.g., by not registering the rate limiter or by using an in-memory fallback explicitly.
        // For now, if Redis connection fails after initial setup, @fastify/rate-limit might error out on requests.
      });

      server.log.info('Registering @fastify/rate-limit with Redis store.');
      await server.register(fastifyRateLimit, {
        max: defaultMax,
        timeWindow: defaultTimeWindow,
        redis: redisClientInstance, // Use the ioredis client instance
        keyGenerator: function (request) {
          // Consider if request.user is available and preferred for authenticated users
          // return request.user?.id || request.ip;
          return request.ip;
        },
        // Optional: customize error response
        // errorResponseBuilder: function (request, context) {
        //   return { statusCode: 429, error: 'Too Many Requests', message: `Rate limit exceeded, retry in ${context.after}` };
        // },
      });
      server.log.info('@fastify/rate-limit registered successfully with Redis.');

      // Graceful shutdown for this specific Redis client
      server.addHook('onClose', async (instance) => {
        if (redisClientInstance) {
          await redisClientInstance.quit();
          instance.log.info('Rate limit Redis client disconnected.');
        }
      });
    } catch (error) {
      server.log.error(
        { error },
        'Failed to initialize Redis for rate limiting. Falling back to in-memory store.',
      );
      // Fallback to in-memory if Redis instantiation fails
      await server.register(fastifyRateLimit, {
        max: defaultMax,
        timeWindow: defaultTimeWindow,
        keyGenerator: function (request) {
          return request.ip;
        },
      });
      server.log.info(
        '@fastify/rate-limit registered successfully with in-memory store (due to Redis init failure).',
      );
    }
  } else {
    server.log.warn('REDIS_URL not found. Rate limiting will use in-memory store.');
    await server.register(fastifyRateLimit, {
      max: defaultMax,
      timeWindow: defaultTimeWindow,
      keyGenerator: function (request) {
        return request.ip;
      },
    });
    server.log.info('@fastify/rate-limit registered successfully with in-memory store.');
  }
}

export default fp(rateLimitSetup, { name: 'rate-limit-setup' }); // Added a name for the plugin
