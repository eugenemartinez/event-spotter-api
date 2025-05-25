import { z } from 'zod';

// --- Base Event fields for API responses ---
// Aligns with PRD: separate date and time, specific field names
const baseApiEventFields = {
  id: z.string().uuid().describe('The unique identifier for the event.'),
  userId: z.string().uuid().describe('The unique identifier of the user who created the event.'),
  title: z.string().describe('The title of the event.'),
  description: z.string().describe('A detailed description of the event.'),
  eventDate: z
    .string()
    .date('Invalid date format. Expected YYYY-MM-DD')
    .describe('The date of the event (YYYY-MM-DD)'),
  eventTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/, 'Invalid time format. Expected HH:mm:ss')
    .nullable()
    .describe('The time of the event (HH:mm:ss). Nullable'),
  locationDescription: z.string().describe("A textual description of the event's location."),
  organizerName: z.string().describe('The name of the event organizer.'),
  category: z.string().describe('The category of the event.'),
  tags: z.array(z.string()).describe('An array of tags associated with the event.'),
  websiteUrl: z
    .string()
    .url({ message: 'Invalid URL format for website' })
    .nullable()
    .describe('The official website URL for the event. Nullable'),
  createdAt: z.string().datetime().describe('Timestamp of event creation.'),
  updatedAt: z.string().datetime().describe('Timestamp of last event update.'),
};

export const apiEventResponseSchema = z
  .object(baseApiEventFields)
  .describe('Detailed information about an event.');
export type ApiEventResponse = z.infer<typeof apiEventResponseSchema>;

// --- Schema for creating an event ---
// Aligns with PRD: separate date and time inputs, required fields
export const createEventSchema = z
  .object({
    title: z
      .string()
      .min(3, 'Title must be at least 3 characters long')
      .max(255, 'Title must be at most 255 characters long'),
    description: z.string().min(10, 'Description must be at least 10 characters long'),
    eventDate: z.string().date('eventDate must be a valid date string in YYYY-MM-DD format'),
    eventTime: z
      .string()
      .regex(
        /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/,
        'eventTime must be a valid time string in HH:mm or HH:mm:ss format',
      )
      .nullable()
      .optional(),
    locationDescription: z.string().min(1, 'Location description cannot be empty'),
    organizerName: z
      .string()
      .min(1, 'Organizer name must be at least 1 character if provided')
      .max(100)
      .optional()
      .describe(
        "The name of the event organizer. If omitted, the event creator's username will be used.",
      ),
    category: z
      .string()
      .min(1, 'Category cannot be empty')
      .max(100, 'Category must be at most 100 characters long'),
    tags: z
      .array(z.string().max(50, 'Each tag must be at most 50 characters long'))
      .optional()
      .default([]),
    websiteUrl: z
      .string()
      .url({ message: 'Invalid URL format for website' })
      .max(2048, 'Website URL must be at most 2048 characters long')
      .nullable()
      .optional(),
  })
  .describe('Payload for creating a new event.');
export type CreateEventInput = z.infer<typeof createEventSchema>;

// --- Schema for updating an event ---
// All fields are optional, but at least one must be provided.
export const updateEventSchema = createEventSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  })
  .describe('Payload for updating an existing event. At least one field must be provided.');
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

// --- Schema for event ID parameter ---
export const eventParamsSchema = z.object({
  eventId: z.string().uuid({ message: 'Event ID must be a valid UUID' }),
});
export type EventParams = z.infer<typeof eventParamsSchema>;

// --- Schema for listing events (query parameters) ---
export const eventListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    category: z.string().optional(),
    tags: z
      .string()
      .optional()
      .describe("Comma-separated list of tags to filter by (e.g., 'tag1,tag2,tag3')"),
    startDate: z
      .string()
      .date('Invalid startDate format. Expected YYYY-MM-DD')
      .optional()
      .describe('Filter events on or after this date (inclusive)'),
    endDate: z
      .string()
      .date('Invalid endDate format. Expected YYYY-MM-DD')
      .optional()
      .describe('Filter events on or before this date (inclusive)'),
    sortBy: z
      .enum(['eventDate', 'title', 'createdAt', 'organizerName', 'category'])
      .default('createdAt')
      .optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
    search: z
      .string()
      .min(1, 'Search term must be at least 1 character')
      .optional()
      .describe(
        'Search term for title, description, locationDescription, organizerName, or category',
      ), // Added message, no period
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return new Date(data.endDate) >= new Date(data.startDate);
      }
      return true;
    },
    { message: 'endDate cannot be before startDate', path: ['endDate'] },
  );
export type EventListQuery = z.infer<typeof eventListQuerySchema>;

// --- Schema for paginated event responses ---
export const paginatedEventsResponseSchema = z
  .object({
    events: z.array(apiEventResponseSchema),
    totalEvents: z.number().int(),
    totalPages: z.number().int(),
    currentPage: z.number().int(),
    limit: z.number().int(),
  })
  .describe('A paginated list of events.');

// --- Schemas for distinct categories and tags ---
export const eventCategoriesResponseSchema = z
  .object({
    categories: z.array(z.string()),
  })
  .describe('A list of unique event categories.');

export const eventTagsResponseSchema = z
  .object({
    tags: z.array(z.string()),
  })
  .describe('A list of unique event tags.');

// --- Schemas for batch event retrieval ---
export const batchGetEventsBodySchema = z
  .object({
    eventIds: z
      .array(z.string().uuid({ message: 'Each event ID must be a valid UUID' }))
      .min(1, 'At least one event ID must be provided'),
  })
  .describe('Payload for retrieving multiple events by their IDs.');
export type BatchGetEventsBody = z.infer<typeof batchGetEventsBodySchema>;

export const batchGetEventsResponseSchema = z
  .object({
    events: z.array(apiEventResponseSchema),
  })
  .describe('A list of events retrieved by their IDs.');

// --- Generic Success Message ---
export const successMessageResponseSchema = z
  .object({
    message: z.string(),
  })
  .describe('A generic success message.');

// --- Standard Error Schemas ---
// These are standard HTTP error responses.
export const errorResponseSchema400 = z
  .object({ message: z.string(), errors: z.any().optional() })
  .describe('Bad Request: Validation error or invalid input.');
export const errorResponseSchema401 = z
  .object({ message: z.string() })
  .describe(
    'Unauthorized: Authentication is required and has failed or has not yet been provided.',
  );
export const errorResponseSchema403 = z
  .object({ message: z.string() })
  .describe('Forbidden: The server understood the request, but is refusing to fulfill it.');
export const errorResponseSchema404 = z
  .object({ message: z.string() })
  .describe('Not Found: The requested resource could not be found.');
export const errorResponseSchema409 = z
  .object({ message: z.string() })
  .describe(
    'Conflict: The request could not be completed due to a conflict with the current state of the resource.',
  );
export const errorResponseSchema500 = z
  .object({ message: z.string() })
  .describe(
    'Internal Server Error: A generic error message, given when an unexpected condition was encountered.',
  );

// --- Schema for the new /api/users/me/saved-events endpoint ---
// This will also use the paginatedEventsResponseSchema as it returns a list of events.
// No specific new schema needed here if it just returns events, but we'll need a route.
