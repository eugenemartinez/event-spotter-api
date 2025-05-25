import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import jwtPlugin from '@fastify/jwt';
import fp from 'fastify-plugin';

// Extend Fastify interfaces for JWT
declare module 'fastify' {
  export interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  export interface FastifyJWT {
    // Ensure this matches how you use it
    payload: { id: string; username: string /* add other payload fields if any */ };
    user: { id: string; username: string /* ensure this matches request.user */ };
  }
}

async function jwtAuthSetup(server: FastifyInstance) {
  await server.register(jwtPlugin, {
    secret: process.env.JWT_SECRET as string,
    sign: {
      expiresIn: process.env.JWT_EXPIRES_IN || '1d',
    },
    // messages: { // Optional: customize error messages
    //   badRequestErrorMessage: 'Format is Authorization: Bearer [token]',
    //   noAuthorizationInHeaderMessage: 'Authorization header is missing!',
    //   authorizationTokenExpiredMessage: 'Authorization token expired',
    //   authorizationTokenInvalid: (err) => {
    //     return `Authorization token is invalid: ${err.message}`
    //   }
    // }
  });
  server.log.info('JWT plugin registered.');

  server.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      // If you want to attach the decoded user to request.user directly after verification:
      // request.user = request.jwt.user; // or request.jwt.payload depending on your setup
    } catch (err: any) {
      server.log.warn(
        { error: { message: err.message, name: err.name }, requestId: request.id },
        'JWT verification failed',
      );
      reply.code(401).send({ message: 'Authentication required: Invalid or missing token' });
    }
  });
  server.log.info('JWT "authenticate" decorator registered');
}

export default fp(jwtAuthSetup);
