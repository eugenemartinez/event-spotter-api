import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { build } from '../src/app'; // Import the build function from app.ts
import { FastifyInstance } from 'fastify';
// PrismaClient is not directly needed here if app.prisma is used

describe('Application Smoke Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // NODE_ENV should be 'test' due to setup.ts loading .env.test
    console.log(`Running tests with NODE_ENV: ${process.env.NODE_ENV}`);
    app = await build();
    // app.ready() is called at the end of the build function now
  });

  afterAll(async () => {
    await app.close();
  });

  it('should build the app instance correctly', () => {
    expect(app).toBeDefined();
    // Check if a known route is registered
    expect(app.printRoutes({ commonPrefix: false })).toContain('/api/auth/register');
    expect(app.printRoutes({ commonPrefix: false })).toContain('/ping');
  });

  it('should have the prisma client decorated on the app instance', () => {
    expect(app.prisma).toBeDefined();
  });

  it('should be able to connect to the database via app.prisma', async () => {
    try {
      // A simple query to check DB connection using the decorated prisma instance
      const result = await app.prisma.$queryRaw`SELECT 1 AS result`;
      // @ts-ignore
      expect(result[0].result).toBe(1);
      console.log('Database connection test successful via app.prisma.');
    } catch (e) {
      console.error('Database connection test via app.prisma failed:', e);
      throw e; // Fail the test if DB connection fails
    }
  });

   it('should have the authenticate utility decorated on the app instance if authPlugin is correct', () => {
      // This depends on how your authPlugin decorates 'authenticate'
      // For example, if it's app.decorate('authenticate', ...)
      expect(app.authenticate).toBeDefined();
   });
});