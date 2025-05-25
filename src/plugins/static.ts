import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import fastifyStatic from '@fastify/static';
import path from 'node:path';

/**
 * This plugin serves static files from the 'public' directory.
 * It's configured to serve 'index.html' for the root path '/'.
 */
async function staticSetup(server: FastifyInstance) {
  // When running src/plugins/static.ts directly (e.g. via ts-node respecting commonjs config),
  // __dirname will be /path/to/project/src/plugins.
  // When running the compiled dist/plugins/static.js,
  // __dirname will be /path/to/project/dist/plugins.
  // In both cases, going up two levels ('..', '..') and then into 'public' should correctly target the public directory.
  const publicPath = path.join(__dirname, '..', '..', 'public');

  server.log.info(`Attempting to serve static files from: ${publicPath}`);

  await server.register(fastifyStatic, {
    root: publicPath,
    prefix: '/', // Serve files from the root of the domain (e.g., /index.html)
    index: 'index.html',
    decorateReply: true, // Default is true, set to false only if you have a specific reason
  });
  server.log.info(
    'Static files plugin registered. Root "/" should serve index.html from public directory.',
  );
}

export default fp(staticSetup, {
  name: 'custom-static-setup', // Added a name for the plugin
});
