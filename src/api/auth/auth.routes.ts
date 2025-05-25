import { FastifyPluginAsync, FastifyPluginOptions } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  registerUserSchema,
  loginUserSchema,
  authSuccessResponseSchema,
  apiUserResponseSchema,
  savedEventsResponseSchema,
  updateUserProfileSchema,
  changePasswordSchema,
  UpdateUserProfileInput, // Ensure this is imported (z.infer type)
  ChangePasswordInput,    // Ensure this is imported (z.infer type)
} from './auth.schemas';
import {
    errorResponseSchema400,
    errorResponseSchema401,
    errorResponseSchema403, // Assuming you might use this too
    errorResponseSchema404, // Add this line
    errorResponseSchema409,
    errorResponseSchema500,
    successMessageResponseSchema,
} from '../events/event.schemas';
import {
  registerUserHandler,
  loginUserHandler,
  getAuthenticatedUserDetailsHandler,
  getSavedEventsHandler,
  updateUserProfileHandler,
  changePasswordHandler,
} from './auth.controllers';
// AppFastifyRequest and AppFastifyReply are used in controllers, not directly needed here if this works
// import { AppFastifyRequest, AppFastifyReply } from '../../types';

const authRoutes: FastifyPluginAsync<FastifyPluginOptions, import('http').Server, ZodTypeProvider> = async (server, _opts) => {
  // POST /api/auth/register
  server.post(
    '/register',
    {
      schema: {
        summary: "Register a new user",
        tags: ["Auth"],
        body: registerUserSchema,
        response: {
          201: authSuccessResponseSchema,
          400: errorResponseSchema400,
          409: errorResponseSchema409,
          500: errorResponseSchema500
        },
      },
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute'
        }
      }
    },
    registerUserHandler
  );

  // POST /api/auth/login
  server.post(
    '/login',
    {
      schema: {
        summary: "Log in an existing user",
        tags: ["Auth"],
        body: loginUserSchema,
        response: {
          200: authSuccessResponseSchema,
          400: errorResponseSchema400,
          401: errorResponseSchema401,
          500: errorResponseSchema500
        },
      },
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute'
        }
      }
    },
    loginUserHandler
  );

  // GET /api/auth/me - Get authenticated user's details
  server.get(
    '/me',
    {
      onRequest: [server.authenticate],
      schema: {
        summary: "Get current authenticated user's profile",
        tags: ["User Profile", "Auth"],
        security: [{ bearerAuth: [] }],
        response: {
          200: apiUserResponseSchema,
          401: errorResponseSchema401,
          404: errorResponseSchema404,
          500: errorResponseSchema500
        },
      },
    },
    getAuthenticatedUserDetailsHandler
  );

  // PATCH /api/auth/me - Update authenticated user's profile
  server.patch<{ Body: UpdateUserProfileInput }>(
    '/me',
    {
      onRequest: [server.authenticate],
      schema: {
        summary: "Update current authenticated user's profile",
        description: "Allows updating the username and/or email of the currently authenticated user.",
        tags: ["User Profile", "Auth"],
        security: [{ bearerAuth: [] }],
        body: updateUserProfileSchema, // This should align with the generic
        response: {
          200: apiUserResponseSchema,
          400: errorResponseSchema400,
          401: errorResponseSchema401,
          409: errorResponseSchema409,
          500: errorResponseSchema500
        },
      },
    },
    updateUserProfileHandler // Pass the controller directly
  );

  // POST /api/auth/me/password - Change authenticated user's password
  server.post<{ Body: ChangePasswordInput }>(
    '/me/password',
    {
      onRequest: [server.authenticate],
      schema: {
        summary: "Change current authenticated user's password",
        tags: ["User Profile", "Auth"],
        security: [{ bearerAuth: [] }],
        body: changePasswordSchema, // This should align with the generic
        response: {
          200: successMessageResponseSchema.describe("Password updated successfully."),
          400: errorResponseSchema400,
          401: errorResponseSchema401,
          500: errorResponseSchema500
        },
      },
    },
    changePasswordHandler // Pass the controller directly
  );

  // GET /api/auth/me/saved-events
  server.get(
    '/me/saved-events',
    {
      onRequest: [server.authenticate],
      schema: {
        summary: "Get events saved by the current user",
        tags: ["User Saved Events", "Auth"],
        security: [{ bearerAuth: [] }],
        response: {
          200: savedEventsResponseSchema,
          401: errorResponseSchema401,
          500: errorResponseSchema500
        },
      },
    },
    getSavedEventsHandler
  );
};
export default authRoutes;