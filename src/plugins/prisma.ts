import fp from 'fastify-plugin';
import prisma from '../lib/prisma'; // Import your existing Prisma client instance
import { FastifyInstance } from 'fastify';

// Extend FastifyInstance to include the prisma decorator
declare module 'fastify' {
  interface FastifyInstance {
    prisma: typeof prisma; // The type will be your PrismaClient instance
  }
}

async function prismaPlugin(fastify: FastifyInstance) {
  // Your prisma instance from 'src/lib/prisma.ts' is already initialized.
  // We just need to make sure it's connected and handle its lifecycle.

  try {
    // Prisma Client typically connects lazily on the first query.
    // However, you can explicitly connect to catch connection errors early.
    // Or, you can perform a simple query to ensure connectivity.
    await prisma.$connect(); // Or a simple query like prisma.$queryRaw`SELECT 1`
    fastify.log.info('Prisma client connected to database (via existing instance).');
  } catch (error) {
    fastify.log.error({ error }, 'Prisma client failed to connect to database (via existing instance).');
    // Depending on your app's needs, you might want to throw this error
    // to prevent the server from starting if the DB is critical.
    // throw error;
  }

  fastify.decorate('prisma', prisma);

  fastify.addHook('onClose', async (instance) => {
    await instance.prisma.$disconnect();
    instance.log.info('Prisma client disconnected (via existing instance).');
  });
}

export default fp(prismaPlugin, {
  name: 'prisma-plugin', // Give it a unique name
  // dependencies: [] // Add any plugin dependencies if necessary
});