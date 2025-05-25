import { FastifyPluginAsync, FastifyPluginOptions, FastifyRequest } from 'fastify'; // Keep FastifyRequest for keyGenerator
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  createEventSchema, CreateEventInput, // Import Zod-inferred type
  apiEventResponseSchema,
  eventParamsSchema, EventParams,       // Import Zod-inferred type
  updateEventSchema, UpdateEventInput,   // Import Zod-inferred type
  eventListQuerySchema, EventListQuery, // Import Zod-inferred type
  paginatedEventsResponseSchema,
  successMessageResponseSchema,
  eventCategoriesResponseSchema,
  eventTagsResponseSchema,
  batchGetEventsBodySchema, BatchGetEventsBody, // Import Zod-inferred type
  batchGetEventsResponseSchema,
  errorResponseSchema400,
  errorResponseSchema401,
  errorResponseSchema403,
  errorResponseSchema404,
  errorResponseSchema409,
  errorResponseSchema500,
} from './event.schemas';
import {
  createEventHandler,
  listEventsHandler,
  getEventByIdHandler,
  updateEventHandler,
  deleteEventHandler,
  saveEventHandler,
  unsaveEventHandler,
  getEventCategoriesHandler,
  getEventTagsHandler,
  batchGetEventsHandler,
  getRandomEventHandler,
} from './event.controllers';

// This interface is used by keyGenerator functions below.
// Ideally, move to a shared types file (src/types/index.ts) and import here and in controllers.
interface AuthenticatedUser { // This should ideally be the AuthenticatedUser from src/types/index.ts
  id: string;
  username: string;
}

const eventRoutes: FastifyPluginAsync<FastifyPluginOptions, import('http').Server, ZodTypeProvider> = async (server, _opts) => {
  // POST /api/events - Create a new event
  server.post<{ Body: CreateEventInput }>( // Explicitly type here
    '/',
    {
      onRequest: [server.authenticate],
      schema: {
        summary: "Create a new event",
        description: "Creates a new event with the provided details. Requires authentication.",
        tags: ["Events"],
        body: createEventSchema,
        response: { 201: apiEventResponseSchema, 400: errorResponseSchema400, 401: errorResponseSchema401, 409: errorResponseSchema409, 500: errorResponseSchema500 },
      },
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 hour',
          keyGenerator: function (request: FastifyRequest) { // FastifyRequest here is generic
            const user = request.user as AuthenticatedUser | undefined;
            if (user && user.id) {
              return user.id;
            }
            server.log.warn({ path: request.raw.url, ip: request.ip, userPayload: request.user }, 'Rate limit key generator for POST /api/events falling back to IP. User object was not as expected or missing id.');
            return request.ip;
          }
        }
      }
    },
    createEventHandler
  );

  // GET /api/events - List all events (No onRequest hook, usually fine)
  server.get<{ Querystring: EventListQuery }>(
    '/',
    {
      schema: {
        summary: "List all events",
        description: "Retrieves a paginated list of events. Supports filtering, sorting, and searching.",
        tags: ["Events"],
        querystring: eventListQuerySchema,
        response: { 200: paginatedEventsResponseSchema, 400: errorResponseSchema400, 500: errorResponseSchema500 },
      },
    },
    listEventsHandler
  );

  // GET /api/events/:eventId (No onRequest hook, usually fine)
  server.get<{ Params: EventParams }>(
    '/:eventId',
    {
      schema: {
        summary: "Get a single event by ID",
        description: "Retrieves detailed information for a specific event by its UUID.",
        tags: ["Events"],
        params: eventParamsSchema,
        response: { 200: apiEventResponseSchema, 400: errorResponseSchema400, 404: errorResponseSchema404, 500: errorResponseSchema500 },
      },
    },
    getEventByIdHandler
  );

  // PATCH /api/events/:eventId
  server.patch<{ Params: EventParams; Body: UpdateEventInput }>( // Explicitly type here
    '/:eventId',
    {
      onRequest: [server.authenticate],
      schema: {
        summary: "Update an existing event",
        description: "Updates specified fields of an existing event. Requires authentication and ownership.",
        tags: ["Events"],
        params: eventParamsSchema,
        body: updateEventSchema,
        response: { 200: apiEventResponseSchema, 400:errorResponseSchema400, 401:errorResponseSchema401, 403:errorResponseSchema403, 404:errorResponseSchema404, 500:errorResponseSchema500 },
      },
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 hour',
          keyGenerator: function (request: FastifyRequest) { // FastifyRequest here is generic
            const user = request.user as AuthenticatedUser | undefined;
            if (user && user.id) {
              return user.id;
            }
            server.log.warn({ path: request.raw.url, ip: request.ip, userPayload: request.user }, 'Rate limit key generator for PATCH /api/events/:eventId falling back to IP. User object was not as expected or missing id.');
            return request.ip;
          }
        }
      }
    },
    updateEventHandler
  );

  // DELETE /api/events/:eventId
  server.delete<{ Params: EventParams }>( // Explicitly type here
    '/:eventId',
    {
      onRequest: [server.authenticate],
      schema: {
        summary: "Delete an event",
        description: "Deletes an event by its UUID. Requires authentication and ownership.",
        tags: ["Events"],
        params: eventParamsSchema,
        response: { 204: z.null(), 401: errorResponseSchema401, 403: errorResponseSchema403, 404: errorResponseSchema404, 500: errorResponseSchema500 },
      },
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 hour',
          keyGenerator: function (request: FastifyRequest) { // FastifyRequest here is generic
            const user = request.user as AuthenticatedUser | undefined;
            if (user && user.id) {
              return user.id;
            }
            server.log.warn({ path: request.raw.url, ip: request.ip, userPayload: request.user }, 'Rate limit key generator for DELETE /api/events/:eventId falling back to IP. User object was not as expected or missing id.');
            return request.ip;
          }
        }
      }
    },
    deleteEventHandler
  );

  // POST /api/events/:eventId/save
  server.post<{ Params: EventParams }>( // Explicitly type here
    '/:eventId/save',
    {
      onRequest: [server.authenticate],
      schema: {
        summary: "Save an event",
        description: "Allows an authenticated user to save an event to their list of saved events.",
        tags: ["Events", "User Actions"],
        params: eventParamsSchema,
        response: {
          201: successMessageResponseSchema.describe("Event saved successfully."),
          200: successMessageResponseSchema.describe("Event was already saved by the user."),
          400: errorResponseSchema400, 401: errorResponseSchema401, 404: errorResponseSchema404, 500: errorResponseSchema500
        }
      },
    },
    saveEventHandler
  );

  // DELETE /api/events/:eventId/save
  server.delete<{ Params: EventParams }>( // Explicitly type here
    '/:eventId/save',
    {
      onRequest: [server.authenticate],
      schema: {
        summary: "Unsave an event",
        description: "Allows an authenticated user to remove an event from their list of saved events.",
        tags: ["Events", "User Actions"],
        params: eventParamsSchema,
        response: {
          204: z.null().describe("Event unsaved successfully or was not saved. No content returned."),
          400: errorResponseSchema400,
          401: errorResponseSchema401,
          404: errorResponseSchema404,
          500: errorResponseSchema500
        }
      }
    },
    unsaveEventHandler
  );

  // GET /api/events/categories (No onRequest, no complex input, usually fine)
  server.get(
    '/categories',
    {
      schema: {
        summary: "Get all unique event categories",
        description: "Retrieves a list of all unique categories present in the events.",
        tags: ["Events"],
        response: { 200: eventCategoriesResponseSchema, 500: errorResponseSchema500 }
      }
    },
    getEventCategoriesHandler
  );

  // GET /api/events/tags (No onRequest, no complex input, usually fine)
  server.get(
    '/tags',
    {
      schema: {
        summary: "Get all unique event tags",
        description: "Retrieves a list of all unique tags present across all events.",
        tags: ["Events"],
        response: { 200: eventTagsResponseSchema, 500: errorResponseSchema500 }
      }
    },
    getEventTagsHandler
  );

  // POST /api/events/batch-get (No onRequest, but has body)
  server.post<{ Body: BatchGetEventsBody }>(
    '/batch-get',
    {
      schema: {
        summary: "Retrieve multiple events by their IDs",
        description: "Fetches a list of events based on an array of provided event UUIDs.",
        tags: ["Events"],
        body: batchGetEventsBodySchema,
        response: { 200: batchGetEventsResponseSchema, 400: errorResponseSchema400, 500: errorResponseSchema500 }
      }
    },
    batchGetEventsHandler
  );

  // GET /api/events/random (No onRequest, no complex input, usually fine)
  server.get(
    '/random',
    {
      schema: {
        summary: "Get a single random event",
        description: "Retrieves a single event chosen randomly from the database.",
        tags: ["Events"],
        response: { 200: apiEventResponseSchema, 404: errorResponseSchema404, 500: errorResponseSchema500 }
      }
    },
    getRandomEventHandler
  );

};
export default eventRoutes;