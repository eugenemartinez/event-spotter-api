import {
  FastifyRequest,
  FastifyReply,
  RouteGenericInterface,
  FastifySchema,
  // RawServerDefault, // Not strictly needed for these definitions
  // RawRequestDefaultExpression,
  // RawReplyDefaultExpression,
  FastifyBaseLogger
} from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import * as http from 'http';
import { z } from 'zod'; // If your schema is here or imported here

// Existing AuthenticatedUser interface
export interface AuthenticatedUser {
  id: string;
  username: string;
  email?: string;
  iat?: number;
  exp?: number;
}

// Define the server and request/reply types based on your FastifyPluginAsync usage
type AppRawServer = http.Server;
type AppRawRequest = http.IncomingMessage;
type AppRawReply = http.ServerResponse;

// Zod-aware Fastify types

/**
 * A FastifyRequest type specifically for this application, configured with ZodTypeProvider.
 */
export type AppFastifyRequest<
  CurrentRouteGeneric extends RouteGenericInterface = RouteGenericInterface,
  CurrentContextConfig = unknown,
  CurrentSchemaCompiler extends FastifySchema = FastifySchema
> = FastifyRequest<
  CurrentRouteGeneric,    // 1st: RouteGeneric
  AppRawServer,           // 2nd: RawServer
  AppRawRequest,          // 3rd: RawRequest
  CurrentSchemaCompiler,  // 4th: SchemaCompiler
  ZodTypeProvider,        // 5th: TypeProvider
  CurrentContextConfig,   // 6th: ContextConfig
  FastifyBaseLogger       // 7th: Logger
  // 8th: ResolvedFastifyRequestType is inferred
>;

/**
 * A FastifyReply type specifically for this application, configured with ZodTypeProvider.
 */
export type AppFastifyReply<
  CurrentRouteGeneric extends RouteGenericInterface = RouteGenericInterface,
  CurrentContextConfig = unknown,
  // This new generic parameter will represent the actual resolved response type for the route.
  // It defaults to 'unknown' if not specified when AppFastifyReply is used.
  ActualResponseType = unknown
> = FastifyReply<
  // Assuming the order that resolved the previous error in this file:
  CurrentRouteGeneric,    // 1st: RouteGeneric
  AppRawServer,           // 2nd: RawServer
  AppRawRequest,          // 3rd: RawRequest
  AppRawReply,            // 4th: RawReply
  CurrentContextConfig,   // 5th: ContextConfig
  FastifySchema,          // 6th: SchemaCompiler (default)
  ZodTypeProvider,        // 7th: TypeProvider
  ActualResponseType      // 8th: Logger slot, now used for the resolved response type
>;

// Assuming you have a schema like this (it might be in event.schemas.ts)
// If it's in event.schemas.ts, you'd import it here.
const batchGetEventsBodySchema = z.object({
  eventIds: z.array(z.string().uuid()).min(1, "At least one event ID must be provided"),
});

export type BatchGetEventsBody = z.infer<typeof batchGetEventsBodySchema>;