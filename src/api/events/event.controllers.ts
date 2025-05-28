import { ZodError } from 'zod';
import prisma, { Prisma } from '../../lib/prisma';
import {
  createEventSchema, // Import the schema itself
  CreateEventInput,
  ApiEventResponse,
  EventParams,
  EventListQuery, // Corrected from EventListQuerySchemaType if that was a typo
  UpdateEventInput,
  BatchGetEventsBody,
} from './event.schemas';
import { AppFastifyRequest, AppFastifyReply, AuthenticatedUser } from '../../types'; // Import App types

const MAX_EVENTS_LIMIT = 500; // Define the limit
const MAX_SAVED_EVENTS_LIMIT = 500; // Define the limit for saved events

// Prisma Event type (can be shared or imported)
export type PrismaEventType = Prisma.EventGetPayload<{
  select: {
    id: true;
    userId: true;
    title: true;
    description: true;
    eventDate: true;
    eventTime: true;
    locationDescription: true;
    organizerName: true;
    category: true;
    tags: true;
    websiteUrl: true;
    createdAt: true;
    updatedAt: true;
  };
}>;

// Helper functions (these can also be in a separate utils file if used more broadly)
export const formatPrismaTime = (date: Date | null): string | null => {
  if (!date) return null;
  return date.toISOString().substring(11, 19);
};

export const formatPrismaDate = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

export const transformEventForApi = (event: PrismaEventType): ApiEventResponse => {
  return {
    id: event.id,
    userId: event.userId,
    title: event.title,
    description: event.description,
    eventDate: formatPrismaDate(event.eventDate),
    eventTime: formatPrismaTime(event.eventTime),
    locationDescription: event.locationDescription,
    organizerName: event.organizerName,
    category: event.category,
    tags: event.tags,
    websiteUrl: event.websiteUrl,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
};

const timeStringToDate = (timeString: string | null | undefined): Date | null => {
  if (!timeString) return null;
  // Ensures time is interpreted in UTC to match Prisma's storage of @db.Time
  return new Date(`1970-01-01T${timeString}Z`);
};

// Common select object for Prisma queries
export const commonEventSelect: Prisma.EventSelect = {
  id: true,
  userId: true,
  title: true,
  description: true,
  eventDate: true,
  eventTime: true,
  locationDescription: true,
  organizerName: true,
  category: true,
  tags: true,
  websiteUrl: true,
  createdAt: true,
  updatedAt: true,
};

// --- Controller for POST /api/events - Create a new event ---
export async function createEventHandler(
  request: AppFastifyRequest<{ Body: CreateEventInput }>,
  reply: AppFastifyReply<{ Body: CreateEventInput }>,
) {
  const user = request.user as AuthenticatedUser;

  try {
    // Check event count limit
    const eventCount = await prisma.event.count();
    if (eventCount >= MAX_EVENTS_LIMIT) {
      request.log.warn({ currentCount: eventCount, limit: MAX_EVENTS_LIMIT }, 'Event creation limit reached.');
      return reply.code(503).send({ message: 'Event creation limit reached. Please try again later.' });
    }

    // Explicitly parse and validate the body using the Zod schema
    // This makes the controller robust even if Fastify's pre-validation is bypassed (like in unit tests)
    // or if you want an extra layer of validation.
    const validatedBody = createEventSchema.parse(request.body);

    const {
      title,
      description,
      eventDate,
      eventTime,
      locationDescription,
      category,
      tags,
      websiteUrl,
    } = validatedBody; // Use validatedBody from now on
    const organizerNameToUse = validatedBody.organizerName || user.username;

    const prismaEventDate = new Date(eventDate);
    const prismaEventTime = timeStringToDate(eventTime);

    const newEventFromDb = await prisma.event.create({
      data: {
        user: { connect: { id: user.id } },
        title,
        description,
        eventDate: prismaEventDate,
        eventTime: prismaEventTime,
        locationDescription,
        organizerName: organizerNameToUse,
        category,
        tags: tags || [], // Zod schema defaults tags to [], so validatedBody.tags will exist
        websiteUrl,
      },
      select: commonEventSelect,
    });
    request.log.info(
      { eventId: newEventFromDb.id, userId: user.id, title: newEventFromDb.title },
      'Event created successfully.',
    );
    return reply.code(201).send(transformEventForApi(newEventFromDb));
  } catch (error: unknown) {
    request.log.error({ error, body: request.body, userId: user.id }, 'Error creating event');
    if (error instanceof ZodError) {
      // This will now catch the error from createEventSchema.parse(request.body)
      return reply
        .code(400)
        .send({ message: 'Validation error', errors: error.flatten().fieldErrors });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return reply
        .code(409)
        .send({ message: 'Conflict: An event with similar unique details might already exist.' });
    }
    return reply.code(500).send({ message: 'An error occurred while creating the event.' });
  }
}

// --- Controller for GET /api/events/:eventId ---
export async function getEventByIdHandler(
  request: AppFastifyRequest<{ Params: EventParams }>,
  reply: AppFastifyReply<{ Params: EventParams }>,
) {
  const { eventId } = request.params;
  try {
    const eventFromDb = await prisma.event.findUnique({
      where: { id: eventId },
      select: commonEventSelect,
    });
    if (!eventFromDb) {
      return reply.code(404).send({ message: 'Event not found.' });
    }
    return reply.code(200).send(transformEventForApi(eventFromDb));
  } catch (error: unknown) {
    request.log.error({ error, eventId }, 'Error fetching event by ID');
    return reply.code(500).send({ message: 'An error occurred while fetching the event.' });
  }
}

// --- Controller for GET /api/events - List all events ---
export async function listEventsHandler(
  request: AppFastifyRequest<{ Querystring: EventListQuery }>,
  reply: AppFastifyReply<{ Querystring: EventListQuery }>,
) {
  const {
    page,
    limit,
    category,
    startDate,
    endDate,
    sortBy,
    sortOrder,
    search,
    tags: queryTags,
  } = request.query;
  let parsedTags: string[] | undefined = undefined;
  if (queryTags && typeof queryTags === 'string') {
    parsedTags = queryTags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }

  try {
    const skip = (page - 1) * limit;
    const whereConditions: Prisma.EventWhereInput[] = [];

    if (category) {
      whereConditions.push({ category });
    }
    if (parsedTags && parsedTags.length > 0) {
      whereConditions.push({ tags: { hasSome: parsedTags } });
    }
    if (startDate) {
      whereConditions.push({ eventDate: { gte: new Date(startDate) } });
    }
    if (endDate) {
      whereConditions.push({ eventDate: { lte: new Date(endDate) } });
    }
    if (search) {
      whereConditions.push({
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { locationDescription: { contains: search, mode: 'insensitive' } },
          { organizerName: { contains: search, mode: 'insensitive' } },
          { category: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const finalWhereClause: Prisma.EventWhereInput =
      whereConditions.length > 0 ? { AND: whereConditions } : {};
    const orderByClauseArray: Prisma.EventOrderByWithRelationInput[] = [];
    if (sortBy) {
      orderByClauseArray.push({ [sortBy]: sortOrder });
    } else {
      orderByClauseArray.push({ createdAt: 'desc' });
    }

    const [dbEvents, totalEvents] = await prisma.$transaction([
      prisma.event.findMany({
        where: finalWhereClause,
        skip,
        take: limit,
        orderBy: orderByClauseArray,
        select: commonEventSelect,
      }),
      prisma.event.count({ where: finalWhereClause }),
    ]);

    const eventsForApi = dbEvents.map(transformEventForApi);
    const totalPages = Math.ceil(totalEvents / limit);

    return reply.code(200).send({
      events: eventsForApi,
      totalEvents,
      totalPages,
      currentPage: page,
      limit,
    });
  } catch (error: unknown) {
    request.log.error({ error, query: request.query }, 'Error fetching events');
    if (error instanceof ZodError) {
      return reply
        .code(400)
        .send({ message: 'Validation error', errors: error.flatten().fieldErrors });
    }
    return reply.code(500).send({ message: 'An error occurred while fetching events.' });
  }
}

// --- Controller for PATCH /api/events/:eventId ---
export async function updateEventHandler(
  request: AppFastifyRequest<{ Params: EventParams; Body: UpdateEventInput }>,
  reply: AppFastifyReply<{ Params: EventParams; Body: UpdateEventInput }>,
) {
  const user = request.user as AuthenticatedUser;
  const { eventId } = request.params;
  const updateDataFromRequest = request.body;

  try {
    const eventToUpdate = await prisma.event.findUnique({ where: { id: eventId } });
    if (!eventToUpdate) {
      request.log.info(
        { eventId, userId: user.id },
        'User attempted to update non-existent event.',
      );
      return reply.code(404).send({ message: 'Event not found.' });
    }
    if (eventToUpdate.userId !== user.id) {
      request.log.warn(
        { eventId, eventOwnerId: eventToUpdate.userId, attemptingUserId: user.id },
        'User authorization failed: Attempt to update event they do not own.',
      );
      return reply.code(403).send({ message: 'You are not authorized to update this event.' });
    }

    request.log.info(
      { eventId, userId: user.id, updateData: updateDataFromRequest },
      'User authorized and attempting to update event.',
    );

    const dataForPrisma: Prisma.EventUpdateInput = {};
    if (updateDataFromRequest.title !== undefined)
      dataForPrisma.title = updateDataFromRequest.title;
    if (updateDataFromRequest.description !== undefined)
      dataForPrisma.description = updateDataFromRequest.description;
    if (updateDataFromRequest.eventDate !== undefined)
      dataForPrisma.eventDate = new Date(updateDataFromRequest.eventDate);
    if (updateDataFromRequest.eventTime !== undefined)
      dataForPrisma.eventTime = timeStringToDate(updateDataFromRequest.eventTime);
    if (updateDataFromRequest.locationDescription !== undefined)
      dataForPrisma.locationDescription = updateDataFromRequest.locationDescription;
    if (updateDataFromRequest.organizerName !== undefined)
      dataForPrisma.organizerName = updateDataFromRequest.organizerName;
    if (updateDataFromRequest.category !== undefined)
      dataForPrisma.category = updateDataFromRequest.category;
    if (updateDataFromRequest.tags !== undefined) dataForPrisma.tags = updateDataFromRequest.tags;
    if (updateDataFromRequest.websiteUrl !== undefined)
      dataForPrisma.websiteUrl = updateDataFromRequest.websiteUrl;

    const updatedEventFromDb = await prisma.event.update({
      where: { id: eventId },
      data: dataForPrisma,
      select: commonEventSelect,
    });
    request.log.info({ eventId, userId: user.id }, 'Event updated successfully by owner.');
    return reply.code(200).send(transformEventForApi(updatedEventFromDb));
  } catch (error: unknown) {
    request.log.error(
      { error, eventId, updateData: updateDataFromRequest, userId: user.id },
      'Error updating event',
    );
    if (error instanceof ZodError) {
      return reply
        .code(400)
        .send({ message: 'Validation error', errors: error.flatten().fieldErrors });
    }
    return reply.code(500).send({ message: 'An error occurred while updating the event.' });
  }
}

// --- Controller for DELETE /api/events/:eventId ---
export async function deleteEventHandler(
  request: AppFastifyRequest<{ Params: EventParams }>,
  reply: AppFastifyReply<{ Params: EventParams }>,
) {
  const user = request.user as AuthenticatedUser;
  const { eventId } = request.params;
  try {
    const event = await prisma.event.findUnique({ where: { id: eventId } });

    if (!event) {
      request.log.info(
        { eventId, userId: user.id },
        'User attempted to delete non-existent event.',
      );
      return reply.code(404).send({ message: 'Event not found.' });
    }

    if (event.userId !== user.id) {
      request.log.warn(
        { eventId, eventOwnerId: event.userId, attemptingUserId: user.id },
        'User authorization failed: Attempt to delete event they do not own.',
      );
      return reply.code(403).send({ message: 'You are not authorized to delete this event.' });
    }

    request.log.info(
      { eventId, userId: user.id },
      'User authorized and attempting to delete event.',
    );

    await prisma.event.delete({ where: { id: eventId } });
    request.log.info({ eventId, userId: user.id }, 'Event deleted successfully by owner.');
    return reply.code(204).send(null);
  } catch (error: unknown) {
    request.log.error({ error, eventId, userId: user.id }, 'Error deleting event');
    return reply.code(500).send({ message: 'An error occurred while deleting the event.' });
  }
}

// --- Controller for POST /api/events/:eventId/save ---
export async function saveEventHandler(
  request: AppFastifyRequest<{ Params: EventParams }>,
  reply: AppFastifyReply<{ Params: EventParams }>,
) {
  const user = request.user as AuthenticatedUser;
  const { eventId } = request.params;

  try {
    // Check saved event count limit
    const savedEventCount = await prisma.userSavedEvent.count();
    if (savedEventCount >= MAX_SAVED_EVENTS_LIMIT) {
      request.log.warn({ currentCount: savedEventCount, limit: MAX_SAVED_EVENTS_LIMIT }, 'Event saving limit reached.');
      return reply.code(503).send({ message: 'Event saving limit reached. Please try again later.' });
    }

    const eventExists = await prisma.event.count({ where: { id: eventId } });
    if (!eventExists) {
      request.log.warn(
        { userId: user.id, eventId },
        'Attempt to save non-existent event.',
      );
      return reply.code(404).send({ message: 'Event not found.' });
    }

    const existingSave = await prisma.userSavedEvent.findUnique({
      where: { userId_eventId: { userId: user.id, eventId } },
    });
    if (existingSave) {
      request.log.info(
        { userId: user.id, eventId },
        'Event already saved by user.',
      );
      return reply.code(200).send({ message: 'Event already saved.' });
    }

    await prisma.userSavedEvent.create({
      data: { userId: user.id, eventId: eventId },
    });

    // Keep this if it helped the "save successful" log pass
    await Promise.resolve(); 

    request.log.info(
      { userId: user.id, eventId },
      'Event saved successfully by user.',
    );
    return reply.code(201).send({ message: 'Event saved successfully.' });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      request.log.warn(
        { error, userId: user.id, eventId },
        'Foreign key constraint violation while saving event (P2003).',
      );
      return reply.code(404).send({ message: 'Event not found or user invalid.' });
    }
    request.log.error({ error, eventId, userId: user.id }, 'Error saving event');
    return reply.code(500).send({ message: 'An error occurred while saving the event.' });
  }
}

// --- Controller for DELETE /api/events/:eventId/save ---
export async function unsaveEventHandler(
  request: AppFastifyRequest<{ Params: EventParams }>,
  reply: AppFastifyReply<{ Params: EventParams }>,
) {
  const user = request.user as AuthenticatedUser;
  const { eventId } = request.params;
  try {
    await prisma.userSavedEvent.delete({
      where: { userId_eventId: { userId: user.id, eventId: eventId } },
    });
    return reply.code(204).send();
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      // P2025 means "Record to delete not found." - this is okay for unsave, means it wasn't saved.
      // Depending on desired behavior, you could return 204 or a specific 404.
      // For idempotency, 204 is often preferred.
      request.log.info(
        { eventId, userId: user.id },
        'User attempted to unsave an event that was not saved or already unsaved.',
      );
      return reply.code(204).send();
      // If you strictly want to indicate "it was not found to be unsaved", then 404:
      // return reply.code(404).send({ message: "Saved event not found for this user." });
    }
    request.log.error({ error, eventId, userId: user.id }, 'Error unsaving event');
    return reply.code(500).send({ message: 'An error occurred while unsaving the event.' });
  }
}

// --- Controller for GET /api/events/categories ---
export async function getEventCategoriesHandler(
  _request: AppFastifyRequest, // No specific generics needed
  reply: AppFastifyReply,
) {
  try {
    const distinctCategories = await prisma.event.findMany({
      select: { category: true },
      distinct: ['category'],
    });
    const categories = distinctCategories.map((c) => c.category).sort();
    return reply.code(200).send({ categories });
  } catch (error: unknown) {
    reply.log.error(error, 'Error fetching event categories'); // Use reply.log or request.log
    return reply.code(500).send({ message: 'An error occurred while fetching event categories.' });
  }
}

// --- Controller for GET /api/events/tags ---
export async function getEventTagsHandler(_request: AppFastifyRequest, reply: AppFastifyReply) {
  try {
    const eventsWithTags = await prisma.event.findMany({
      select: { tags: true },
      where: { tags: { isEmpty: false } },
    });
    const allTags = eventsWithTags.flatMap((e) => e.tags);
    // Corrected logic: trim, convert to consistent case (e.g., lowercase) for Set, then filter empty, then sort
    const uniqueTags = [...new Set(allTags.map((tag) => tag.trim().toLowerCase()))] // Convert to lowercase for uniqueness
      .filter((t) => t !== '') // Filter out tags that became empty after trimming
      .sort();

    return reply.code(200).send({ tags: uniqueTags });
  } catch (error: unknown) {
    reply.log.error(error, 'Error fetching event tags');
    return reply.code(500).send({ message: 'An error occurred while fetching event tags.' });
  }
}

// --- Controller for POST /api/events/batch-get ---
export async function batchGetEventsHandler(
  request: AppFastifyRequest<{ Body: BatchGetEventsBody }>,
  reply: AppFastifyReply<{ Body: BatchGetEventsBody }>,
) {
  const { eventIds } = request.body;
  try {
    const dbEvents = await prisma.event.findMany({
      where: { id: { in: eventIds } },
      select: commonEventSelect,
    });
    const eventsForApi = dbEvents.map(transformEventForApi);
    return reply.code(200).send({ events: eventsForApi });
  } catch (error: unknown) {
    request.log.error({ error, eventIds }, 'Error in batch-get events');
    return reply.code(500).send({ message: 'An error occurred while fetching events.' });
  }
}

// --- Controller for GET /api/events/random ---
export async function getRandomEventHandler(
  _request: AppFastifyRequest, // No specific generics needed
  reply: AppFastifyReply,
) {
  try {
    const totalEvents = await prisma.event.count();
    if (totalEvents === 0) return reply.code(404).send({ message: 'No events found.' });

    const randomSkip = Math.floor(Math.random() * totalEvents);
    // FindMany with skip/take can be inefficient for true random on large datasets
    // but is simple for smaller ones. Consider DB-specific random functions for optimization.
    const randomEvents = await prisma.event.findMany({
      skip: randomSkip,
      take: 1,
      select: commonEventSelect,
    });

    if (randomEvents.length === 0) {
      // This case might happen if totalEvents changes between count and findMany, or if skip is exactly totalEvents
      // Fallback to fetching the first event or any event if the random pick fails.
      const firstEvent = await prisma.event.findFirst({ select: commonEventSelect });
      if (!firstEvent) return reply.code(404).send({ message: 'No events found (fallback).' });
      return reply.code(200).send(transformEventForApi(firstEvent));
    }
    return reply.code(200).send(transformEventForApi(randomEvents[0]));
  } catch (error: unknown) {
    reply.log.error({ error }, 'Error fetching random event');
    return reply.code(500).send({ message: 'An error occurred while fetching a random event.' });
  }
}
