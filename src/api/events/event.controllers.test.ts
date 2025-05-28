import { Prisma as ActualPrisma, Prisma } from '@prisma/client';
import { RouteGenericInterface } from 'fastify';
import { beforeEach, afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ZodError } from 'zod';
import { AppFastifyReply, AppFastifyRequest, BatchGetEventsBody } from '../../types';
import {
  batchGetEventsHandler,
  commonEventSelect,
  createEventHandler,
  formatPrismaDate,
  formatPrismaTime,
  getEventByIdHandler,
  getEventCategoriesHandler,
  getEventTagsHandler,
  listEventsHandler,
  PrismaEventType,
  transformEventForApi,
  updateEventHandler,
  deleteEventHandler,
  saveEventHandler,
  unsaveEventHandler,
  getRandomEventHandler,
} from './event.controllers';
import {
  ApiEventResponse,
  CreateEventInput,
  EventListQuery,
  EventParams,
  UpdateEventInput,
} from './event.schemas';

// Mock the prisma client (ensure this is exactly as it was when tests were mostly passing)
vi.mock('../../lib/prisma', async (importOriginal) => {
  const actualModule = (await importOriginal()) as { default: any; Prisma: any };
  return {
    default: {
      event: {
        findMany: vi.fn(),
        create: vi.fn(),
        findUnique: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        findFirst: vi.fn(),
      },
      userSavedEvent: {
        count: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
      $transaction: vi.fn((args) => {
        if (Array.isArray(args)) {
          return Promise.all(
            args.map((op) => {
              if (typeof op.then === 'function') return op;
              if (op.model === 'event' && op.operation === 'count') return Promise.resolve(0);
              if (op.model === 'event' && op.operation === 'findMany') return Promise.resolve([]);
              return Promise.resolve(undefined);
            }),
          );
        }
        if (typeof args === 'function') {
          return args(actualModule.default);
        }
        return Promise.reject(new Error('Mock $transaction received invalid arguments'));
      }),
    },
    Prisma: actualModule.Prisma,
  };
});

// Mock transformEventForApi (ensure this is as it was)
vi.mock('./event.controllers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./event.controllers')>();
  return {
    ...actual,
    transformEventForApi: vi.fn(),
  };
});

// Updated mockRequest helper
const mockRequest = <T extends RouteGenericInterface = RouteGenericInterface>(
  data: Record<string, any> = {}, // `data` contains overrides like user, params
): Partial<AppFastifyRequest<T>> => {
  // Create a single logger instance with spies for this specific mockRequest call
  const loggerInstance = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(), // Initialize child as a spy
    level: 'info' as const, // Use const assertion for literal type
    silent: vi.fn(),
  };
  // Make the child spy return the loggerInstance itself
  loggerInstance.child.mockReturnValue(loggerInstance);

  return {
    // Assign the created loggerInstance to the log property
    log: loggerInstance,
    // Spread other properties from data (like user, params, body, query)
    // This ensures that if `data` contains `user`, `params`, etc., they are set on the request object.
    ...data,
  };
};

const mockReply = <T extends RouteGenericInterface = RouteGenericInterface>(): Partial<
  AppFastifyReply<T>
> => {
  const reply: Partial<AppFastifyReply<T>> = {};
  reply.code = vi.fn().mockReturnValue(reply as AppFastifyReply<T>);
  reply.send = vi.fn().mockReturnValue(reply as AppFastifyReply<T>);

  // Consistent logger for reply as well, though less likely to be the issue here
  const replyLoggerInstance = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
    level: 'info' as const,
    silent: vi.fn(),
  };
  replyLoggerInstance.child.mockReturnValue(replyLoggerInstance);
  reply.log = replyLoggerInstance;

  return reply;
};

describe('Event Controllers Unit Tests', () => {
  let prisma: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mockedPrismaModule = await import('../../lib/prisma');
    prisma = mockedPrismaModule.default;
    // If transformEventForApi is mocked at the module level and needs resetting per test:
    if (vi.isMockFunction(transformEventForApi)) {
        (transformEventForApi as import('vitest').Mock).mockClear();
    }
  });

    describe('getEventCategoriesHandler', () => {
      it('should return a list of unique sorted categories', async () => {
        const req = mockRequest() as AppFastifyRequest;
        const rep = mockReply() as AppFastifyReply;
        const mockCategories = [
          { category: 'Tech' },
          { category: 'Workshop' },
          { category: 'Meetup' },
        ];
        (prisma.event.findMany as import('vitest').Mock).mockResolvedValue(mockCategories);
  
        await getEventCategoriesHandler(req, rep);
  
        expect(prisma.event.findMany).toHaveBeenCalledWith({
          select: { category: true },
          distinct: ['category'],
        });
        expect(rep.code).toHaveBeenCalledWith(200);
        expect(rep.send).toHaveBeenCalledWith({ categories: ['Meetup', 'Tech', 'Workshop'] }); // Sorted
      });
  
      it('should return an empty list if no categories exist', async () => {
        const req = mockRequest() as AppFastifyRequest;
        const rep = mockReply() as AppFastifyReply;
        (prisma.event.findMany as import('vitest').Mock).mockResolvedValue([]);
  
        await getEventCategoriesHandler(req, rep);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        expect(rep.send).toHaveBeenCalledWith({ categories: [] });
      });
  
      it('should return 500 if prisma query fails', async () => {
        const req = mockRequest() as AppFastifyRequest;
        const rep = mockReply() as AppFastifyReply;
        const mockError = new Error('Database error');
        (prisma.event.findMany as import('vitest').Mock).mockRejectedValue(mockError);
  
        await getEventCategoriesHandler(req, rep);
  
        expect(rep.log.error).toHaveBeenCalledWith(mockError, 'Error fetching event categories');
        expect(rep.code).toHaveBeenCalledWith(500);
        expect(rep.send).toHaveBeenCalledWith({
          message: 'An error occurred while fetching event categories.',
        });
      });
    });
  
    describe('getEventTagsHandler', () => {
      it('should return unique, trimmed, sorted, non-empty tags (case-insensitive uniqueness)', async () => {
        const req = mockRequest() as AppFastifyRequest;
        const rep = mockReply() as AppFastifyReply;
        const mockEventsWithTags = [
          { tags: ['  Tech ', 'API', '  '] }, // Includes whitespace and empty string after trim
          { tags: ['api', 'NodeJS', ''] }, // Includes duplicate 'api' (case-insensitive) and empty string
          { tags: ['  Tech  '] }, // Duplicate 'Tech' (case-insensitive)
        ];
        (prisma.event.findMany as import('vitest').Mock).mockResolvedValue(mockEventsWithTags);
  
        await getEventTagsHandler(req, rep);
  
        expect(prisma.event.findMany).toHaveBeenCalledWith({
          select: { tags: true },
          where: { tags: { isEmpty: false } },
        });
        expect(rep.code).toHaveBeenCalledWith(200);
        // Expected: 'api', 'nodejs', 'tech' (trimmed, unique via lowercase, non-empty, sorted)
        // The .sort() on mixed case strings can be tricky. If you want a specific case in output,
        // you might need to map them to a consistent case before sending, or use a localeCompare for sorting.
        // For now, assuming .toLowerCase() before Set and then .sort():
        expect(rep.send).toHaveBeenCalledWith({ tags: ['api', 'nodejs', 'tech'] });
      });
  
      it('should return an empty list if no events have tags', async () => {
        const req = mockRequest() as AppFastifyRequest;
        const rep = mockReply() as AppFastifyReply;
        (prisma.event.findMany as import('vitest').Mock).mockResolvedValue([]); // No events found
  
        await getEventTagsHandler(req, rep);
        expect(rep.code).toHaveBeenCalledWith(200);
        expect(rep.send).toHaveBeenCalledWith({ tags: [] });
      });
  
      it('should return an empty list if events have only empty or whitespace tags', async () => {
        const req = mockRequest() as AppFastifyRequest;
        const rep = mockReply() as AppFastifyReply;
        const mockEventsWithEmptyTags = [{ tags: ['  ', ''] }, { tags: ['   '] }];
        (prisma.event.findMany as import('vitest').Mock).mockResolvedValue(mockEventsWithEmptyTags);
  
        await getEventTagsHandler(req, rep);
        expect(rep.code).toHaveBeenCalledWith(200);
        expect(rep.send).toHaveBeenCalledWith({ tags: [] });
      });
  
      it('should return 500 if prisma query fails', async () => {
        const req = mockRequest() as AppFastifyRequest;
        const rep = mockReply() as AppFastifyReply;
        const mockError = new Error('DB tags error');
        (prisma.event.findMany as import('vitest').Mock).mockRejectedValue(mockError);
  
        await getEventTagsHandler(req, rep);
  
        expect(rep.log.error).toHaveBeenCalledWith(mockError, 'Error fetching event tags');
        expect(rep.code).toHaveBeenCalledWith(500);
        expect(rep.send).toHaveBeenCalledWith({
          message: 'An error occurred while fetching event tags.',
        });
      });
    });
  
    describe('batchGetEventsHandler', () => {
      it('should return events for given IDs', async () => {
        const eventIds = ['id1', 'id2'];
        // Specify the generic type for mockRequest and mockReply
        const req = mockRequest<{ Body: BatchGetEventsBody }>({
          body: { eventIds },
        }) as AppFastifyRequest<{ Body: BatchGetEventsBody }>;
        const rep = mockReply<{ Body: BatchGetEventsBody }>() as AppFastifyReply<{
          Body: BatchGetEventsBody;
        }>;
  
        const mockDbEvents = [
          // ... (mock PrismaEventType objects, ensure they have all fields for transformEventForApi)
          // For simplicity, I'll mock the output of transformEventForApi directly if it's complex
          // or assume transformEventForApi is tested separately.
          // Let's assume transformEventForApi works and mock its input.
          {
            id: 'id1',
            title: 'Event 1',
            eventDate: new Date(),
            eventTime: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
            userId: 'user1',
            description: '',
            locationDescription: '',
            organizerName: '',
            category: '',
            tags: [],
            websiteUrl: null,
          },
          {
            id: 'id2',
            title: 'Event 2',
            eventDate: new Date(),
            eventTime: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            userId: 'user2',
            description: '',
            locationDescription: '',
            organizerName: '',
            category: '',
            tags: [],
            websiteUrl: null,
          },
        ];
        (prisma.event.findMany as import('vitest').Mock).mockResolvedValue(mockDbEvents);
  
        // If transformEventForApi is complex, you might want to mock it too,
        // or ensure your mockDbEvents are complete.
        // For now, we'll rely on the actual transformEventForApi.
  
        await batchGetEventsHandler(req, rep);
  
        expect(prisma.event.findMany).toHaveBeenCalledWith({
          where: { id: { in: eventIds } },
          select: expect.anything(), // commonEventSelect is imported, could check for it
        });
        expect(rep.code).toHaveBeenCalledWith(200);
        expect(rep.send).toHaveBeenCalledWith(
          expect.objectContaining({
            events: expect.arrayContaining([
              expect.objectContaining({ id: 'id1' }),
              expect.objectContaining({ id: 'id2' }),
            ]),
          }),
        );
        // More specific checks on transformed events if needed
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(2);
      });
  
      it('should return an empty array if no events match IDs', async () => {
        const eventIds = ['idNonExistent1', 'idNonExistent2'];
        const req = mockRequest<{ Body: BatchGetEventsBody }>({
          body: { eventIds },
        }) as AppFastifyRequest<{ Body: BatchGetEventsBody }>;
        const rep = mockReply<{ Body: BatchGetEventsBody }>() as AppFastifyReply<{
          Body: BatchGetEventsBody;
        }>;
  
        (prisma.event.findMany as import('vitest').Mock).mockResolvedValue([]);
  
        await batchGetEventsHandler(req, rep);
        expect(rep.code).toHaveBeenCalledWith(200);
        expect(rep.send).toHaveBeenCalledWith({ events: [] });
      });
  
      it('should return 500 if prisma query fails', async () => {
        const eventIds = ['id1'];
        const req = mockRequest<{ Body: BatchGetEventsBody }>({
          body: { eventIds },
        }) as AppFastifyRequest<{ Body: BatchGetEventsBody }>;
        const rep = mockReply<{ Body: BatchGetEventsBody }>() as AppFastifyReply<{
          Body: BatchGetEventsBody;
        }>;
        const mockError = new Error('DB batch error');
        (prisma.event.findMany as import('vitest').Mock).mockRejectedValue(mockError);
  
        await batchGetEventsHandler(req, rep);
  
        expect(req.log.error).toHaveBeenCalledWith(
          { error: mockError, eventIds },
          'Error in batch-get events',
        );
        expect(rep.code).toHaveBeenCalledWith(500);
        expect(rep.send).toHaveBeenCalledWith({
          message: 'An error occurred while fetching events.',
        });
      });
    });
  
    describe('createEventHandler', () => {
      const mockAuthenticatedUser = { id: 'user-id-auth', username: 'testUserAuth' };
      let baseMockRequest: Partial<AppFastifyRequest<{ Body: CreateEventInput }>>;
  
      beforeEach(() => {
        // This beforeEach can remain synchronous
        baseMockRequest = mockRequest<{ Body: CreateEventInput }>({
          user: mockAuthenticatedUser,
          body: {
            title: 'Default Test Event',
            description: 'Default test description that is long enough.',
            eventDate: '2025-12-01',
            locationDescription: 'Default Test Location',
            category: 'Default Test Category',
            tags: [],
          },
        });
      });
  
      it('should create an event successfully with provided organizerName', async () => {
        const inputData: CreateEventInput = {
          title: 'New Awesome Event',
          description: 'A very detailed description of this awesome event.',
          eventDate: '2025-10-15',
          eventTime: '14:30:00',
          locationDescription: 'Grand Hall, Downtown',
          organizerName: 'Awesome Inc.', // organizerName is provided
          category: 'Conference',
          tags: ['tech', 'innovation'],
          websiteUrl: 'https://awesomeevent.com',
        };
        const req = { ...baseMockRequest, body: inputData } as AppFastifyRequest<{
          Body: CreateEventInput;
        }>;
        const rep = mockReply<{ Body: CreateEventInput }>() as AppFastifyReply<{
          Body: CreateEventInput;
        }>;
  
        const now = new Date();
        const expectedPrismaEventDate = new Date(inputData.eventDate);
        // Ensure eventTime is correctly parsed to a Date object as the controller does
        const expectedPrismaEventTime = inputData.eventTime
          ? new Date(`1970-01-01T${inputData.eventTime}Z`)
          : null;
  
        const mockCreatedDbEvent = {
          id: 'event-id-new',
          userId: mockAuthenticatedUser.id,
          title: inputData.title,
          description: inputData.description,
          eventDate: expectedPrismaEventDate,
          eventTime: expectedPrismaEventTime, // Use the Date object or null
          locationDescription: inputData.locationDescription,
          organizerName: inputData.organizerName!,
          category: inputData.category,
          tags: inputData.tags!,
          websiteUrl: inputData.websiteUrl!,
          createdAt: now,
          updatedAt: now,
          // If commonEventSelect includes _count, add it here, e.g., _count: { savedByUsers: 0 }
        };
  
        (prisma.event.create as import('vitest').Mock).mockResolvedValue(mockCreatedDbEvent);
  
        const expectedApiEvent = {
          id: mockCreatedDbEvent.id,
          userId: mockCreatedDbEvent.userId,
          title: mockCreatedDbEvent.title,
          description: mockCreatedDbEvent.description,
          eventDate: inputData.eventDate,
          eventTime: inputData.eventTime,
          locationDescription: mockCreatedDbEvent.locationDescription,
          organizerName: mockCreatedDbEvent.organizerName,
          category: mockCreatedDbEvent.category,
          tags: mockCreatedDbEvent.tags,
          websiteUrl: mockCreatedDbEvent.websiteUrl,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          // Add isSavedByCurrentUser: false and savesCount: 0 if your transformEventForApi adds these for new events
        };
  
        await createEventHandler(req, rep);
  
        expect(prisma.event.create).toHaveBeenCalledWith({
          data: {
            user: { connect: { id: mockAuthenticatedUser.id } },
            title: inputData.title,
            description: inputData.description,
            eventDate: expectedPrismaEventDate,
            eventTime: expectedPrismaEventTime, // Use the Date object or null
            locationDescription: inputData.locationDescription,
            organizerName: inputData.organizerName,
            category: inputData.category,
            tags: inputData.tags,
            websiteUrl: inputData.websiteUrl,
          },
          select: commonEventSelect,
        });
  
        expect(rep.code).toHaveBeenCalledWith(201);
        expect(rep.send).toHaveBeenCalledWith(expectedApiEvent);
        expect(req.log.info).toHaveBeenCalledWith(
          {
            eventId: mockCreatedDbEvent.id,
            userId: mockAuthenticatedUser.id,
            title: mockCreatedDbEvent.title,
          },
          'Event created successfully.',
        );
      });
  
      it('should create an event successfully using user.username if organizerName is not provided', async () => {
        const inputData: CreateEventInput = {
          title: 'Community Meetup',
          description: 'A friendly community gathering for all.',
          eventDate: '2025-11-20',
          eventTime: '18:00:00',
          locationDescription: 'Community Center Park',
          // organizerName is NOT provided
          category: 'Social',
          tags: ['community', 'local'],
          websiteUrl: null, // Testing with null websiteUrl
        };
        const req = { ...baseMockRequest, body: inputData } as AppFastifyRequest<{
          Body: CreateEventInput;
        }>;
        const rep = mockReply<{ Body: CreateEventInput }>() as AppFastifyReply<{
          Body: CreateEventInput;
        }>;
  
        const now = new Date();
        const expectedPrismaEventDate = new Date(inputData.eventDate);
        const expectedPrismaEventTime = inputData.eventTime
          ? new Date(`1970-01-01T${inputData.eventTime}Z`)
          : null;
  
        const mockCreatedDbEvent = {
          id: 'event-id-community',
          userId: mockAuthenticatedUser.id,
          title: inputData.title,
          description: inputData.description,
          eventDate: expectedPrismaEventDate,
          eventTime: expectedPrismaEventTime,
          locationDescription: inputData.locationDescription,
          organizerName: mockAuthenticatedUser.username, // Expecting username as fallback
          category: inputData.category,
          tags: inputData.tags!,
          websiteUrl: inputData.websiteUrl,
          createdAt: now,
          updatedAt: now,
        };
  
        (prisma.event.create as import('vitest').Mock).mockResolvedValue(mockCreatedDbEvent);
  
        const expectedApiEvent = {
          id: mockCreatedDbEvent.id,
          userId: mockCreatedDbEvent.userId,
          title: mockCreatedDbEvent.title,
          description: mockCreatedDbEvent.description,
          eventDate: inputData.eventDate,
          eventTime: inputData.eventTime,
          locationDescription: mockCreatedDbEvent.locationDescription,
          organizerName: mockAuthenticatedUser.username, // Expecting username in API response
          category: mockCreatedDbEvent.category,
          tags: mockCreatedDbEvent.tags,
          websiteUrl: mockCreatedDbEvent.websiteUrl,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        };
  
        await createEventHandler(req, rep);
  
        expect(prisma.event.create).toHaveBeenCalledWith({
          data: {
            user: { connect: { id: mockAuthenticatedUser.id } },
            title: inputData.title,
            description: inputData.description,
            eventDate: expectedPrismaEventDate,
            eventTime: expectedPrismaEventTime,
            locationDescription: inputData.locationDescription,
            organizerName: mockAuthenticatedUser.username, // Verify username is used
            category: inputData.category,
            tags: inputData.tags,
            websiteUrl: inputData.websiteUrl,
          },
          select: commonEventSelect,
        });
  
        expect(rep.code).toHaveBeenCalledWith(201);
        expect(rep.send).toHaveBeenCalledWith(expectedApiEvent);
        expect(req.log.info).toHaveBeenCalledWith(
          {
            eventId: mockCreatedDbEvent.id,
            userId: mockAuthenticatedUser.id,
            title: mockCreatedDbEvent.title,
          },
          'Event created successfully.',
        );
      });
  
      it('should return 400 for invalid input data (Zod validation failure)', async () => {
        const invalidInputData = {
          title: 'T', // Too short (min 3)
          description: 'Short', // NOW too short (min 10)
          // eventDate is missing (required)
          // locationDescription is missing (required)
          // category is missing (required)
        };
        // Cast to any because it's intentionally invalid
        const req = { ...baseMockRequest, body: invalidInputData as any } as AppFastifyRequest<{
          Body: CreateEventInput;
        }>;
        const rep = mockReply<{ Body: CreateEventInput }>() as AppFastifyReply<{
          Body: CreateEventInput;
        }>;
  
        // The controller should catch the ZodError and handle it.
        // We don't need to mock prisma.event.create as it shouldn't be called.
  
        await createEventHandler(req, rep);
  
        expect(prisma.event.create).not.toHaveBeenCalled();
        expect(rep.code).toHaveBeenCalledWith(400);
        expect(rep.send).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'Validation error',
            errors: expect.any(Object), // Zod errors object
          }),
        );
  
        // Optionally, check the log for the ZodError
        expect(req.log.error).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.any(ZodError), // Check if the error logged is a ZodError
            body: invalidInputData,
            userId: mockAuthenticatedUser.id,
          }),
          'Error creating event',
        );
  
        // More specific check for the error structure if needed:
        const sentPayload = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentPayload.errors).toHaveProperty('title');
        expect(sentPayload.errors).toHaveProperty('description');
        expect(sentPayload.errors).toHaveProperty('eventDate');
        expect(sentPayload.errors).toHaveProperty('locationDescription');
        expect(sentPayload.errors).toHaveProperty('category');
      });
  
      it('should return 409 if Prisma create throws P2002 (unique constraint violation)', async () => {
        const inputData: CreateEventInput = {
          title: 'Duplicate Event Title',
          description: 'This event tries to be a duplicate.',
          eventDate: '2025-11-25',
          eventTime: '10:00:00',
          locationDescription: 'Some Location',
          category: 'Test Category',
          tags: [],
        };
        const req = { ...baseMockRequest, body: inputData } as AppFastifyRequest<{
          Body: CreateEventInput;
        }>;
        const rep = mockReply<{ Body: CreateEventInput }>() as AppFastifyReply<{
          Body: CreateEventInput;
        }>;
  
        // Use ActualPrisma (imported from @prisma/client) to create the error instance
        const prismaP2002Error = new ActualPrisma.PrismaClientKnownRequestError(
          'Unique constraint failed',
          { code: 'P2002', clientVersion: 'mock' },
        );
  
        // Ensure 'prisma' here refers to the mocked client instance
        (prisma.event.create as import('vitest').Mock).mockRejectedValue(prismaP2002Error);
  
        await createEventHandler(req, rep);
  
        expect(prisma.event.create).toHaveBeenCalled();
        expect(rep.code).toHaveBeenCalledWith(409);
        expect(rep.send).toHaveBeenCalledWith({
          message: 'Conflict: An event with similar unique details might already exist.',
        });
        expect(req.log.error).toHaveBeenCalledWith(
          expect.objectContaining({
            error: prismaP2002Error,
            body: inputData,
            userId: mockAuthenticatedUser.id,
          }),
          'Error creating event',
        );
      });
  
      it('should return 500 for other Prisma errors during creation', async () => {
        const inputData: CreateEventInput = {
          title: 'Event Facing DB Issue',
          description: 'This event will encounter a generic database problem.',
          eventDate: '2025-12-01',
          locationDescription: 'Problematic Location',
          category: 'ErrorProne',
          tags: ['db_error'],
        };
        const req = { ...baseMockRequest, body: inputData } as AppFastifyRequest<{
          Body: CreateEventInput;
        }>;
        const rep = mockReply<{ Body: CreateEventInput }>() as AppFastifyReply<{
          Body: CreateEventInput;
        }>;
  
        // Simulate a generic PrismaClientKnownRequestError (not P2002)
        const genericPrismaError = new ActualPrisma.PrismaClientKnownRequestError(
          'Some other database error occurred',
          { code: 'P1000', clientVersion: 'mock' }, // P1000 is just an example of another error code
        );
  
        (prisma.event.create as import('vitest').Mock).mockRejectedValue(genericPrismaError);
  
        await createEventHandler(req, rep);
  
        expect(prisma.event.create).toHaveBeenCalled(); // It should have been called
        expect(rep.code).toHaveBeenCalledWith(500);
        expect(rep.send).toHaveBeenCalledWith({
          message: 'An error occurred while creating the event.',
        });
        expect(req.log.error).toHaveBeenCalledWith(
          expect.objectContaining({
            error: genericPrismaError,
            body: inputData,
            userId: mockAuthenticatedUser.id,
          }),
          'Error creating event',
        );
      });
  
      it('should return 500 for unexpected errors', async () => {
        const inputData: CreateEventInput = {
          title: 'Event With Unexpected Issue',
          description: 'Something unforeseen will happen here.',
          eventDate: '2025-12-10',
          locationDescription: 'Mystery Location',
          category: 'Chaos',
          tags: ['runtime_error'],
        };
        const req = { ...baseMockRequest, body: inputData } as AppFastifyRequest<{
          Body: CreateEventInput;
        }>;
        const rep = mockReply<{ Body: CreateEventInput }>() as AppFastifyReply<{
          Body: CreateEventInput;
        }>;
  
        const unexpectedError = new Error('Something completely unexpected broke!');
  
        // To simulate an error after prisma.create but before reply.send,
        // we can make prisma.create resolve, but then mock something it calls (like transformEventForApi)
        // to throw an error. Or, more simply, make prisma.create itself throw a generic Error.
        // Let's choose the latter for simplicity if the goal is to test the final catch-all.
        (prisma.event.create as import('vitest').Mock).mockRejectedValue(unexpectedError);
        // If you wanted to test an error *after* prisma.create succeeds, you'd do:
        // (prisma.event.create as import('vitest').Mock).mockResolvedValue({ ...mock db event... });
        // And then mock a subsequent function called by the handler to throw.
        // For example, if transformEventForApi was imported and mockable:
        // vi.mock('./path/to/transformEventForApi', () => ({
        //   transformEventForApi: vi.fn().mockImplementation(() => { throw unexpectedError; })
        // }));
        // However, transformEventForApi is defined in the same file, so direct mocking is harder.
        // The current controller structure's final catch block will catch errors from prisma.create too.
  
        await createEventHandler(req, rep);
  
        expect(prisma.event.create).toHaveBeenCalled(); // It should have been called
        expect(rep.code).toHaveBeenCalledWith(500);
        expect(rep.send).toHaveBeenCalledWith({
          message: 'An error occurred while creating the event.',
        });
        expect(req.log.error).toHaveBeenCalledWith(
          expect.objectContaining({
            error: unexpectedError, // Check for the specific unexpected error
            body: inputData,
            userId: mockAuthenticatedUser.id,
          }),
          'Error creating event',
        );
      });
    });
  
    describe('getEventByIdHandler', () => {
      const mockAuthenticatedUser = { id: 'user-id-auth', username: 'testUserAuth' };
      const mockEventId = 'event-uuid-123';
      const nonExistentEventId = 'event-uuid-non-existent';
  
      it('should return an event if found and transform it for API response (authenticated user)', async () => {
        const req = mockRequest<{ Params: EventParams }>({
          params: { eventId: mockEventId },
          user: mockAuthenticatedUser, // Simulate an authenticated user
        }) as AppFastifyRequest<{ Params: EventParams }>;
        const rep = mockReply<{ Params: EventParams }>() as AppFastifyReply<{ Params: EventParams }>;
  
        const now = new Date();
        const eventDate = new Date('2025-07-15T00:00:00.000Z');
        const eventTime = new Date('1970-01-01T14:30:00.000Z'); // Example time
  
        const mockDbEvent: PrismaEventType = {
          // Ensure this matches PrismaEventType
          id: mockEventId,
          userId: 'user-owner-id',
          title: 'Test Event by ID',
          description: 'Detailed description for event fetched by ID.',
          eventDate: eventDate,
          eventTime: eventTime,
          locationDescription: 'Test Location',
          organizerName: 'Test Organizer',
          category: 'Test Category',
          tags: ['testing', 'byId'],
          websiteUrl: 'https://example.com/testevent',
          createdAt: now,
          updatedAt: now,
          // Add _count: { savedByUsers: 0 } if your commonEventSelect and transformEventForApi handle it
        };
  
        (prisma.event.findUnique as import('vitest').Mock).mockResolvedValue(mockDbEvent);
  
        // Manually transform to compare, or import and use the actual transformEventForApi
        // For a unit test of the controller, it's often better to test the output against
        // what transformEventForApi *would* produce.
        const expectedApiEvent: ApiEventResponse = {
          id: mockDbEvent.id,
          userId: mockDbEvent.userId,
          title: mockDbEvent.title,
          description: mockDbEvent.description,
          eventDate: formatPrismaDate(mockDbEvent.eventDate), // Use your actual formatting helpers
          eventTime: formatPrismaTime(mockDbEvent.eventTime), // Use your actual formatting helpers
          locationDescription: mockDbEvent.locationDescription,
          organizerName: mockDbEvent.organizerName,
          category: mockDbEvent.category,
          tags: mockDbEvent.tags,
          websiteUrl: mockDbEvent.websiteUrl,
          createdAt: mockDbEvent.createdAt.toISOString(),
          updatedAt: mockDbEvent.updatedAt.toISOString(),
          // isSavedByCurrentUser: false, // If transformEventForApi adds this
          // savesCount: 0,             // If transformEventForApi adds this
        };
  
        await getEventByIdHandler(req, rep);
  
        expect(prisma.event.findUnique).toHaveBeenCalledWith({
          where: { id: mockEventId },
          select: commonEventSelect, // Assuming commonEventSelect is used
        });
        expect(rep.code).toHaveBeenCalledWith(200);
        expect(rep.send).toHaveBeenCalledWith(expectedApiEvent);
      });
  
      it('should return an event if found and transform it for API response (unauthenticated user)', async () => {
        const req = mockRequest<{ Params: EventParams }>({
          params: { eventId: mockEventId },
          // No user property, simulating an unauthenticated request
        }) as AppFastifyRequest<{ Params: EventParams }>;
        const rep = mockReply<{ Params: EventParams }>() as AppFastifyReply<{
          Params: EventParams;
        }>;
  
        const now = new Date();
        const eventDate = new Date('2025-07-15T00:00:00.000Z');
        const eventTime = new Date('1970-01-01T14:30:00.000Z');
  
        const mockDbEvent: PrismaEventType = {
          id: mockEventId,
          userId: 'user-owner-id',
          title: 'Test Event by ID (Unauth)',
          description: 'Detailed description for event fetched by ID (unauthenticated).',
          eventDate: eventDate,
          eventTime: eventTime,
          locationDescription: 'Test Location Unauth',
          organizerName: 'Test Organizer Unauth',
          category: 'Test Category Unauth',
          tags: ['testing', 'byId', 'unauth'],
          websiteUrl: 'https://example.com/testevent-unauth',
          createdAt: now,
          updatedAt: now,
        };
  
        (prisma.event.findUnique as import('vitest').Mock).mockResolvedValue(mockDbEvent);
  
        const expectedApiEvent: ApiEventResponse = {
          id: mockDbEvent.id,
          userId: mockDbEvent.userId,
          title: mockDbEvent.title,
          description: mockDbEvent.description,
          eventDate: formatPrismaDate(mockDbEvent.eventDate),
          eventTime: formatPrismaTime(mockDbEvent.eventTime),
          locationDescription: mockDbEvent.locationDescription,
          organizerName: mockDbEvent.organizerName,
          category: mockDbEvent.category,
          tags: mockDbEvent.tags,
          websiteUrl: mockDbEvent.websiteUrl,
          createdAt: mockDbEvent.createdAt.toISOString(),
          updatedAt: mockDbEvent.updatedAt.toISOString(),
          // If your transformEventForApi adds isSavedByCurrentUser based on req.user,
          // this would be undefined or false for an unauthenticated user.
          // Ensure your ApiEventResponse type marks such fields as optional.
        };
  
        await getEventByIdHandler(req, rep);
  
        expect(prisma.event.findUnique).toHaveBeenCalledWith({
          where: { id: mockEventId },
          select: commonEventSelect,
        });
        expect(rep.code).toHaveBeenCalledWith(200);
        expect(rep.send).toHaveBeenCalledWith(expectedApiEvent);
      });
  
      it('should return 404 if event not found', async () => {
        const req = mockRequest<{ Params: EventParams }>({
          params: { eventId: nonExistentEventId },
          // Can be authenticated or unauthenticated, outcome should be the same
        }) as AppFastifyRequest<{ Params: EventParams }>;
        const rep = mockReply<{ Params: EventParams }>() as AppFastifyReply<{
          Params: EventParams;
        }>;
  
        (prisma.event.findUnique as import('vitest').Mock).mockResolvedValue(null); // Simulate event not found
  
        await getEventByIdHandler(req, rep);
  
        expect(prisma.event.findUnique).toHaveBeenCalledWith({
          where: { id: nonExistentEventId },
          select: commonEventSelect,
        });
        expect(rep.code).toHaveBeenCalledWith(404);
        expect(rep.send).toHaveBeenCalledWith({ message: 'Event not found.' });
      });
  
      it('should return 500 if Prisma query fails', async () => {
        const req = mockRequest<{ Params: EventParams }>({
          params: { eventId: mockEventId },
        }) as AppFastifyRequest<{ Params: EventParams }>;
        const rep = mockReply<{ Params: EventParams }>() as AppFastifyReply<{
          Params: EventParams;
        }>;
  
        const prismaError = new Error('Database connection lost'); // Simulate a generic DB error
        (prisma.event.findUnique as import('vitest').Mock).mockRejectedValue(prismaError);
  
        await getEventByIdHandler(req, rep);
  
        expect(prisma.event.findUnique).toHaveBeenCalledWith({
          where: { id: mockEventId },
          select: commonEventSelect,
        });
        expect(rep.code).toHaveBeenCalledWith(500);
        expect(rep.send).toHaveBeenCalledWith({
          message: 'An error occurred while fetching the event.',
        });
        expect(req.log.error).toHaveBeenCalledWith(
          { error: prismaError, eventId: mockEventId },
          'Error fetching event by ID',
        );
      });
  
      it('should return 500 if event transformation fails', async () => {
        const req = mockRequest<{ Params: EventParams }>({
          params: { eventId: mockEventId },
        }) as AppFastifyRequest<{ Params: EventParams }>;
        const rep = mockReply<{ Params: EventParams }>() as AppFastifyReply<{
          Params: EventParams;
        }>;
  
        const malformedDbEvent = {
          // This event will cause transformEventForApi to fail
          id: mockEventId,
          userId: 'user-owner-id',
          title: 'Event with Transformation Issue',
          description: 'This event has data that will break the transformer.',
          eventDate: new Date('2025-07-15T00:00:00.000Z'),
          eventTime: new Date('1970-01-01T14:30:00.000Z'),
          locationDescription: 'Test Location',
          organizerName: 'Test Organizer',
          category: 'Test Category',
          tags: ['testing', 'transform_error'],
          websiteUrl: 'https://example.com/testevent',
          createdAt: null, // Intentionally null to cause .toISOString() to fail in transformEventForApi
          updatedAt: new Date(),
        };
  
        // Cast to PrismaEventType to satisfy the mock, even though it's intentionally malformed for the test
        (prisma.event.findUnique as import('vitest').Mock).mockResolvedValue(
          malformedDbEvent as unknown as PrismaEventType,
        );
  
        // We expect transformEventForApi to throw, which should be caught by the handler's try...catch
        // The specific error would be a TypeError: Cannot read properties of null (reading 'toISOString')
  
        await getEventByIdHandler(req, rep);
  
        expect(prisma.event.findUnique).toHaveBeenCalledWith({
          where: { id: mockEventId },
          select: commonEventSelect,
        });
        expect(rep.code).toHaveBeenCalledWith(500);
        expect(rep.send).toHaveBeenCalledWith({
          message: 'An error occurred while fetching the event.',
        });
  
        // Check that the error logged is the one from the transformation
        expect(req.log.error).toHaveBeenCalledWith(
          expect.objectContaining({
            // The error object itself will be a TypeError
            error: expect.any(TypeError), // Or more specifically, new TypeError("Cannot read properties of null (reading 'toISOString')")
            eventId: mockEventId,
          }),
          'Error fetching event by ID',
        );
      });
    });
  
    describe('listEventsHandler', () => {
      const mockAuthenticatedUser = { id: 'user-id-auth', username: 'testUserAuth' };
  
      it('should return a paginated list of events with default parameters (authenticated user)', async () => {
        // Defaults from eventListQuerySchema
        const expectedPage = 1;
        const expectedLimit = 10;
        const expectedSortBy = 'createdAt';
        const expectedSortOrder = 'desc';
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            // Simulate query object after Fastify/Zod processing with defaults
            page: expectedPage,
            limit: expectedLimit,
            sortBy: expectedSortBy,
            sortOrder: expectedSortOrder,
            // category, tags, startDate, endDate, search would be undefined here
          },
          user: mockAuthenticatedUser,
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date(); // Use a stable base time for creating other dates
        const mockDbEvents: PrismaEventType[] = [
          {
            id: 'event1',
            title: 'Event Alpha',
            description: 'Desc Alpha',
            userId: 'user1',
            eventDate: new Date(new Date(baseTime).setDate(baseTime.getDate() + 1)),
            eventTime: null,
            locationDescription: 'Loc Alpha',
            organizerName: 'Org Alpha',
            category: 'Cat A',
            tags: ['tag1'],
            websiteUrl: null,
            createdAt: new Date(baseTime),
            updatedAt: new Date(baseTime),
          },
          {
            id: 'event2',
            title: 'Event Beta',
            description: 'Desc Beta',
            userId: 'user2',
            eventDate: new Date(new Date(baseTime).setDate(baseTime.getDate() + 2)),
            eventTime: new Date(`1970-01-01T10:00:00.000Z`),
            locationDescription: 'Loc Beta',
            organizerName: 'Org Beta',
            category: 'Cat B',
            tags: ['tag2'],
            websiteUrl: 'http://beta.com',
            createdAt: new Date(baseTime.getTime() - 10000),
            updatedAt: new Date(baseTime),
          },
        ];
        const totalEvents = mockDbEvents.length;
  
        // REMOVE individual mocks for findMany and count if $transaction is used
        // (prisma.event.findMany as import('vitest').Mock).mockResolvedValue(mockDbEvents);
        // (prisma.event.count as import('vitest').Mock).mockResolvedValue(totalEvents);
  
        // INSTEAD, mock prisma.$transaction
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockDbEvents, // Result of prisma.event.findMany
          totalEvents, // Result of prisma.event.count
        ]);
  
        await listEventsHandler(req, rep);
  
        // 1. Assert that prisma.event.findMany was called with the correct configuration
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {}, // Or finalWhereClause if you calculate it in the test
            skip: (expectedPage - 1) * expectedLimit,
            take: expectedLimit,
            orderBy: [{ [expectedSortBy]: expectedSortOrder }],
            select: commonEventSelect,
          }),
        );
  
        // 2. Assert that prisma.event.count was called with the correct configuration
        expect(prisma.event.count).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {}, // Or finalWhereClause if you calculate it in the test
          }),
        );
  
        // 3. Assert that prisma.$transaction was called (e.g., once)
        //    The arguments to $transaction are the promises/results from findMany/count calls,
        //    so we don't assert their content with objectContaining for the configs here.
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        // Optionally, you can check it was called with an array of 2 items if you want to be more specific
        // about the structure of arguments passed to $transaction, but not their deep content.
        // For example:
        // const transactionArgs = (prisma.$transaction as import('vitest').Mock).mock.calls[0][0];
        // expect(transactionArgs).toBeInstanceOf(Array);
        // expect(transactionArgs.length).toBe(2);
  
        // 4. Assert the reply from the handler
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(totalEvents);
        expect(sentData.events[0].id).toBe(mockDbEvents[0].id);
        // ... other assertions for sentData ...
      });
  
      it('should return a paginated list of events with default parameters (unauthenticated user)', async () => {
        // Defaults from eventListQuerySchema
        const expectedPage = 1;
        const expectedLimit = 10;
        const expectedSortBy = 'createdAt';
        const expectedSortOrder = 'desc';
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            // Simulate query object after Fastify/Zod processing with defaults
            page: expectedPage,
            limit: expectedLimit,
            sortBy: expectedSortBy,
            sortOrder: expectedSortOrder,
          },
          // No user property, simulating an unauthenticated request
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date();
        const mockDbEvents: PrismaEventType[] = [
          {
            id: 'event-unauth-1',
            title: 'Unauth Event Alpha',
            description: 'Desc Alpha Unauth',
            userId: 'user1',
            eventDate: new Date(new Date(baseTime).setDate(baseTime.getDate() + 1)),
            eventTime: null,
            locationDescription: 'Loc Alpha Unauth',
            organizerName: 'Org Alpha Unauth',
            category: 'Cat A',
            tags: ['tag1'],
            websiteUrl: null,
            createdAt: new Date(baseTime),
            updatedAt: new Date(baseTime),
          },
          {
            id: 'event-unauth-2',
            title: 'Unauth Event Beta',
            description: 'Desc Beta Unauth',
            userId: 'user2',
            eventDate: new Date(new Date(baseTime).setDate(baseTime.getDate() + 2)),
            eventTime: new Date(`1970-01-01T10:00:00.000Z`),
            locationDescription: 'Loc Beta Unauth',
            organizerName: 'Org Beta Unauth',
            category: 'Cat B',
            tags: ['tag2'],
            websiteUrl: 'http://beta-unauth.com',
            createdAt: new Date(baseTime.getTime() - 10000),
            updatedAt: new Date(baseTime),
          },
        ];
        const totalEvents = mockDbEvents.length;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([mockDbEvents, totalEvents]);
  
        await listEventsHandler(req, rep);
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {},
            skip: (expectedPage - 1) * expectedLimit,
            take: expectedLimit,
            orderBy: [{ [expectedSortBy]: expectedSortOrder }],
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {},
          }),
        );
        expect(prisma.$transaction).toHaveBeenCalledTimes(1); // Or more specific if needed
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(totalEvents);
        expect(sentData.events[0].id).toBe(mockDbEvents[0].id);
        expect(sentData.events[1].id).toBe(mockDbEvents[1].id);
        expect(sentData.totalEvents).toBe(totalEvents);
        expect(sentData.totalPages).toBe(Math.ceil(totalEvents / expectedLimit));
        expect(sentData.currentPage).toBe(expectedPage);
        expect(sentData.limit).toBe(expectedLimit);
        // If your transformEventForApi adds isSavedByCurrentUser based on req.user,
        // ensure this field is not present or is false/undefined in the transformed events.
      });
  
      it('should filter events by category', async () => {
        const targetCategory = 'Tech Conference';
        const expectedPage = 1;
        const expectedLimit = 10;
        const expectedSortBy = 'createdAt'; // Default
        const expectedSortOrder = 'desc'; // Default
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            category: targetCategory,
            page: expectedPage, // Explicitly pass defaults or test schema default application
            limit: expectedLimit,
            sortBy: expectedSortBy,
            sortOrder: expectedSortOrder,
          },
          // Can be authenticated or unauthenticated, filter logic is the same
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date();
        const mockFilteredDbEvents: PrismaEventType[] = [
          {
            id: 'event-cat-1',
            title: 'AI Summit',
            description: 'Discussing AI advancements.',
            userId: 'user3',
            eventDate: new Date(new Date(baseTime).setDate(baseTime.getDate() + 5)),
            eventTime: new Date(`1970-01-01T09:00:00.000Z`),
            locationDescription: 'Convention Center',
            organizerName: 'Tech Events Inc.',
            category: targetCategory, // Matches the filter
            tags: ['ai', 'machine learning'],
            websiteUrl: 'http://aisummit.com',
            createdAt: new Date(baseTime),
            updatedAt: new Date(baseTime),
          },
        ];
        const totalFilteredEvents = mockFilteredDbEvents.length;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockFilteredDbEvents,
          totalFilteredEvents,
        ]);
  
        await listEventsHandler(req, rep);
  
        const expectedWhereClause = {
          AND: [{ category: targetCategory }], // Controller builds AND with conditions
        };
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expectedWhereClause,
            skip: (expectedPage - 1) * expectedLimit,
            take: expectedLimit,
            orderBy: [{ [expectedSortBy]: expectedSortOrder }],
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expectedWhereClause,
          }),
        );
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(totalFilteredEvents);
        if (totalFilteredEvents > 0) {
          expect(sentData.events[0].id).toBe(mockFilteredDbEvents[0].id);
          expect(sentData.events[0].category).toBe(targetCategory);
        }
        expect(sentData.totalEvents).toBe(totalFilteredEvents);
        expect(sentData.totalPages).toBe(Math.ceil(totalFilteredEvents / expectedLimit));
        expect(sentData.currentPage).toBe(expectedPage);
      });
  
      it('should filter events by a single tag', async () => {
        const targetTag = 'networking';
        const expectedPage = 1;
        const expectedLimit = 10;
        const expectedSortBy = 'createdAt';
        const expectedSortOrder = 'desc';
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            tags: targetTag, // Single tag as a string
            page: expectedPage,
            limit: expectedLimit,
            sortBy: expectedSortBy,
            sortOrder: expectedSortOrder,
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date();
        const mockFilteredDbEvents: PrismaEventType[] = [
          {
            id: 'event-tag-1',
            title: 'Tech Meetup',
            description: 'Meet and greet for tech enthusiasts.',
            userId: 'user4',
            eventDate: new Date(new Date(baseTime).setDate(baseTime.getDate() + 3)),
            eventTime: null,
            locationDescription: 'Community Hall',
            organizerName: 'Local Coders',
            category: 'Meetup',
            tags: [targetTag, 'social'], // Event has the target tag
            websiteUrl: null,
            createdAt: new Date(baseTime),
            updatedAt: new Date(baseTime),
          },
        ];
        const totalFilteredEvents = mockFilteredDbEvents.length;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockFilteredDbEvents,
          totalFilteredEvents,
        ]);
  
        await listEventsHandler(req, rep);
  
        // Your controller parses the 'tags' string "networking" into ['networking']
        const expectedWhereClause = {
          AND: [{ tags: { hasSome: [targetTag] } }],
        };
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expectedWhereClause,
            skip: (expectedPage - 1) * expectedLimit,
            take: expectedLimit,
            orderBy: [{ [expectedSortBy]: expectedSortOrder }],
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expectedWhereClause,
          }),
        );
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(totalFilteredEvents);
        if (totalFilteredEvents > 0) {
          expect(sentData.events[0].id).toBe(mockFilteredDbEvents[0].id);
          expect(sentData.events[0].tags).toContain(targetTag);
        }
        expect(sentData.totalEvents).toBe(totalFilteredEvents);
      });
  
      it('should filter events by multiple tags (contains any of the specified tags)', async () => {
        const targetTagsString = 'music,festival';
        const targetTagsArray = ['music', 'festival']; // What the controller will parse it into
        const expectedPage = 1;
        const expectedLimit = 10;
        const expectedSortBy = 'createdAt';
        const expectedSortOrder = 'desc';
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            tags: targetTagsString, // Comma-separated string
            page: expectedPage,
            limit: expectedLimit,
            sortBy: expectedSortBy,
            sortOrder: expectedSortOrder,
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date();
        const mockFilteredDbEvents: PrismaEventType[] = [
          {
            id: 'event-multi-tag-1',
            title: 'Summer Sounds Fest',
            description: 'Outdoor music festival.',
            userId: 'user5',
            eventDate: new Date(new Date(baseTime).setDate(baseTime.getDate() + 10)),
            eventTime: null,
            locationDescription: 'City Park',
            organizerName: 'Events Co.',
            category: 'Music',
            tags: ['live', 'music', 'outdoor'], // Has 'music'
            websiteUrl: 'http://summersounds.com',
            createdAt: new Date(baseTime),
            updatedAt: new Date(baseTime),
          },
          {
            id: 'event-multi-tag-2',
            title: 'Annual Arts Festival',
            description: 'Celebration of arts.',
            userId: 'user6',
            eventDate: new Date(new Date(baseTime).setDate(baseTime.getDate() + 12)),
            eventTime: new Date(`1970-01-01T11:00:00.000Z`),
            locationDescription: 'Downtown Plaza',
            organizerName: 'City Arts Council',
            category: 'Culture',
            tags: ['art', 'festival', 'community'], // Has 'festival'
            websiteUrl: null,
            createdAt: new Date(baseTime.getTime() - 5000),
            updatedAt: new Date(baseTime),
          },
        ];
        const totalFilteredEvents = mockFilteredDbEvents.length;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockFilteredDbEvents,
          totalFilteredEvents,
        ]);
  
        await listEventsHandler(req, rep);
  
        const expectedWhereClause = {
          AND: [{ tags: { hasSome: targetTagsArray } }],
        };
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expectedWhereClause,
            skip: (expectedPage - 1) * expectedLimit,
            take: expectedLimit,
            orderBy: [{ [expectedSortBy]: expectedSortOrder }],
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expectedWhereClause,
          }),
        );
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(totalFilteredEvents);
        if (totalFilteredEvents > 0) {
          // Basic check: ensure returned events have at least one of the target tags
          sentData.events.forEach((event: ApiEventResponse) => {
            expect(event.tags.some((tag) => targetTagsArray.includes(tag))).toBe(true);
          });
        }
        expect(sentData.totalEvents).toBe(totalFilteredEvents);
      });
  
      it('should filter events by date range (startDate only)', async () => {
        const startDateString = '2025-08-15';
        const expectedPrismaStartDate = new Date(startDateString); // Controller converts string to Date
  
        const expectedPage = 1;
        const expectedLimit = 10;
        const expectedSortBy = 'createdAt';
        const expectedSortOrder = 'desc';
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            startDate: startDateString,
            page: expectedPage,
            limit: expectedLimit,
            sortBy: expectedSortBy,
            sortOrder: expectedSortOrder,
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date(); // For createdAt/updatedAt
        const mockFilteredDbEvents: PrismaEventType[] = [
          {
            id: 'event-date-1',
            title: 'Future Conference',
            description: 'A conference happening on or after startDate.',
            userId: 'user7',
            eventDate: new Date('2025-08-15T10:00:00.000Z'), // On startDate
            eventTime: new Date(`1970-01-01T10:00:00.000Z`),
            locationDescription: 'Virtual',
            organizerName: 'Future Events LLC',
            category: 'Conference',
            tags: ['future', 'tech'],
            websiteUrl: 'http://futureconf.com',
            createdAt: new Date(baseTime),
            updatedAt: new Date(baseTime),
          },
          {
            id: 'event-date-2',
            title: 'Late August Workshop',
            description: 'Workshop after startDate.',
            userId: 'user8',
            eventDate: new Date('2025-08-20T14:00:00.000Z'), // After startDate
            eventTime: null,
            locationDescription: 'Online',
            organizerName: 'Learn Fast Co.',
            category: 'Workshop',
            tags: ['education', 'online'],
            websiteUrl: null,
            createdAt: new Date(baseTime.getTime() - 20000),
            updatedAt: new Date(baseTime),
          },
        ];
        const totalFilteredEvents = mockFilteredDbEvents.length;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockFilteredDbEvents,
          totalFilteredEvents,
        ]);
  
        await listEventsHandler(req, rep);
  
        const expectedWhereClause = {
          AND: [{ eventDate: { gte: expectedPrismaStartDate } }],
        };
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expectedWhereClause,
            skip: (expectedPage - 1) * expectedLimit,
            take: expectedLimit,
            orderBy: [{ [expectedSortBy]: expectedSortOrder }],
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expectedWhereClause,
          }),
        );
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(totalFilteredEvents);
        if (totalFilteredEvents > 0) {
          sentData.events.forEach((event: ApiEventResponse) => {
            // The API response eventDate is a string 'YYYY-MM-DD'
            // The expectedPrismaStartDate is a Date object at the beginning of the day.
            // So, new Date(event.eventDate) should be >= expectedPrismaStartDate
            expect(new Date(event.eventDate) >= expectedPrismaStartDate).toBe(true);
          });
        }
        expect(sentData.totalEvents).toBe(totalFilteredEvents);
      });
  
      it('should filter events by date range (endDate only)', async () => {
        const endDateString = '2025-09-20';
        // Prisma's 'lte' for a date string 'YYYY-MM-DD' effectively means up to the end of that day.
        // The controller converts 'endDateString' to new Date(endDateString), which is the start of that day.
        // Prisma's date-time comparison will handle this correctly for 'lte'.
        const expectedPrismaEndDate = new Date(endDateString);
  
        const expectedPage = 1;
        const expectedLimit = 10;
        const expectedSortBy = 'createdAt';
        const expectedSortOrder = 'desc';
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            endDate: endDateString,
            page: expectedPage,
            limit: expectedLimit,
            sortBy: expectedSortBy,
            sortOrder: expectedSortOrder,
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date(); // For createdAt/updatedAt
        const mockFilteredDbEvents: PrismaEventType[] = [
          {
            id: 'event-date-3',
            title: 'Early September Seminar',
            description: 'Seminar before or on endDate.',
            userId: 'user9',
            eventDate: new Date('2025-09-10T10:00:00.000Z'), // Before endDate
            eventTime: new Date(`1970-01-01T10:00:00.000Z`),
            locationDescription: 'Online Platform',
            organizerName: 'Edu Seminars',
            category: 'Seminar',
            tags: ['education', 'virtual'],
            websiteUrl: 'http://eduseminars.com',
            createdAt: new Date(baseTime),
            updatedAt: new Date(baseTime),
          },
          {
            id: 'event-date-4',
            title: 'Event on End Date',
            description: 'Workshop on the exact endDate.',
            userId: 'user10',
            eventDate: new Date('2025-09-20T14:00:00.000Z'), // On endDate
            eventTime: null,
            locationDescription: 'Local Library',
            organizerName: 'Community Hub',
            category: 'Workshop',
            tags: ['local', 'community'],
            websiteUrl: null,
            createdAt: new Date(baseTime.getTime() - 30000),
            updatedAt: new Date(baseTime),
          },
        ];
        const totalFilteredEvents = mockFilteredDbEvents.length;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockFilteredDbEvents,
          totalFilteredEvents,
        ]);
  
        await listEventsHandler(req, rep);
  
        const expectedWhereClause = {
          AND: [{ eventDate: { lte: expectedPrismaEndDate } }],
        };
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expectedWhereClause,
            skip: (expectedPage - 1) * expectedLimit,
            take: expectedLimit,
            orderBy: [{ [expectedSortBy]: expectedSortOrder }],
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expectedWhereClause,
          }),
        );
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(totalFilteredEvents);
        if (totalFilteredEvents > 0) {
          sentData.events.forEach((event: ApiEventResponse) => {
            // API response eventDate is 'YYYY-MM-DD'. new Date(event.eventDate) will be start of that day.
            // expectedPrismaEndDate is also start of its day.
            expect(new Date(event.eventDate) <= expectedPrismaEndDate).toBe(true);
          });
        }
        expect(sentData.totalEvents).toBe(totalFilteredEvents);
      });
  
      it('should filter events by date range (both startDate and endDate)', async () => {
        const startDateString = '2025-10-01';
        const endDateString = '2025-10-10';
        const expectedPrismaStartDate = new Date(startDateString);
        const expectedPrismaEndDate = new Date(endDateString);
  
        const expectedPage = 1;
        const expectedLimit = 10;
        const expectedSortBy = 'createdAt';
        const expectedSortOrder = 'desc';
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            startDate: startDateString,
            endDate: endDateString,
            page: expectedPage,
            limit: expectedLimit,
            sortBy: expectedSortBy,
            sortOrder: expectedSortOrder,
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date();
        const mockFilteredDbEvents: PrismaEventType[] = [
          {
            id: 'event-date-range-1',
            title: 'October Workshop',
            description: 'Workshop within the date range.',
            userId: 'user11',
            eventDate: new Date('2025-10-05T10:00:00.000Z'), // Within range
            eventTime: new Date(`1970-01-01T10:00:00.000Z`),
            locationDescription: 'Tech Hub',
            organizerName: 'Innovate Ltd.',
            category: 'Workshop',
            tags: ['innovation', 'october'],
            websiteUrl: 'http://innovateoct.com',
            createdAt: new Date(baseTime),
            updatedAt: new Date(baseTime),
          },
          {
            id: 'event-date-range-2',
            title: 'Start Date Event',
            description: 'Event on the startDate of the range.',
            userId: 'user12',
            eventDate: new Date('2025-10-01T14:00:00.000Z'), // On startDate
            eventTime: null,
            locationDescription: 'Main Hall',
            organizerName: 'Events R Us',
            category: 'Conference',
            tags: ['kickoff'],
            websiteUrl: null,
            createdAt: new Date(baseTime.getTime() - 40000),
            updatedAt: new Date(baseTime),
          },
          {
            id: 'event-date-range-3',
            title: 'End Date Seminar',
            description: 'Seminar on the endDate of the range.',
            userId: 'user13',
            eventDate: new Date('2025-10-10T16:00:00.000Z'), // On endDate
            eventTime: new Date(`1970-01-01T16:00:00.000Z`),
            locationDescription: 'Online',
            organizerName: 'Global Learn',
            category: 'Seminar',
            tags: ['online', 'final'],
            websiteUrl: 'http://globallearn.com',
            createdAt: new Date(baseTime.getTime() - 50000),
            updatedAt: new Date(baseTime),
          },
        ];
        const totalFilteredEvents = mockFilteredDbEvents.length;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockFilteredDbEvents,
          totalFilteredEvents,
        ]);
  
        await listEventsHandler(req, rep);
  
        const expectedWhereClause = {
          AND: [
            { eventDate: { gte: expectedPrismaStartDate } },
            { eventDate: { lte: expectedPrismaEndDate } },
          ],
        };
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expectedWhereClause,
            skip: (expectedPage - 1) * expectedLimit,
            take: expectedLimit,
            orderBy: [{ [expectedSortBy]: expectedSortOrder }],
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expectedWhereClause,
          }),
        );
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(totalFilteredEvents);
        if (totalFilteredEvents > 0) {
          sentData.events.forEach((event: ApiEventResponse) => {
            const eventDateObj = new Date(event.eventDate);
            expect(eventDateObj >= expectedPrismaStartDate).toBe(true);
            expect(eventDateObj <= expectedPrismaEndDate).toBe(true);
          });
        }
        expect(sentData.totalEvents).toBe(totalFilteredEvents);
      });
  
      it('should filter events by organizer name (case-insensitive using search)', async () => {
        const searchTerm = 'Events Co'; // Part of an organizer's name
        const expectedPage = 1;
        const expectedLimit = 10;
        const expectedSortBy = 'createdAt';
        const expectedSortOrder = 'desc';
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            search: searchTerm,
            page: expectedPage,
            limit: expectedLimit,
            sortBy: expectedSortBy,
            sortOrder: expectedSortOrder,
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date();
        const mockFilteredDbEvents: PrismaEventType[] = [
          {
            id: 'event-org-1',
            title: 'Annual Gala',
            description: 'A grand annual gala.',
            userId: 'user14',
            eventDate: new Date('2025-11-01T19:00:00.000Z'),
            eventTime: new Date(`1970-01-01T19:00:00.000Z`),
            locationDescription: 'Grand Ballroom',
            organizerName: 'Grand Events Co.', // Matches "Events Co"
            category: 'Gala',
            tags: ['formal', 'charity'],
            websiteUrl: 'http://grandeventsco.com',
            createdAt: new Date(baseTime),
            updatedAt: new Date(baseTime),
          },
          {
            id: 'event-org-2',
            title: 'Local Fair',
            description: 'Community fair by local events company.',
            userId: 'user15',
            eventDate: new Date('2025-11-05T12:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Town Square',
            organizerName: 'Local Events Company', // Matches "Events Co" (case-insensitive)
            category: 'Fair',
            tags: ['community', 'family'],
            websiteUrl: null,
            createdAt: new Date(baseTime.getTime() - 60000),
            updatedAt: new Date(baseTime),
          },
        ];
        const totalFilteredEvents = mockFilteredDbEvents.length;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockFilteredDbEvents,
          totalFilteredEvents,
        ]);
  
        await listEventsHandler(req, rep);
  
        const expectedWhereClause = {
          AND: [
            {
              OR: [
                { title: { contains: searchTerm, mode: 'insensitive' } },
                { description: { contains: searchTerm, mode: 'insensitive' } },
                { locationDescription: { contains: searchTerm, mode: 'insensitive' } },
                { organizerName: { contains: searchTerm, mode: 'insensitive' } },
                { category: { contains: searchTerm, mode: 'insensitive' } },
              ],
            },
          ],
        };
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expectedWhereClause,
            skip: (expectedPage - 1) * expectedLimit,
            take: expectedLimit,
            orderBy: [{ [expectedSortBy]: expectedSortOrder }],
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expectedWhereClause,
          }),
        );
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(totalFilteredEvents);
        if (totalFilteredEvents > 0) {
          sentData.events.forEach((event: ApiEventResponse) => {
            expect(event.organizerName.toLowerCase()).toContain(searchTerm.toLowerCase());
          });
        }
        expect(sentData.totalEvents).toBe(totalFilteredEvents);
      });
  
      it('should filter events by search term (title, description, location, category - case-insensitive)', async () => {
        const searchTerm = 'Workshop'; // A term that could appear in title, description, or category
        const expectedPage = 1;
        const expectedLimit = 10;
        const expectedSortBy = 'createdAt';
        const expectedSortOrder = 'desc';
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            search: searchTerm,
            page: expectedPage,
            limit: expectedLimit,
            sortBy: expectedSortBy,
            sortOrder: expectedSortOrder,
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date();
        const mockFilteredDbEvents: PrismaEventType[] = [
          {
            id: 'event-search-1',
            title: 'Advanced Coding Workshop',
            /* Matches title */ userId: 'user16',
            description: 'A workshop about advanced coding techniques.', // <<< ADD THIS LINE
            eventDate: new Date('2025-12-01T10:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Tech Center Room 101',
            organizerName: 'Coders Inc.',
            category: 'Programming',
            tags: ['coding', 'advanced'],
            websiteUrl: null,
            createdAt: new Date(baseTime),
            updatedAt: new Date(baseTime),
          },
          {
            id: 'event-search-2',
            title: 'Art Class',
            description: 'A hands-on art workshop for beginners.',
            /* Matches description */ userId: 'user17',
            eventDate: new Date('2025-12-02T14:00:00.000Z'),
            eventTime: new Date(`1970-01-01T14:00:00.000Z`),
            locationDescription: 'Community Studio',
            organizerName: 'Art Hub',
            category: 'Arts & Crafts',
            tags: ['art', 'beginner'],
            websiteUrl: 'http://arthub.com',
            createdAt: new Date(baseTime.getTime() - 70000),
            updatedAt: new Date(baseTime),
          },
          {
            id: 'event-search-3',
            title: 'Music Theory Basics',
            description: 'Learn music fundamentals.',
            userId: 'user18',
            eventDate: new Date('2025-12-03T18:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Music Hall Workshop Room',
            /* Matches location */ organizerName: 'Sound Academy',
            category: 'Music',
            tags: ['music', 'theory'],
            websiteUrl: null,
            createdAt: new Date(baseTime.getTime() - 80000),
            updatedAt: new Date(baseTime),
          },
          {
            id: 'event-search-4',
            title: 'Gardening Basics',
            description: 'Learn to garden.',
            userId: 'user19',
            eventDate: new Date('2025-12-04T11:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Community Garden',
            organizerName: 'Green Thumbs',
            category: 'Gardening Workshop',
            /* Matches category */ tags: ['gardening', 'outdoor'],
            websiteUrl: null,
            createdAt: new Date(baseTime.getTime() - 90000),
            updatedAt: new Date(baseTime),
          },
        ];
        const totalFilteredEvents = mockFilteredDbEvents.length;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockFilteredDbEvents,
          totalFilteredEvents,
        ]);
  
        await listEventsHandler(req, rep);
  
        const expectedWhereClause = {
          AND: [
            {
              OR: [
                { title: { contains: searchTerm, mode: 'insensitive' } },
                { description: { contains: searchTerm, mode: 'insensitive' } },
                { locationDescription: { contains: searchTerm, mode: 'insensitive' } },
                { organizerName: { contains: searchTerm, mode: 'insensitive' } },
                { category: { contains: searchTerm, mode: 'insensitive' } },
              ],
            },
          ],
        };
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expectedWhereClause,
            skip: (expectedPage - 1) * expectedLimit,
            take: expectedLimit,
            orderBy: [{ [expectedSortBy]: expectedSortOrder }],
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expectedWhereClause,
          }),
        );
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(totalFilteredEvents);
        if (totalFilteredEvents > 0) {
          sentData.events.forEach((event: ApiEventResponse) => {
            const lowerSearchTerm = searchTerm.toLowerCase();
            const foundInTitle = event.title.toLowerCase().includes(lowerSearchTerm);
            const foundInDescription = event.description.toLowerCase().includes(lowerSearchTerm);
            const foundInLocation = event.locationDescription.toLowerCase().includes(lowerSearchTerm);
            const foundInOrganizer = event.organizerName.toLowerCase().includes(lowerSearchTerm);
            const foundInCategory = event.category.toLowerCase().includes(lowerSearchTerm);
            expect(
              foundInTitle ||
                foundInDescription ||
                foundInLocation ||
                foundInOrganizer ||
                foundInCategory,
            ).toBe(true);
          });
        }
        expect(sentData.totalEvents).toBe(totalFilteredEvents);
      });
  
      it('should handle pagination correctly (page, limit)', async () => {
        const requestedPage = 2;
        const requestedLimit = 3;
        // For this test, assume no other filters are applied.
        // Defaults for sorting:
        const expectedSortBy = 'createdAt';
        const expectedSortOrder = 'desc';
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            page: requestedPage,
            limit: requestedLimit,
            // sortBy and sortOrder will use defaults from schema if not provided
            // but let's be explicit for clarity in what the controller receives
            sortBy: expectedSortBy,
            sortOrder: expectedSortOrder,
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        // Simulate a larger dataset for pagination to be meaningful
        const totalMockEventsInDb = 25;
        const baseTime = new Date();
  
        // Create a slice of events that would be returned for page 2, limit 3
        // (events at index 3, 4, 5 if 0-indexed)
        const mockPageData: PrismaEventType[] = Array.from({ length: requestedLimit }, (_, i) => ({
          id: `event-page-${requestedPage}-item-${i + 1}`,
          title: `Event on Page ${requestedPage}, Item ${i + 1}`,
          description: `Description for paginated event ${i + 1}`,
          userId: `user-page-${i}`,
          eventDate: new Date(new Date(baseTime).setDate(baseTime.getDate() + i)),
          eventTime: null,
          locationDescription: `Location ${i + 1}`,
          organizerName: `Organizer ${i + 1}`,
          category: `Category ${i % 2 === 0 ? 'A' : 'B'}`,
          tags: [`page${requestedPage}`, `item${i + 1}`],
          websiteUrl: null,
          createdAt: new Date(baseTime.getTime() - i * 10000),
          updatedAt: new Date(baseTime),
        }));
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockPageData, // The data for the current page
          totalMockEventsInDb, // The total count of events matching the (empty) filter
        ]);
  
        await listEventsHandler(req, rep);
  
        const expectedSkip = (requestedPage - 1) * requestedLimit;
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {}, // Assuming no other filters for this specific pagination test
            skip: expectedSkip,
            take: requestedLimit,
            orderBy: [{ [expectedSortBy]: expectedSortOrder }],
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {}, // Assuming no other filters
          }),
        );
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
  
        expect(sentData.events.length).toBe(mockPageData.length); // Should match the number of items for the page
        expect(sentData.totalEvents).toBe(totalMockEventsInDb);
        expect(sentData.totalPages).toBe(Math.ceil(totalMockEventsInDb / requestedLimit));
        expect(sentData.currentPage).toBe(requestedPage);
        expect(sentData.limit).toBe(requestedLimit);
  
        if (mockPageData.length > 0) {
          expect(sentData.events[0].id).toBe(mockPageData[0].id);
        }
      });
  
      it('should apply schema defaults for pagination and sorting if not provided in original query', async () => {
        // These are the defaults from your eventListQuerySchema
        const schemaDefaultPage = 1;
        const schemaDefaultLimit = 10;
        const schemaDefaultSortBy = 'createdAt';
        const schemaDefaultSortOrder = 'desc';
  
        const filterCategory = 'Music'; // Add another filter to make the query distinct
  
        // Simulate a request object where query parameters for page, limit, sortBy, sortOrder
        // were omitted in the URL, so Fastify/Zod applied their defaults.
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            category: filterCategory, // A specific filter from the original query
            page: schemaDefaultPage, // Value after Zod default
            limit: schemaDefaultLimit, // Value after Zod default
            sortBy: schemaDefaultSortBy, // Value after Zod default
            sortOrder: schemaDefaultSortOrder, // Value after Zod default
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date();
        const mockDbEventsData: PrismaEventType[] = [
          {
            id: 'event-default-pag-1',
            title: 'Concert in the Park',
            description: 'Live music event.',
            userId: 'user20',
            eventDate: new Date(new Date(baseTime).setDate(baseTime.getDate() + 1)),
            eventTime: null,
            locationDescription: 'City Park Bandshell',
            organizerName: 'Music Lovers Inc.',
            category: filterCategory,
            tags: ['live', 'outdoor'],
            websiteUrl: null,
            createdAt: new Date(baseTime),
            updatedAt: new Date(baseTime),
          },
        ];
        const mockTotalEvents = mockDbEventsData.length;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockDbEventsData,
          mockTotalEvents,
        ]);
  
        await listEventsHandler(req, rep);
  
        const expectedWhere = { AND: [{ category: filterCategory }] };
        const expectedSkip = (schemaDefaultPage - 1) * schemaDefaultLimit; // Should be 0
        const expectedTake = schemaDefaultLimit; // Should be 10
        const expectedOrderBy = [{ [schemaDefaultSortBy]: schemaDefaultSortOrder }]; // [{ createdAt: 'desc' }]
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expectedWhere,
            skip: expectedSkip,
            take: expectedTake,
            orderBy: expectedOrderBy,
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(
          expect.objectContaining({ where: expectedWhere }),
        );
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(mockDbEventsData.length);
        expect(sentData.totalEvents).toBe(mockTotalEvents);
        expect(sentData.currentPage).toBe(schemaDefaultPage);
        expect(sentData.limit).toBe(schemaDefaultLimit);
        expect(sentData.totalPages).toBe(Math.ceil(mockTotalEvents / schemaDefaultLimit));
      });
  
      it('should sort events by eventDate (asc)', async () => {
        const sortByField = 'eventDate';
        const sortOrderDirection = 'asc';
        const expectedPage = 1; // Default
        const expectedLimit = 10; // Default
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            sortBy: sortByField,
            sortOrder: sortOrderDirection,
            page: expectedPage,
            limit: expectedLimit,
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date();
        // The order of these mock events doesn't strictly matter for testing the orderBy clause,
        // but if you were to check the order in the response, they should match the sort.
        const mockDbEventsData: PrismaEventType[] = [
          {
            id: 'event-sort-1',
            title: 'Earlier Event',
            description: 'This event is earlier.',
            userId: 'user21',
            eventDate: new Date('2025-01-01T10:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Location A',
            organizerName: 'Org A',
            category: 'Category A',
            tags: ['early'],
            websiteUrl: null,
            createdAt: new Date(baseTime),
            updatedAt: new Date(baseTime),
          },
          {
            id: 'event-sort-2',
            title: 'Later Event',
            description: 'This event is later.',
            userId: 'user22',
            eventDate: new Date('2025-01-15T10:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Location B',
            organizerName: 'Org B',
            category: 'Category B',
            tags: ['late'],
            websiteUrl: null,
            createdAt: new Date(baseTime.getTime() - 10000),
            updatedAt: new Date(baseTime),
          },
        ];
        const mockTotalEvents = mockDbEventsData.length;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockDbEventsData, // For this test, the actual order of this data isn't the primary focus
          mockTotalEvents,
        ]);
  
        await listEventsHandler(req, rep);
  
        const expectedOrderBy = [{ [sortByField]: sortOrderDirection }]; // [{ eventDate: 'asc' }]
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {}, // Assuming no other filters for this specific sort test
            skip: (expectedPage - 1) * expectedLimit,
            take: expectedLimit,
            orderBy: expectedOrderBy,
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(mockDbEventsData.length);
        expect(sentData.totalEvents).toBe(mockTotalEvents);
        expect(sentData.currentPage).toBe(expectedPage);
        expect(sentData.limit).toBe(expectedLimit);
        // To strictly test the sorting in the response, you'd ensure mockDbEventsData
        // is sorted as per eventDate asc and then check the order of sentData.events.
        // For now, the primary check is that prisma.event.findMany was called correctly.
      });
  
      it('should sort events by eventDate (desc)', async () => {
        const sortByField = 'eventDate';
        const sortOrderDirection = 'desc'; // Changed to 'desc'
        const expectedPage = 1;
        const expectedLimit = 10;
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            sortBy: sortByField,
            sortOrder: sortOrderDirection,
            page: expectedPage,
            limit: expectedLimit,
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date();
        const mockDbEventsData: PrismaEventType[] = [
          {
            id: 'event-sort-desc-1',
            title: 'Later Event First',
            description: 'This event is later.',
            userId: 'user23',
            eventDate: new Date('2025-02-15T10:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Location C',
            organizerName: 'Org C',
            category: 'Category C',
            tags: ['desc', 'late'],
            websiteUrl: null,
            createdAt: new Date(baseTime),
            updatedAt: new Date(baseTime),
          },
          {
            id: 'event-sort-desc-2',
            title: 'Earlier Event Last',
            description: 'This event is earlier.',
            userId: 'user24',
            eventDate: new Date('2025-02-01T10:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Location D',
            organizerName: 'Org D',
            category: 'Category D',
            tags: ['desc', 'early'],
            websiteUrl: null,
            createdAt: new Date(baseTime.getTime() - 10000),
            updatedAt: new Date(baseTime),
          },
        ];
        const mockTotalEvents = mockDbEventsData.length;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockDbEventsData,
          mockTotalEvents,
        ]);
  
        await listEventsHandler(req, rep);
  
        const expectedOrderBy = [{ [sortByField]: sortOrderDirection }]; // [{ eventDate: 'desc' }]
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {},
            skip: (expectedPage - 1) * expectedLimit,
            take: expectedLimit,
            orderBy: expectedOrderBy,
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(mockDbEventsData.length);
        expect(sentData.totalEvents).toBe(mockTotalEvents);
        expect(sentData.currentPage).toBe(expectedPage);
        expect(sentData.limit).toBe(expectedLimit);
      });
  
      it('should sort events by createdAt (asc)', async () => {
        const sortByField = 'createdAt';
        const sortOrderDirection = 'asc';
        const expectedPage = 1;
        const expectedLimit = 10;
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            sortBy: sortByField,
            sortOrder: sortOrderDirection,
            page: expectedPage,
            limit: expectedLimit,
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date();
        const mockDbEventsData: PrismaEventType[] = [
          {
            id: 'event-sort-created-1',
            title: 'Created Earlier',
            description: 'This event was created earlier.',
            userId: 'user25',
            eventDate: new Date('2025-03-01T10:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Location E',
            organizerName: 'Org E',
            category: 'Category E',
            tags: ['created', 'early'],
            websiteUrl: null,
            createdAt: new Date(baseTime.getTime() - 20000), // Earlier createdAt
            updatedAt: new Date(baseTime),
          },
          {
            id: 'event-sort-created-2',
            title: 'Created Later',
            description: 'This event was created later.',
            userId: 'user26',
            eventDate: new Date('2025-03-05T10:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Location F',
            organizerName: 'Org F',
            category: 'Category F',
            tags: ['created', 'late'],
            websiteUrl: null,
            createdAt: new Date(baseTime), // Later createdAt
            updatedAt: new Date(baseTime),
          },
        ];
        const mockTotalEvents = mockDbEventsData.length;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockDbEventsData,
          mockTotalEvents,
        ]);
  
        await listEventsHandler(req, rep);
  
        const expectedOrderBy = [{ [sortByField]: sortOrderDirection }]; // [{ createdAt: 'asc' }]
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {},
            skip: (expectedPage - 1) * expectedLimit,
            take: expectedLimit,
            orderBy: expectedOrderBy,
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(mockDbEventsData.length);
        expect(sentData.totalEvents).toBe(mockTotalEvents);
        expect(sentData.currentPage).toBe(expectedPage);
        expect(sentData.limit).toBe(expectedLimit);
      });
  
      it('should sort events by createdAt (desc)', async () => {
        const sortByField = 'createdAt';
        const sortOrderDirection = 'desc'; // Changed to 'desc'
        const expectedPage = 1;
        const expectedLimit = 10;
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            sortBy: sortByField,
            sortOrder: sortOrderDirection,
            page: expectedPage,
            limit: expectedLimit,
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date();
        const mockDbEventsData: PrismaEventType[] = [
          {
            id: 'event-sort-created-desc-1',
            title: 'Created Later (Desc)',
            description: 'This event was created later.',
            userId: 'user27',
            eventDate: new Date('2025-04-01T10:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Location G',
            organizerName: 'Org G',
            category: 'Category G',
            tags: ['created', 'desc', 'late'],
            websiteUrl: null,
            createdAt: new Date(baseTime), // Later createdAt
            updatedAt: new Date(baseTime),
          },
          {
            id: 'event-sort-created-desc-2',
            title: 'Created Earlier (Desc)',
            description: 'This event was created earlier.',
            userId: 'user28',
            eventDate: new Date('2025-04-05T10:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Location H',
            organizerName: 'Org H',
            category: 'Category H',
            tags: ['created', 'desc', 'early'],
            websiteUrl: null,
            createdAt: new Date(baseTime.getTime() - 30000), // Earlier createdAt
            updatedAt: new Date(baseTime),
          },
        ];
        const mockTotalEvents = mockDbEventsData.length;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockDbEventsData,
          mockTotalEvents,
        ]);
  
        await listEventsHandler(req, rep);
  
        const expectedOrderBy = [{ [sortByField]: sortOrderDirection }]; // [{ createdAt: 'desc' }]
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {},
            skip: (expectedPage - 1) * expectedLimit,
            take: expectedLimit,
            orderBy: expectedOrderBy,
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(mockDbEventsData.length);
        expect(sentData.totalEvents).toBe(mockTotalEvents);
        expect(sentData.currentPage).toBe(expectedPage);
        expect(sentData.limit).toBe(expectedLimit);
      });
  
      it('should sort events by title (asc)', async () => {
        const sortByField = 'title';
        const sortOrderDirection = 'asc';
        const expectedPage = 1;
        const expectedLimit = 10;
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            sortBy: sortByField,
            sortOrder: sortOrderDirection,
            page: expectedPage,
            limit: expectedLimit,
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date();
        const mockDbEventsData: PrismaEventType[] = [
          {
            id: 'event-sort-title-1',
            title: 'Alpha Conference',
            description: 'Conference A.',
            userId: 'user29',
            eventDate: new Date('2025-05-01T10:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Venue A',
            organizerName: 'Org Alpha',
            category: 'Conference',
            tags: ['alpha', 'title-sort'],
            websiteUrl: null,
            createdAt: new Date(baseTime),
            updatedAt: new Date(baseTime),
          },
          {
            id: 'event-sort-title-2',
            title: 'Beta Workshop',
            description: 'Workshop B.',
            userId: 'user30',
            eventDate: new Date('2025-05-05T10:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Venue B',
            organizerName: 'Org Beta',
            category: 'Workshop',
            tags: ['beta', 'title-sort'],
            websiteUrl: null,
            createdAt: new Date(baseTime.getTime() - 40000),
            updatedAt: new Date(baseTime),
          },
        ];
        const mockTotalEvents = mockDbEventsData.length;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockDbEventsData,
          mockTotalEvents,
        ]);
  
        await listEventsHandler(req, rep);
  
        const expectedOrderBy = [{ [sortByField]: sortOrderDirection }]; // [{ title: 'asc' }]
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {},
            skip: (expectedPage - 1) * expectedLimit,
            take: expectedLimit,
            orderBy: expectedOrderBy,
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(mockDbEventsData.length);
        expect(sentData.totalEvents).toBe(mockTotalEvents);
        expect(sentData.currentPage).toBe(expectedPage);
        expect(sentData.limit).toBe(expectedLimit);
      });
  
      it('should sort events by title (desc)', async () => {
        const sortByField = 'title';
        const sortOrderDirection = 'desc'; // Changed to 'desc'
        const expectedPage = 1;
        const expectedLimit = 10;
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            sortBy: sortByField,
            sortOrder: sortOrderDirection,
            page: expectedPage,
            limit: expectedLimit,
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date();
        const mockDbEventsData: PrismaEventType[] = [
          {
            id: 'event-sort-title-desc-1',
            title: 'Zeta Gathering',
            description: 'Gathering Z.',
            userId: 'user31',
            eventDate: new Date('2025-06-01T10:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Venue Z',
            organizerName: 'Org Zeta',
            category: 'Gathering',
            tags: ['zeta', 'title-sort'],
            websiteUrl: null,
            createdAt: new Date(baseTime),
            updatedAt: new Date(baseTime),
          },
          {
            id: 'event-sort-title-desc-2',
            title: 'Yoga Retreat',
            description: 'Retreat Y.',
            userId: 'user32',
            eventDate: new Date('2025-06-05T10:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Venue Y',
            organizerName: 'Org Yoga',
            category: 'Retreat',
            tags: ['yoga', 'title-sort'],
            websiteUrl: null,
            createdAt: new Date(baseTime.getTime() - 50000),
            updatedAt: new Date(baseTime),
          },
        ];
        const mockTotalEvents = mockDbEventsData.length;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockDbEventsData,
          mockTotalEvents,
        ]);
  
        await listEventsHandler(req, rep);
  
        const expectedOrderBy = [{ [sortByField]: sortOrderDirection }]; // [{ title: 'desc' }]
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {},
            skip: (expectedPage - 1) * expectedLimit,
            take: expectedLimit,
            orderBy: expectedOrderBy,
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(mockDbEventsData.length);
        expect(sentData.totalEvents).toBe(mockTotalEvents);
        expect(sentData.currentPage).toBe(expectedPage);
        expect(sentData.limit).toBe(expectedLimit);
      });
  
      it('should sort events by organizerName (asc)', async () => {
        const sortByField = 'organizerName';
        const sortOrderDirection = 'asc';
        const expectedPage = 1;
        const expectedLimit = 10;
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            sortBy: sortByField,
            sortOrder: sortOrderDirection,
            page: expectedPage,
            limit: expectedLimit,
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date();
        const mockDbEventsData: PrismaEventType[] = [
          {
            id: 'event-sort-org-1',
            title: 'Event by Org A',
            description: 'Org A event.',
            userId: 'user33',
            eventDate: new Date('2025-07-01T10:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Venue X',
            organizerName: 'Alpha Organizers',
            category: 'Conference',
            tags: ['org-sort', 'alpha'],
            websiteUrl: null,
            createdAt: new Date(baseTime),
            updatedAt: new Date(baseTime),
          },
          {
            id: 'event-sort-org-2',
            title: 'Event by Org B',
            description: 'Org B event.',
            userId: 'user34',
            eventDate: new Date('2025-07-05T10:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Venue Y',
            organizerName: 'Beta Planners',
            category: 'Workshop',
            tags: ['org-sort', 'beta'],
            websiteUrl: null,
            createdAt: new Date(baseTime.getTime() - 60000),
            updatedAt: new Date(baseTime),
          },
        ];
        const mockTotalEvents = mockDbEventsData.length;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockDbEventsData,
          mockTotalEvents,
        ]);
  
        await listEventsHandler(req, rep);
  
        const expectedOrderBy = [{ [sortByField]: sortOrderDirection }]; // [{ organizerName: 'asc' }]
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {},
            skip: (expectedPage - 1) * expectedLimit,
            take: expectedLimit,
            orderBy: expectedOrderBy,
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(mockDbEventsData.length);
        expect(sentData.totalEvents).toBe(mockTotalEvents);
        expect(sentData.currentPage).toBe(expectedPage);
        expect(sentData.limit).toBe(expectedLimit);
      });
  
      it('should sort events by organizerName (desc)', async () => {
        const sortByField = 'organizerName';
        const sortOrderDirection = 'desc'; // Changed to 'desc'
        const expectedPage = 1;
        const expectedLimit = 10;
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            sortBy: sortByField,
            sortOrder: sortOrderDirection,
            page: expectedPage,
            limit: expectedLimit,
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date();
        const mockDbEventsData: PrismaEventType[] = [
          {
            id: 'event-sort-org-desc-1',
            title: 'Event by Org Z',
            description: 'Org Z event.',
            userId: 'user35',
            eventDate: new Date('2025-08-01T10:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Venue M',
            organizerName: 'Zeta Productions',
            category: 'Festival',
            tags: ['org-sort', 'zeta'],
            websiteUrl: null,
            createdAt: new Date(baseTime),
            updatedAt: new Date(baseTime),
          },
          {
            id: 'event-sort-org-desc-2',
            title: 'Event by Org Y',
            description: 'Org Y event.',
            userId: 'user36',
            eventDate: new Date('2025-08-05T10:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Venue N',
            organizerName: 'Yankee Events',
            category: 'Expo',
            tags: ['org-sort', 'yankee'],
            websiteUrl: null,
            createdAt: new Date(baseTime.getTime() - 70000),
            updatedAt: new Date(baseTime),
          },
        ];
        const mockTotalEvents = mockDbEventsData.length;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockDbEventsData,
          mockTotalEvents,
        ]);
  
        await listEventsHandler(req, rep);
  
        const expectedOrderBy = [{ [sortByField]: sortOrderDirection }]; // [{ organizerName: 'desc' }]
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {},
            skip: (expectedPage - 1) * expectedLimit,
            take: expectedLimit,
            orderBy: expectedOrderBy,
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(mockDbEventsData.length);
        expect(sentData.totalEvents).toBe(mockTotalEvents);
        expect(sentData.currentPage).toBe(expectedPage);
        expect(sentData.limit).toBe(expectedLimit);
      });
  
      it('should sort events by category (asc)', async () => {
        const sortByField = 'category';
        const sortOrderDirection = 'asc';
        const expectedPage = 1;
        const expectedLimit = 10;
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            sortBy: sortByField,
            sortOrder: sortOrderDirection,
            page: expectedPage,
            limit: expectedLimit,
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date();
        const mockDbEventsData: PrismaEventType[] = [
          {
            id: 'event-sort-cat-1',
            title: 'Art Expo',
            description: 'Exhibition of art.',
            userId: 'user37',
            eventDate: new Date('2025-09-01T10:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Art Gallery',
            organizerName: 'Art Curators',
            category: 'Art',
            tags: ['category-sort', 'art'],
            websiteUrl: null,
            createdAt: new Date(baseTime),
            updatedAt: new Date(baseTime),
          },
          {
            id: 'event-sort-cat-2',
            title: 'Tech Conference',
            description: 'Conference on tech.',
            userId: 'user38',
            eventDate: new Date('2025-09-05T10:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Tech Park',
            organizerName: 'Tech Innovators',
            category: 'Technology',
            tags: ['category-sort', 'tech'],
            websiteUrl: null,
            createdAt: new Date(baseTime.getTime() - 80000),
            updatedAt: new Date(baseTime),
          },
        ];
        const mockTotalEvents = mockDbEventsData.length;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockDbEventsData,
          mockTotalEvents,
        ]);
  
        await listEventsHandler(req, rep);
  
        const expectedOrderBy = [{ [sortByField]: sortOrderDirection }]; // [{ category: 'asc' }]
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {},
            skip: (expectedPage - 1) * expectedLimit,
            take: expectedLimit,
            orderBy: expectedOrderBy,
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(mockDbEventsData.length);
        expect(sentData.totalEvents).toBe(mockTotalEvents);
        expect(sentData.currentPage).toBe(expectedPage);
        expect(sentData.limit).toBe(expectedLimit);
      });
  
      it('should sort events by category (desc)', async () => {
        const sortByField = 'category';
        const sortOrderDirection = 'desc'; // Changed to 'desc'
        const expectedPage = 1;
        const expectedLimit = 10;
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            sortBy: sortByField,
            sortOrder: sortOrderDirection,
            page: expectedPage,
            limit: expectedLimit,
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date();
        const mockDbEventsData: PrismaEventType[] = [
          {
            id: 'event-sort-cat-desc-1',
            title: 'Workshop on Wellness',
            description: 'Wellness workshop.',
            userId: 'user39',
            eventDate: new Date('2025-10-01T10:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Wellness Center',
            organizerName: 'Wellness Gurus',
            category: 'Wellness',
            tags: ['category-sort', 'wellness'],
            websiteUrl: null,
            createdAt: new Date(baseTime),
            updatedAt: new Date(baseTime),
          },
          {
            id: 'event-sort-cat-desc-2',
            title: 'Music Festival',
            description: 'Outdoor music fest.',
            userId: 'user40',
            eventDate: new Date('2025-10-05T10:00:00.000Z'),
            eventTime: null,
            locationDescription: 'City Park',
            organizerName: 'Music Fest Co.',
            category: 'Music',
            tags: ['category-sort', 'music'],
            websiteUrl: null,
            createdAt: new Date(baseTime.getTime() - 90000),
            updatedAt: new Date(baseTime),
          },
        ];
        const mockTotalEvents = mockDbEventsData.length;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockDbEventsData,
          mockTotalEvents,
        ]);
  
        await listEventsHandler(req, rep);
  
        const expectedOrderBy = [{ [sortByField]: sortOrderDirection }]; // [{ category: 'desc' }]
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {},
            skip: (expectedPage - 1) * expectedLimit,
            take: expectedLimit,
            orderBy: expectedOrderBy,
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(mockDbEventsData.length);
        expect(sentData.totalEvents).toBe(mockTotalEvents);
        expect(sentData.currentPage).toBe(expectedPage);
        expect(sentData.limit).toBe(expectedLimit);
      });
  
      it('should handle complex queries with multiple filters, sorting, and pagination', async () => {
        const queryCategory = 'Workshop';
        const queryTags = 'tech,frontend';
        const queryStartDate = '2025-11-01';
        const queryEndDate = '2025-11-30';
        const querySearch = 'React';
        const querySortBy = 'eventDate';
        const querySortOrder = 'asc';
        const queryPage = 2;
        const queryLimit = 5;
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            category: queryCategory,
            tags: queryTags,
            startDate: queryStartDate,
            endDate: queryEndDate,
            search: querySearch,
            sortBy: querySortBy,
            sortOrder: querySortOrder,
            page: queryPage,
            limit: queryLimit,
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date();
        // Mock events that would satisfy all these conditions if they were page 2, limit 5
        const mockDbEventsData: PrismaEventType[] = [
          {
            id: 'complex-event-1',
            title: 'Advanced React Workshop',
            description: 'A deep dive into React for frontend developers.',
            userId: 'user41',
            eventDate: new Date('2025-11-10T10:00:00.000Z'),
            eventTime: new Date(`1970-01-01T10:00:00.000Z`),
            locationDescription: 'Online',
            organizerName: 'Dev Experts',
            category: queryCategory, // Workshop
            tags: ['tech', 'frontend', 'react'], // Matches 'tech', 'frontend'
            websiteUrl: 'http://devexperts.com/react',
            createdAt: new Date(baseTime.getTime() - 100000),
            updatedAt: new Date(baseTime),
          },
          {
            id: 'complex-event-2',
            title: 'React Native Beginners Workshop',
            description: 'Getting started with React Native.',
            userId: 'user42',
            eventDate: new Date('2025-11-15T14:00:00.000Z'),
            eventTime: null,
            locationDescription: 'Tech Hub Room 3',
            organizerName: 'Mobile First Ltd',
            category: queryCategory, // Workshop
            tags: ['tech', 'frontend', 'mobile', 'react'], // Matches 'tech', 'frontend'
            websiteUrl: null,
            createdAt: new Date(baseTime.getTime() - 110000),
            updatedAt: new Date(baseTime),
          },
        ];
        const mockTotalMatchingEvents = 12; // Simulate more events matching than fit on one page
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockDbEventsData,
          mockTotalMatchingEvents,
        ]);
  
        await listEventsHandler(req, rep);
  
        const expectedPrismaStartDate = new Date(queryStartDate);
        const expectedPrismaEndDate = new Date(queryEndDate);
        const expectedParsedTags = queryTags.split(',').map((tag) => tag.trim());
  
        const expectedWhereClause = {
          AND: [
            { category: queryCategory },
            { tags: { hasSome: expectedParsedTags } },
            { eventDate: { gte: expectedPrismaStartDate } },
            { eventDate: { lte: expectedPrismaEndDate } },
            {
              OR: [
                { title: { contains: querySearch, mode: 'insensitive' } },
                { description: { contains: querySearch, mode: 'insensitive' } },
                { locationDescription: { contains: querySearch, mode: 'insensitive' } },
                { organizerName: { contains: querySearch, mode: 'insensitive' } },
                { category: { contains: querySearch, mode: 'insensitive' } },
              ],
            },
          ],
        };
        const expectedOrderBy = [{ [querySortBy]: querySortOrder }];
        const expectedSkip = (queryPage - 1) * queryLimit;
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expectedWhereClause,
            skip: expectedSkip,
            take: queryLimit,
            orderBy: expectedOrderBy,
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expectedWhereClause,
          }),
        );
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events.length).toBe(mockDbEventsData.length);
        expect(sentData.totalEvents).toBe(mockTotalMatchingEvents);
        expect(sentData.totalPages).toBe(Math.ceil(mockTotalMatchingEvents / queryLimit));
        expect(sentData.currentPage).toBe(queryPage);
        expect(sentData.limit).toBe(queryLimit);
  
        // Optionally, verify some content of the returned events if transformEventForApi is complex
        if (sentData.events.length > 0) {
          expect(sentData.events[0].id).toBe(mockDbEventsData[0].id);
          expect(sentData.events[0].category).toBe(queryCategory);
          // Add more checks if necessary
        }
      });
  
      it('should return an empty list and correct pagination if no events match filters', async () => {
        const queryCategory = 'NonExistentCategory'; // A category that won't match
        const queryPage = 1;
        const queryLimit = 10;
        const querySortBy = 'createdAt';
        const querySortOrder = 'desc';
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            category: queryCategory,
            page: queryPage,
            limit: queryLimit,
            sortBy: querySortBy,
            sortOrder: querySortOrder,
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        // Mock Prisma to return no events and a total count of 0
        const mockDbEventsData: PrismaEventType[] = [];
        const mockTotalMatchingEvents = 0;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockDbEventsData,
          mockTotalMatchingEvents,
        ]);
  
        await listEventsHandler(req, rep);
  
        const expectedWhereClause = {
          AND: [{ category: queryCategory }],
        };
        const expectedOrderBy = [{ [querySortBy]: querySortOrder }];
        const expectedSkip = (queryPage - 1) * queryLimit;
  
        expect(prisma.event.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expectedWhereClause,
            skip: expectedSkip,
            take: queryLimit,
            orderBy: expectedOrderBy,
            select: commonEventSelect,
          }),
        );
        expect(prisma.event.count).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expectedWhereClause,
          }),
        );
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(rep.code).toHaveBeenCalledWith(200);
        const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
        expect(sentData.events).toEqual([]); // Expect an empty array
        expect(sentData.totalEvents).toBe(0);
        expect(sentData.totalPages).toBe(0); // Math.ceil(0 / limit) is 0
        expect(sentData.currentPage).toBe(queryPage);
        expect(sentData.limit).toBe(queryLimit);
      });
  
      it('should return 500 if Prisma query for events fails', async () => {
        const queryPage = 1;
        const queryLimit = 10;
        const querySortBy = 'createdAt';
        const querySortOrder = 'desc';
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: {
            page: queryPage,
            limit: queryLimit,
            sortBy: querySortBy,
            sortOrder: querySortOrder,
          },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const mockError = new Error('Database query failed catastrophically');
        (prisma.$transaction as import('vitest').Mock).mockRejectedValue(mockError);
  
        await listEventsHandler(req, rep);
  
        // Prisma calls would still be attempted within the try block
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        expect(req.log.error).toHaveBeenCalledWith(
          { error: mockError, query: req.query },
          'Error fetching events',
        );
        expect(rep.code).toHaveBeenCalledWith(500);
        expect(rep.send).toHaveBeenCalledWith({
          message: 'An error occurred while fetching events.',
        });
      });
  
      it('should return 500 if event transformation fails for any event', async () => {
        const queryPage = 1;
        const queryLimit = 10;
  
        const req = mockRequest<{ Querystring: EventListQuery }>({
          query: { page: queryPage, limit: queryLimit, sortBy: 'createdAt', sortOrder: 'desc' },
        }) as AppFastifyRequest<{ Querystring: EventListQuery }>;
        const rep = mockReply<{ Querystring: EventListQuery }>() as AppFastifyReply<{
          Querystring: EventListQuery;
        }>;
  
        const baseTime = new Date();
        // This event is fine and should be processed by the actual transformEventForApi before the bad one.
        const mockGoodEventData: PrismaEventType = {
          id: 'event-good-1',
          title: 'Good Event',
          description: 'This one is fine.',
          userId: 'user-tf-1',
          eventDate: new Date(baseTime),
          eventTime: null,
          locationDescription: 'Here',
          organizerName: 'Org',
          category: 'Test',
          tags: [],
          websiteUrl: null,
          createdAt: new Date(baseTime),
          updatedAt: new Date(baseTime),
        };
        // This event will cause the *actual* transformEventForApi to throw an error
        // because createdAt is null.
        const mockBadEventData: PrismaEventType = {
          id: 'event-bad-transform',
          title: 'Bad Event',
          description: 'This will fail transformation.',
          userId: 'user-tf-2',
          eventDate: new Date(baseTime),
          eventTime: null,
          locationDescription: 'There',
          organizerName: 'OrgFail',
          category: 'Failure',
          tags: [],
          websiteUrl: null,
          createdAt: null as any, // Intentionally null to cause .toISOString() to fail
          updatedAt: new Date(baseTime),
        };
  
        // The .map() in listEventsHandler will process events sequentially.
        // If mockGoodEventData is first, its transformation would succeed.
        // Then mockBadEventData's transformation would fail.
        const mockDbEvents = [mockGoodEventData, mockBadEventData];
        const mockTotalEvents = mockDbEvents.length;
  
        (prisma.$transaction as import('vitest').Mock).mockResolvedValue([
          mockDbEvents,
          mockTotalEvents,
        ]);
  
        // We are NOT doing (transformEventForApi as ...).mockImplementation(...) here.
        // We rely on the *actual* transformEventForApi (called by listEventsHandler)
        // to throw an error when it encounters mockBadEventData.
  
        await listEventsHandler(req, rep);
  
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  
        // We cannot assert that the *mocked export* transformEventForApi was called
        // because listEventsHandler calls its internal, original version.
        // The important part is that an error occurred during the mapping phase.
  
        expect(req.log.error).toHaveBeenCalledWith(
          // The error from event.createdAt.toISOString() when event.createdAt is null
          // will be a TypeError.
          { error: expect.any(TypeError), query: req.query },
          'Error fetching events',
        );
        expect(rep.code).toHaveBeenCalledWith(500);
        expect(rep.send).toHaveBeenCalledWith({
          message: 'An error occurred while fetching events.',
        });
      });
    });
  
    describe('updateEventHandler', () => {
      const mockAuthenticatedUser = { id: 'user-id-owner', username: 'eventOwner' };
      const mockEventId = 'event-to-update-uuid';
      const mockNonExistentEventId = 'non-existent-event-uuid';
  
      beforeEach(() => {
        (transformEventForApi as import('vitest').Mock).mockImplementation(
          (event: PrismaEventType): ApiEventResponse => {
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
          },
        );
      });
  
      it('should update an event successfully if user is the owner', async () => {
        const updatePayload: UpdateEventInput = {
          title: 'Updated Event Title',
          description: 'Updated description for this fantastic event.',
          eventDate: '2026-01-15',
          eventTime: '10:30:00',
          locationDescription: 'Updated Location Hall',
          organizerName: 'Updated Organizers Inc.',
          category: 'Updated Category',
          tags: ['updated', 'refreshed'],
          websiteUrl: 'https://updatedevent.com',
        };
  
        const req = mockRequest<{ Params: EventParams; Body: UpdateEventInput }>({
          user: mockAuthenticatedUser,
          params: { eventId: mockEventId },
          body: updatePayload,
        }) as AppFastifyRequest<{ Params: EventParams; Body: UpdateEventInput }>;
        const rep = mockReply<{ Params: EventParams; Body: UpdateEventInput }>() as AppFastifyReply<{
          Params: EventParams;
          Body: UpdateEventInput;
        }>;
  
        // Spy on req.log.info for this specific request object
        // Ensure req.log and req.log.info are defined in mockRequest if they aren't already
        if (!req.log) {
          req.log = {
            error: vi.fn(),
            warn: vi.fn(),
            info: vi.fn(),
            debug: vi.fn(),
            trace: vi.fn(),
            fatal: vi.fn(),
          } as any;
        } else if (typeof req.log.info !== 'function' || !('mock' in req.log.info)) {
          vi.spyOn(req.log, 'info').mockImplementation(() => {}); // Make it a spy
        }
  
        const originalEventDate = new Date('2025-12-20T00:00:00.000Z');
        const originalCreatedAt = new Date('2025-01-01T10:00:00.000Z');
  
        const mockExistingEvent: PrismaEventType = {
          id: mockEventId,
          userId: mockAuthenticatedUser.id,
          title: 'Original Event Title',
          description: 'Original event description.',
          eventDate: originalEventDate,
          eventTime: new Date('1970-01-01T09:00:00.000Z'),
          locationDescription: 'Original Location',
          organizerName: 'Original Organizers',
          category: 'Original Category',
          tags: ['original'],
          websiteUrl: 'https://originalevent.com',
          createdAt: originalCreatedAt,
          updatedAt: originalCreatedAt,
        };
  
        (prisma.event.findUnique as import('vitest').Mock).mockResolvedValue(mockExistingEvent);
  
        const expectedPrismaUpdateDate = new Date(updatePayload.eventDate!);
        const expectedPrismaUpdateTime = new Date(`1970-01-01T${updatePayload.eventTime!}Z`);
        const mockUpdatedTimestamp = new Date('2025-01-01T12:00:00.000Z');
  
        const mockUpdatedDbEvent: PrismaEventType = {
          ...mockExistingEvent,
          title: updatePayload.title!,
          description: updatePayload.description!,
          eventDate: expectedPrismaUpdateDate,
          eventTime: expectedPrismaUpdateTime,
          locationDescription: updatePayload.locationDescription!,
          organizerName: updatePayload.organizerName!,
          category: updatePayload.category!,
          tags: updatePayload.tags!,
          websiteUrl: updatePayload.websiteUrl!,
          updatedAt: mockUpdatedTimestamp,
        };
  
        (prisma.event.update as import('vitest').Mock).mockResolvedValue(mockUpdatedDbEvent);
  
        await updateEventHandler(req, rep);
  
        expect(prisma.event.findUnique).toHaveBeenCalledWith({
          where: { id: mockEventId },
        });
  
        const expectedDataForPrisma: Prisma.EventUpdateInput = {
          title: updatePayload.title,
          description: updatePayload.description,
          eventDate: expectedPrismaUpdateDate,
          eventTime: expectedPrismaUpdateTime,
          locationDescription: updatePayload.locationDescription,
          organizerName: updatePayload.organizerName,
          category: updatePayload.category,
          tags: updatePayload.tags,
          websiteUrl: updatePayload.websiteUrl,
        };
        expect(prisma.event.update).toHaveBeenCalledWith({
          where: { id: mockEventId },
          data: expectedDataForPrisma,
          select: commonEventSelect,
        });
  
        const expectedApiEvent = transformEventForApi(mockUpdatedDbEvent);
        expect(transformEventForApi).toHaveBeenCalledWith(mockUpdatedDbEvent);
        expect(rep.code).toHaveBeenCalledWith(200);
        expect(rep.send).toHaveBeenCalledWith(expectedApiEvent);
  
        // 4. Check log calls
        // First log call
        expect(req.log.info).toHaveBeenNthCalledWith(
          1,
          { eventId: mockEventId, userId: mockAuthenticatedUser.id, updateData: updatePayload },
          'User authorized and attempting to update event.',
        );
  
        // Second log call - corrected metadata (no title)
        expect(req.log.info).toHaveBeenNthCalledWith(
          2,
          { eventId: mockEventId, userId: mockAuthenticatedUser.id }, // Corrected: No title here
          'Event updated successfully by owner.',
        );
      });
  
      it('should return 403 if user is not the owner of the event', async () => {
        const nonOwnerUserId = 'user-id-non-owner';
        const updatePayload: UpdateEventInput = { title: 'Attempted Update Title' };
  
        const req = mockRequest<{ Params: EventParams; Body: UpdateEventInput }>({
          user: { id: nonOwnerUserId, username: 'nonOwnerUser' }, // Authenticated user is NOT the owner
          params: { eventId: mockEventId },
          body: updatePayload,
        }) as AppFastifyRequest<{ Params: EventParams; Body: UpdateEventInput }>;
        const rep = mockReply<{ Params: EventParams; Body: UpdateEventInput }>() as AppFastifyReply<{
          Params: EventParams;
          Body: UpdateEventInput;
        }>;
  
        // Spy on req.log.warn for this specific request object
        if (!req.log) {
          req.log = {
            error: vi.fn(),
            warn: vi.fn(),
            info: vi.fn(),
            debug: vi.fn(),
            trace: vi.fn(),
            fatal: vi.fn(),
          } as any;
        } else if (typeof req.log.warn !== 'function' || !('mock' in req.log.warn)) {
          vi.spyOn(req.log, 'warn').mockImplementation(() => {});
        }
  
        const actualOwnerUserId = 'user-id-actual-owner'; // The event belongs to this user
        const mockExistingEvent: PrismaEventType = {
          id: mockEventId,
          userId: actualOwnerUserId, // Event owned by a different user
          title: 'Original Event Title',
          description: 'Original event description.',
          eventDate: new Date('2025-12-20T00:00:00.000Z'),
          eventTime: new Date('1970-01-01T09:00:00.000Z'),
          locationDescription: 'Original Location',
          organizerName: 'Original Organizers',
          category: 'Original Category',
          tags: ['original'],
          websiteUrl: 'https://originalevent.com',
          createdAt: new Date('2025-01-01T10:00:00.000Z'),
          updatedAt: new Date('2025-01-01T10:00:00.000Z'),
        };
  
        (prisma.event.findUnique as import('vitest').Mock).mockResolvedValue(mockExistingEvent);
  
        // Call the handler
        await updateEventHandler(req, rep);
  
        // 1. Check if event was fetched
        expect(prisma.event.findUnique).toHaveBeenCalledWith({
          where: { id: mockEventId },
        });
  
        // 2. Check that Prisma update was NOT called
        expect(prisma.event.update).not.toHaveBeenCalled();
  
        // 3. Check for the 403 response
        expect(rep.code).toHaveBeenCalledWith(403);
        expect(rep.send).toHaveBeenCalledWith({
          message: 'You are not authorized to update this event.',
        });
  
        // 4. Check for the warning log
        expect(req.log.warn).toHaveBeenCalledWith(
          {
            eventId: mockEventId,
            eventOwnerId: actualOwnerUserId,
            attemptingUserId: nonOwnerUserId,
          },
          'User authorization failed: Attempt to update event they do not own.',
        );
      });
  
      it('should return 404 if event to update is not found', async () => {
        const updatePayload: UpdateEventInput = { title: 'Update for Non-Existent Event' };
  
        const req = mockRequest<{ Params: EventParams; Body: UpdateEventInput }>({
          user: mockAuthenticatedUser,
          params: { eventId: mockNonExistentEventId }, // Using an ID that won't be found
          body: updatePayload,
        }) as AppFastifyRequest<{ Params: EventParams; Body: UpdateEventInput }>;
        const rep = mockReply<{ Params: EventParams; Body: UpdateEventInput }>() as AppFastifyReply<{
          Params: EventParams;
          Body: UpdateEventInput;
        }>;
  
        // Spy on req.log.info for this specific request object
        if (!req.log) {
          req.log = {
            error: vi.fn(),
            warn: vi.fn(),
            info: vi.fn(),
            debug: vi.fn(),
            trace: vi.fn(),
            fatal: vi.fn(),
          } as any;
        } else if (typeof req.log.info !== 'function' || !('mock' in req.log.info)) {
          vi.spyOn(req.log, 'info').mockImplementation(() => {});
        }
  
        // Mock prisma.event.findUnique to return null, simulating event not found
        (prisma.event.findUnique as import('vitest').Mock).mockResolvedValue(null);
  
        // Call the handler
        await updateEventHandler(req, rep);
  
        // 1. Check if event was attempted to be fetched
        expect(prisma.event.findUnique).toHaveBeenCalledWith({
          where: { id: mockNonExistentEventId },
        });
  
        // 2. Check that Prisma update was NOT called
        expect(prisma.event.update).not.toHaveBeenCalled();
  
        // 3. Check for the 404 response
        expect(rep.code).toHaveBeenCalledWith(404);
        expect(rep.send).toHaveBeenCalledWith({
          message: 'Event not found.',
        });
  
        // 4. Check for the info log
        expect(req.log.info).toHaveBeenCalledWith(
          { eventId: mockNonExistentEventId, userId: mockAuthenticatedUser.id },
          'User attempted to update non-existent event.',
        );
      });
  
      it('should return 400 if an internal operation throws a ZodError', async () => {
        const updatePayload: UpdateEventInput = { title: 'Valid Update Attempt' }; // Body itself is valid
  
        const req = mockRequest<{ Params: EventParams; Body: UpdateEventInput }>({
          user: mockAuthenticatedUser,
          params: { eventId: mockEventId },
          body: updatePayload,
        }) as AppFastifyRequest<{ Params: EventParams; Body: UpdateEventInput }>;
        const rep = mockReply<any>() as AppFastifyReply<any>; // Using any for reply for simplicity here
  
        // Spy on req.log.error for this specific request object
        if (!req.log) {
          req.log = {
            error: vi.fn(),
            warn: vi.fn(),
            info: vi.fn(),
            debug: vi.fn(),
            trace: vi.fn(),
            fatal: vi.fn(),
          } as any;
        } else if (typeof req.log.error !== 'function' || !('mock' in req.log.error)) {
          vi.spyOn(req.log, 'error').mockImplementation(() => {});
        }
  
        const mockZodError = new ZodError([
          { code: 'custom', path: ['internalField'], message: 'An internal Zod validation failed' },
        ]);
  
        // Simulate prisma.event.findUnique throwing a ZodError
        // This is to test the catch (error instanceof ZodError) block in the handler
        (prisma.event.findUnique as import('vitest').Mock).mockRejectedValue(mockZodError);
  
        // Call the handler
        await updateEventHandler(req, rep);
  
        // 1. Check if event fetch was attempted
        expect(prisma.event.findUnique).toHaveBeenCalledWith({
          where: { id: mockEventId },
        });
  
        // 2. Check that Prisma update was NOT called
        expect(prisma.event.update).not.toHaveBeenCalled();
  
        // 3. Check for the 400 response due to ZodError
        expect(rep.code).toHaveBeenCalledWith(400);
        expect(rep.send).toHaveBeenCalledWith({
          message: 'Validation error',
          errors: mockZodError.flatten().fieldErrors,
        });
  
        // 4. Check for the error log
        expect(req.log.error).toHaveBeenCalledWith(
          {
            error: mockZodError,
            eventId: mockEventId,
            updateData: updatePayload,
            userId: mockAuthenticatedUser.id,
          },
          'Error updating event',
        );
      });
  
      it('should return 500 for other Prisma errors during update (e.g., P2025)', async () => {
        const updatePayload: UpdateEventInput = { title: 'Valid Update Attempt' };
  
        const req = mockRequest<{ Params: EventParams; Body: UpdateEventInput }>({
          user: mockAuthenticatedUser,
          params: { eventId: mockEventId },
          body: updatePayload,
        }) as AppFastifyRequest<{ Params: EventParams; Body: UpdateEventInput }>;
        const rep = mockReply<any>() as AppFastifyReply<any>;
  
        if (!req.log) {
          req.log = {
            error: vi.fn(),
            warn: vi.fn(),
            info: vi.fn(),
            debug: vi.fn(),
            trace: vi.fn(),
            fatal: vi.fn(),
          } as any;
        } else if (typeof req.log.error !== 'function' || !('mock' in req.log.error)) {
          vi.spyOn(req.log, 'error').mockImplementation(() => {});
        }
  
        const mockExistingEvent: PrismaEventType = {
          id: mockEventId,
          userId: mockAuthenticatedUser.id, // Owner matches
          title: 'Original Event Title',
          description: 'Original event description.',
          eventDate: new Date('2025-12-20T00:00:00.000Z'),
          eventTime: new Date('1970-01-01T09:00:00.000Z'),
          locationDescription: 'Original Location',
          organizerName: 'Original Organizers',
          category: 'Original Category',
          tags: ['original'],
          websiteUrl: 'https://originalevent.com',
          createdAt: new Date('2025-01-01T10:00:00.000Z'),
          updatedAt: new Date('2025-01-01T10:00:00.000Z'),
        };
  
        (prisma.event.findUnique as import('vitest').Mock).mockResolvedValue(mockExistingEvent);
  
        const prismaError = new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
          code: 'P2025',
          clientVersion: 'test-version',
        });
        (prisma.event.update as import('vitest').Mock).mockRejectedValue(prismaError);
  
        // Call the handler
        await updateEventHandler(req, rep);
  
        // 1. Check if event fetch was attempted
        expect(prisma.event.findUnique).toHaveBeenCalledWith({
          where: { id: mockEventId },
        });
  
        // 2. Check if event update was attempted
        expect(prisma.event.update).toHaveBeenCalledTimes(1); // It was attempted and failed
  
        // 3. Check for the 500 response
        expect(rep.code).toHaveBeenCalledWith(500);
        expect(rep.send).toHaveBeenCalledWith({
          message: 'An error occurred while updating the event.',
        });
  
        // 4. Check for the error log
        expect(req.log.error).toHaveBeenCalledWith(
          {
            error: prismaError,
            eventId: mockEventId,
            updateData: updatePayload,
            userId: mockAuthenticatedUser.id,
          },
          'Error updating event',
        );
      });
  
      it('should return 500 for unexpected errors during transformation or other logic', async () => {
        const updatePayload: UpdateEventInput = { title: 'Valid Update Title' };
  
        const req = mockRequest<{ Params: EventParams; Body: UpdateEventInput }>({
          user: mockAuthenticatedUser,
          params: { eventId: mockEventId },
          body: updatePayload,
        }) as AppFastifyRequest<{ Params: EventParams; Body: UpdateEventInput }>;
        const rep = mockReply<any>() as AppFastifyReply<any>;
  
        if (!req.log) {
          req.log = {
            error: vi.fn(),
            warn: vi.fn(),
            info: vi.fn(),
            debug: vi.fn(),
            trace: vi.fn(),
            fatal: vi.fn(),
          } as any;
        } else if (typeof req.log.error !== 'function' || !('mock' in req.log.error)) {
          vi.spyOn(req.log, 'error').mockImplementation(() => {});
        }
  
        const mockExistingEvent: PrismaEventType = {
          id: mockEventId,
          userId: mockAuthenticatedUser.id,
          title: 'Original Title',
          description: 'Original desc',
          eventDate: new Date(),
          eventTime: new Date(),
          locationDescription: 'loc',
          organizerName: 'org',
          category: 'cat',
          tags: [],
          websiteUrl: null,
          createdAt: new Date(), // Valid date initially
          updatedAt: new Date(), // Valid date initially
        };
        (prisma.event.findUnique as import('vitest').Mock).mockResolvedValue(mockExistingEvent);
  
        // Simulate prisma.event.update returning data that will cause transformEventForApi to fail
        const malformedUpdatedEventFromDb = {
          ...mockExistingEvent,
          title: updatePayload.title!,
          createdAt: null as any, // This will cause 'createdAt.toISOString()' to fail in transformEventForApi
        };
        (prisma.event.update as import('vitest').Mock).mockResolvedValue(malformedUpdatedEventFromDb);
  
        // Call the handler
        await updateEventHandler(req, rep);
  
        // 1. Check if event fetch was attempted
        expect(prisma.event.findUnique).toHaveBeenCalledWith({
          where: { id: mockEventId },
        });
  
        // 2. Check if event update was attempted and "succeeded" at Prisma level
        expect(prisma.event.update).toHaveBeenCalledTimes(1);
  
        // 3. Check for the 500 response due to transformation error
        expect(rep.code).toHaveBeenCalledWith(500);
        expect(rep.send).toHaveBeenCalledWith({
          message: 'An error occurred while updating the event.',
        });
  
        // 4. Check for the error log, expecting a TypeError from .toISOString()
        expect(req.log.error).toHaveBeenCalledWith(
          {
            error: expect.any(TypeError), // The error from .toISOString() on null
            eventId: mockEventId,
            updateData: updatePayload,
            userId: mockAuthenticatedUser.id,
          },
          'Error updating event',
        );
      });
    });
  
    describe('deleteEventHandler', () => {
      const mockAuthenticatedUser = { id: 'user-id-owner', username: 'eventOwner' };
      const mockEventId = 'event-to-delete-uuid';
      const mockNonExistentEventId = 'non-existent-event-for-delete-uuid';
  
      beforeEach(() => {
        // Reset mocks for Prisma operations
        (prisma.event.findUnique as import('vitest').Mock).mockReset();
        (prisma.event.delete as import('vitest').Mock).mockReset();
        // Reset any logger spies if they are set up per test or in a broader beforeEach
      });
  
      it('should delete an event successfully if user is the owner', async () => {
        const req = mockRequest<{ Params: EventParams }>({
          user: mockAuthenticatedUser,
          params: { eventId: mockEventId },
        }) as AppFastifyRequest<{ Params: EventParams }>;
        const rep = mockReply<any>() as AppFastifyReply<any>; // Using any for reply for simplicity
  
        // Spy on req.log.info for this specific request object
        if (!req.log) {
          req.log = {
            error: vi.fn(),
            warn: vi.fn(),
            info: vi.fn(),
            debug: vi.fn(),
            trace: vi.fn(),
            fatal: vi.fn(),
          } as any;
        } else if (typeof req.log.info !== 'function' || !('mock' in req.log.info)) {
          vi.spyOn(req.log, 'info').mockImplementation(() => {});
        }
  
        const mockExistingEvent = {
          // Prisma.EventGetPayload<...> - simplified for brevity
          id: mockEventId,
          userId: mockAuthenticatedUser.id, // Owner matches
          title: 'Event To Be Deleted',
          // ... other event fields if necessary for type compatibility, but not strictly for delete logic
        };
  
        (prisma.event.findUnique as import('vitest').Mock).mockResolvedValue(mockExistingEvent);
        (prisma.event.delete as import('vitest').Mock).mockResolvedValue({}); // delete resolves with the deleted record or {}
  
        // Call the handler
        await deleteEventHandler(req, rep);
  
        // 1. Check if event was fetched
        expect(prisma.event.findUnique).toHaveBeenCalledWith({
          where: { id: mockEventId },
        });
  
        // 2. Check if event was deleted
        expect(prisma.event.delete).toHaveBeenCalledWith({
          where: { id: mockEventId },
        });
  
        // 3. Check for the 204 No Content response
        expect(rep.code).toHaveBeenCalledWith(204);
        expect(rep.send).toHaveBeenCalledWith(null); // Or .toHaveBeenCalledTimes(1) if send() is called with no args
  
        // 4. Check for the info logs
        expect(req.log.info).toHaveBeenNthCalledWith(
          1,
          { eventId: mockEventId, userId: mockAuthenticatedUser.id },
          'User authorized and attempting to delete event.',
        );
        expect(req.log.info).toHaveBeenNthCalledWith(
          2,
          { eventId: mockEventId, userId: mockAuthenticatedUser.id },
          'Event deleted successfully by owner.',
        );
      });
  
      it('should return 403 if user is not the owner of the event', async () => {
        const nonOwnerUserId = 'user-id-non-owner';
        const req = mockRequest<{ Params: EventParams }>({
          user: { id: nonOwnerUserId, username: 'nonOwnerUser' }, // Authenticated user is NOT the owner
          params: { eventId: mockEventId },
        }) as AppFastifyRequest<{ Params: EventParams }>;
        const rep = mockReply<any>() as AppFastifyReply<any>;
  
        // Spy on req.log.warn for this specific request object
        if (!req.log) {
          req.log = {
            error: vi.fn(),
            warn: vi.fn(),
            info: vi.fn(),
            debug: vi.fn(),
            trace: vi.fn(),
            fatal: vi.fn(),
          } as any;
        } else if (typeof req.log.warn !== 'function' || !('mock' in req.log.warn)) {
          vi.spyOn(req.log, 'warn').mockImplementation(() => {});
        }
  
        const actualOwnerUserId = 'user-id-actual-owner'; // The event belongs to this user
        const mockExistingEvent = {
          id: mockEventId,
          userId: actualOwnerUserId, // Event owned by a different user
          title: 'Event Owned by Someone Else',
          // ... other fields if necessary for type compatibility
        };
  
        (prisma.event.findUnique as import('vitest').Mock).mockResolvedValue(mockExistingEvent);
  
        // Call the handler
        await deleteEventHandler(req, rep);
  
        // 1. Check if event was fetched
        expect(prisma.event.findUnique).toHaveBeenCalledWith({
          where: { id: mockEventId },
        });
  
        // 2. Check that Prisma delete was NOT called
        expect(prisma.event.delete).not.toHaveBeenCalled();
  
        // 3. Check for the 403 response
        expect(rep.code).toHaveBeenCalledWith(403);
        expect(rep.send).toHaveBeenCalledWith({
          message: 'You are not authorized to delete this event.',
        });
  
        // 4. Check for the warning log
        expect(req.log.warn).toHaveBeenCalledWith(
          {
            eventId: mockEventId,
            eventOwnerId: actualOwnerUserId,
            attemptingUserId: nonOwnerUserId,
          },
          'User authorization failed: Attempt to delete event they do not own.',
        );
      });
  
      it('should return 404 if event to delete is not found (initial check)', async () => {
        const req = mockRequest<{ Params: EventParams }>({
          user: mockAuthenticatedUser,
          params: { eventId: mockNonExistentEventId }, // Using an ID that won't be found
        }) as AppFastifyRequest<{ Params: EventParams }>;
        const rep = mockReply<any>() as AppFastifyReply<any>;
  
        // Spy on req.log.info for this specific request object
        if (!req.log) {
          req.log = {
            error: vi.fn(),
            warn: vi.fn(),
            info: vi.fn(),
            debug: vi.fn(),
            trace: vi.fn(),
            fatal: vi.fn(),
          } as any;
        } else if (typeof req.log.info !== 'function' || !('mock' in req.log.info)) {
          vi.spyOn(req.log, 'info').mockImplementation(() => {});
        }
  
        // Mock prisma.event.findUnique to return null, simulating event not found
        (prisma.event.findUnique as import('vitest').Mock).mockResolvedValue(null);
  
        // Call the handler
        await deleteEventHandler(req, rep);
  
        // 1. Check if event was attempted to be fetched
        expect(prisma.event.findUnique).toHaveBeenCalledWith({
          where: { id: mockNonExistentEventId },
        });
  
        // 2. Check that Prisma delete was NOT called
        expect(prisma.event.delete).not.toHaveBeenCalled();
  
        // 3. Check for the 404 response
        expect(rep.code).toHaveBeenCalledWith(404);
        expect(rep.send).toHaveBeenCalledWith({
          message: 'Event not found.',
        });
  
        // 4. Check for the info log
        expect(req.log.info).toHaveBeenCalledWith(
          { eventId: mockNonExistentEventId, userId: mockAuthenticatedUser.id },
          'User attempted to delete non-existent event.',
        );
      });
  
      it('should return 500 if Prisma delete fails (e.g., P2025 record to delete not found)', async () => {
        const req = mockRequest<{ Params: EventParams }>({
          user: mockAuthenticatedUser,
          params: { eventId: mockEventId },
        }) as AppFastifyRequest<{ Params: EventParams }>;
        const rep = mockReply<any>() as AppFastifyReply<any>;
  
        // Spy on req.log.error for this specific request object
        if (!req.log) {
          req.log = {
            error: vi.fn(),
            warn: vi.fn(),
            info: vi.fn(),
            debug: vi.fn(),
            trace: vi.fn(),
            fatal: vi.fn(),
          } as any;
        } else if (typeof req.log.error !== 'function' || !('mock' in req.log.error)) {
          vi.spyOn(req.log, 'error').mockImplementation(() => {});
        }
        // Also spy on req.log.info as it's called before the delete attempt
        if (typeof req.log.info !== 'function' || !('mock' in req.log.info)) {
          vi.spyOn(req.log, 'info').mockImplementation(() => {});
        }
  
        const mockExistingEvent = {
          id: mockEventId,
          userId: mockAuthenticatedUser.id, // Owner matches
          title: 'Event To Be Deleted But Fails',
        };
        (prisma.event.findUnique as import('vitest').Mock).mockResolvedValue(mockExistingEvent);
  
        const prismaError = new Prisma.PrismaClientKnownRequestError(
          'An operation failed because it depends on one or more records that were required but not found. {cause}',
          { code: 'P2025', clientVersion: 'test-version' },
        );
        (prisma.event.delete as import('vitest').Mock).mockRejectedValue(prismaError);
  
        // Call the handler
        await deleteEventHandler(req, rep);
  
        // 1. Check if event was fetched
        expect(prisma.event.findUnique).toHaveBeenCalledWith({
          where: { id: mockEventId },
        });
  
        // 2. Check if event deletion was attempted
        expect(prisma.event.delete).toHaveBeenCalledWith({
          where: { id: mockEventId },
        });
  
        // 3. Check for the 500 response
        expect(rep.code).toHaveBeenCalledWith(500);
        expect(rep.send).toHaveBeenCalledWith({
          message: 'An error occurred while deleting the event.',
        });
  
        // 4. Check for the error log
        expect(req.log.error).toHaveBeenCalledWith(
          { error: prismaError, eventId: mockEventId, userId: mockAuthenticatedUser.id },
          'Error deleting event',
        );
  
        // 5. Check that the initial info log for attempting delete was called
        expect(req.log.info).toHaveBeenCalledWith(
          { eventId: mockEventId, userId: mockAuthenticatedUser.id },
          'User authorized and attempting to delete event.',
        );
      });
  
      it('should return 500 for unexpected errors', async () => {
        const req = mockRequest<{ Params: EventParams }>({
          user: mockAuthenticatedUser,
          params: { eventId: mockEventId },
        }) as AppFastifyRequest<{ Params: EventParams }>;
        const rep = mockReply<any>() as AppFastifyReply<any>;
  
        // Spy on req.log.error and req.log.info
        if (!req.log) {
          req.log = {
            error: vi.fn(),
            warn: vi.fn(),
            info: vi.fn(),
            debug: vi.fn(),
            trace: vi.fn(),
            fatal: vi.fn(),
          } as any;
        } else {
          if (typeof req.log.error !== 'function' || !('mock' in req.log.error)) {
            vi.spyOn(req.log, 'error').mockImplementation(() => {});
          }
          if (typeof req.log.info !== 'function' || !('mock' in req.log.info)) {
            vi.spyOn(req.log, 'info').mockImplementation(() => {});
          }
        }
  
        const mockExistingEvent = {
          id: mockEventId,
          userId: mockAuthenticatedUser.id, // Owner matches
          title: 'Event Facing Unexpected Deletion Error',
        };
        (prisma.event.findUnique as import('vitest').Mock).mockResolvedValue(mockExistingEvent);
  
        const unexpectedError = new Error('A totally unexpected runtime error occurred!');
        (prisma.event.delete as import('vitest').Mock).mockRejectedValue(unexpectedError);
  
        // Call the handler
        await deleteEventHandler(req, rep);
  
        // 1. Check if event was fetched
        expect(prisma.event.findUnique).toHaveBeenCalledWith({
          where: { id: mockEventId },
        });
  
        // 2. Check if event deletion was attempted
        expect(prisma.event.delete).toHaveBeenCalledWith({
          where: { id: mockEventId },
        });
  
        // 3. Check for the 500 response
        expect(rep.code).toHaveBeenCalledWith(500);
        expect(rep.send).toHaveBeenCalledWith({
          message: 'An error occurred while deleting the event.',
        });
  
        // 4. Check for the error log
        expect(req.log.error).toHaveBeenCalledWith(
          { error: unexpectedError, eventId: mockEventId, userId: mockAuthenticatedUser.id },
          'Error deleting event',
        );
  
        // 5. Check that the initial info log for attempting delete was called
        expect(req.log.info).toHaveBeenCalledWith(
          { eventId: mockEventId, userId: mockAuthenticatedUser.id },
          'User authorized and attempting to delete event.',
        );
      });
    });

  // Focus on saveEventHandler
  describe('saveEventHandler', () => {
    const mockAuthenticatedUser = { id: 'user-save-event-id', username: 'eventSaver' }; // Add other fields if your AuthenticatedUser type has them and they are used
    const mockEventIdToSave = 'event-to-be-saved-uuid';
    const mockNonExistentEventId = 'non-existent-event-to-save-uuid';
    const MAX_SAVED_EVENTS_LIMIT = 500;

    it('should save an event for an authenticated user successfully', async () => {
      const req = mockRequest<{ Params: EventParams }>({
        user: mockAuthenticatedUser,
        params: { eventId: mockEventIdToSave },
      }) as AppFastifyRequest<{ Params: EventParams }>; // Cast to full type
      const rep = mockReply<{ Params: EventParams }>() as AppFastifyReply<{ Params: EventParams }>; // Cast to full type

      const mockUserSavedEvent = { userId: mockAuthenticatedUser.id, eventId: mockEventIdToSave, savedAt: new Date() };

      (prisma.userSavedEvent.count as MockInstance).mockResolvedValue(0);
      (prisma.event.count as MockInstance).mockResolvedValue(1);
      (prisma.userSavedEvent.findUnique as MockInstance).mockResolvedValue(null);
      (prisma.userSavedEvent.create as MockInstance).mockResolvedValue(mockUserSavedEvent);

      await saveEventHandler(req, rep);

      expect(prisma.userSavedEvent.count).toHaveBeenCalledTimes(1);
      expect(prisma.event.count).toHaveBeenCalledWith({ where: { id: mockEventIdToSave } });
      expect(prisma.userSavedEvent.findUnique).toHaveBeenCalledWith({ where: { userId_eventId: { userId: mockAuthenticatedUser.id, eventId: mockEventIdToSave } } });
      expect(prisma.userSavedEvent.create).toHaveBeenCalledWith({ data: { userId: mockAuthenticatedUser.id, eventId: mockEventIdToSave } });
      expect(rep.code).toHaveBeenCalledWith(201);
      expect(rep.send).toHaveBeenCalledWith({ message: 'Event saved successfully.' });
      expect(req.log.info).toHaveBeenCalledWith(
        expect.objectContaining({ userId: mockAuthenticatedUser.id, eventId: mockEventIdToSave }),
        'Event saved successfully by user.',
      );
    });

    it('should return 404 if event to save is not found (event.count is 0)', async () => {
      const req = mockRequest<{ Params: EventParams }>({
        user: mockAuthenticatedUser,
        params: { eventId: mockNonExistentEventId },
      }) as AppFastifyRequest<{ Params: EventParams }>;
      const rep = mockReply<{ Params: EventParams }>() as AppFastifyReply<{ Params: EventParams }>;

      (prisma.userSavedEvent.count as MockInstance).mockResolvedValue(0);
      (prisma.event.count as MockInstance).mockResolvedValue(0);

      await saveEventHandler(req, rep);

      expect(prisma.userSavedEvent.count).toHaveBeenCalledTimes(1);
      expect(prisma.event.count).toHaveBeenCalledWith({ where: { id: mockNonExistentEventId } });
      expect(rep.code).toHaveBeenCalledWith(404);
      expect(rep.send).toHaveBeenCalledWith({ message: 'Event not found.' });
      expect(prisma.userSavedEvent.findUnique).not.toHaveBeenCalled();
      expect(prisma.userSavedEvent.create).not.toHaveBeenCalled();
      expect(req.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: mockAuthenticatedUser.id, eventId: mockNonExistentEventId }),
        'Attempt to save non-existent event.',
      );
    });

    it('should return 200 if event is already saved by the user', async () => {
      const req = mockRequest<{ Params: EventParams }>({
        user: mockAuthenticatedUser,
        params: { eventId: mockEventIdToSave },
      }) as AppFastifyRequest<{ Params: EventParams }>;
      const rep = mockReply<{ Params: EventParams }>() as AppFastifyReply<{ Params: EventParams }>;

      (prisma.userSavedEvent.count as MockInstance).mockResolvedValue(0);
      (prisma.event.count as MockInstance).mockResolvedValue(1);
      (prisma.userSavedEvent.findUnique as MockInstance).mockResolvedValue({ userId: mockAuthenticatedUser.id, eventId: mockEventIdToSave, savedAt: new Date() });

      await saveEventHandler(req, rep);

      expect(prisma.userSavedEvent.count).toHaveBeenCalledTimes(1);
      expect(prisma.event.count).toHaveBeenCalledWith({ where: { id: mockEventIdToSave } });
      expect(prisma.userSavedEvent.findUnique).toHaveBeenCalledWith({ where: { userId_eventId: { userId: mockAuthenticatedUser.id, eventId: mockEventIdToSave } } });
      expect(rep.code).toHaveBeenCalledWith(200);
      expect(rep.send).toHaveBeenCalledWith({ message: 'Event already saved.' });
      expect(prisma.userSavedEvent.create).not.toHaveBeenCalled();
      expect(req.log.info).toHaveBeenCalledWith(
        expect.objectContaining({ userId: mockAuthenticatedUser.id, eventId: mockEventIdToSave }),
        'Event already saved by user.',
      );
    });

    it('should return 503 if event saving limit is reached', async () => {
      const req = mockRequest<{ Params: EventParams }>({
        user: mockAuthenticatedUser,
        params: { eventId: mockEventIdToSave },
      }) as AppFastifyRequest<{ Params: EventParams }>;
      const rep = mockReply<{ Params: EventParams }>() as AppFastifyReply<{ Params: EventParams }>;

      (prisma.userSavedEvent.count as MockInstance).mockResolvedValue(MAX_SAVED_EVENTS_LIMIT);

      await saveEventHandler(req, rep);

      expect(prisma.userSavedEvent.count).toHaveBeenCalledTimes(1);
      expect(rep.code).toHaveBeenCalledWith(503);
      expect(rep.send).toHaveBeenCalledWith({ message: 'Event saving limit reached. Please try again later.' });
      expect(prisma.event.count).not.toHaveBeenCalled();
      expect(prisma.userSavedEvent.findUnique).not.toHaveBeenCalled();
      expect(prisma.userSavedEvent.create).not.toHaveBeenCalled();
      // This assertion was passing before, so the log call itself works with direct object comparison
      expect(req.log.warn).toHaveBeenCalledWith(
        { currentCount: MAX_SAVED_EVENTS_LIMIT, limit: MAX_SAVED_EVENTS_LIMIT }, // Direct object
        'Event saving limit reached.',
      );
    });

    it('should return 500 if Prisma event.count operation itself fails', async () => {
      const req = mockRequest<{ Params: EventParams }>({
        user: mockAuthenticatedUser,
        params: { eventId: mockEventIdToSave },
      }) as AppFastifyRequest<{ Params: EventParams }>;
      const rep = mockReply<{ Params: EventParams }>() as AppFastifyReply<{ Params: EventParams }>;
      const prismaError = new Error('DB error on event.count');

      (prisma.userSavedEvent.count as MockInstance).mockResolvedValue(0);
      (prisma.event.count as MockInstance).mockRejectedValue(prismaError);

      await saveEventHandler(req, rep);

      expect(prisma.userSavedEvent.count).toHaveBeenCalledTimes(1);
      expect(prisma.event.count).toHaveBeenCalledWith({ where: { id: mockEventIdToSave } });
      expect(rep.code).toHaveBeenCalledWith(500);
      expect(rep.send).toHaveBeenCalledWith({ message: 'An error occurred while saving the event.' });
      expect(req.log.error).toHaveBeenCalledWith( // This uses direct object, should be fine
        { error: prismaError, userId: mockAuthenticatedUser.id, eventId: mockEventIdToSave },
        'Error saving event',
      );
    });

    it('should return 500 if Prisma fails to create UserSavedEvent relation (other than P2003 or P2002 handled by prior checks)', async () => {
      const req = mockRequest<{ Params: EventParams }>({
        user: mockAuthenticatedUser,
        params: { eventId: mockEventIdToSave },
      }) as AppFastifyRequest<{ Params: EventParams }>;
      const rep = mockReply<{ Params: EventParams }>() as AppFastifyReply<{ Params: EventParams }>;
      const prismaCreateError = new Error('DB error on userSavedEvent.create');

      (prisma.userSavedEvent.count as MockInstance).mockResolvedValue(0);
      (prisma.event.count as MockInstance).mockResolvedValue(1);
      (prisma.userSavedEvent.findUnique as MockInstance).mockResolvedValue(null);
      (prisma.userSavedEvent.create as MockInstance).mockRejectedValue(prismaCreateError);

      await saveEventHandler(req, rep);

      expect(prisma.userSavedEvent.count).toHaveBeenCalledTimes(1);
      expect(prisma.event.count).toHaveBeenCalledWith({ where: { id: mockEventIdToSave } });
      expect(prisma.userSavedEvent.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.userSavedEvent.create).toHaveBeenCalledTimes(1);
      expect(rep.code).toHaveBeenCalledWith(500);
      expect(rep.send).toHaveBeenCalledWith({ message: 'An error occurred while saving the event.' });
      expect(req.log.error).toHaveBeenCalledWith( // This uses direct object
        { error: prismaCreateError, userId: mockAuthenticatedUser.id, eventId: mockEventIdToSave },
        'Error saving event',
      );
    });

    it('should return 404 if creating UserSavedEvent fails with P2003 (foreign key constraint)', async () => {
      const req = mockRequest<{ Params: EventParams }>({
        user: mockAuthenticatedUser,
        params: { eventId: mockEventIdToSave },
      }) as AppFastifyRequest<{ Params: EventParams }>;
      const rep = mockReply<{ Params: EventParams }>() as AppFastifyReply<{ Params: EventParams }>;

      const prismaP2003Error = new ActualPrisma.PrismaClientKnownRequestError('Foreign key constraint failed', { code: 'P2003', clientVersion: 'mock' });

      (prisma.userSavedEvent.count as MockInstance).mockResolvedValue(0);
      (prisma.event.count as MockInstance).mockResolvedValue(1);
      (prisma.userSavedEvent.findUnique as MockInstance).mockResolvedValue(null);
      (prisma.userSavedEvent.create as MockInstance).mockRejectedValue(prismaP2003Error);

      await saveEventHandler(req, rep);

      expect(prisma.userSavedEvent.count).toHaveBeenCalledTimes(1);
      expect(prisma.event.count).toHaveBeenCalledWith({ where: { id: mockEventIdToSave } });
      expect(prisma.userSavedEvent.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.userSavedEvent.create).toHaveBeenCalledTimes(1);
      expect(rep.code).toHaveBeenCalledWith(404);
      expect(rep.send).toHaveBeenCalledWith({ message: 'Event not found or user invalid.' });
      expect(req.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: prismaP2003Error, userId: mockAuthenticatedUser.id, eventId: mockEventIdToSave }),
        'Foreign key constraint violation while saving event (P2003).',
      );
    });

    it('should return 500 for unexpected errors', async () => {
      const req = mockRequest<{ Params: EventParams }>({
        user: mockAuthenticatedUser,
        params: { eventId: mockEventIdToSave },
      }) as AppFastifyRequest<{ Params: EventParams }>;
      const rep = mockReply<{ Params: EventParams }>() as AppFastifyReply<{ Params: EventParams }>;
      const unexpectedError = new Error('Something totally unexpected happened!');

      (prisma.userSavedEvent.count as MockInstance).mockRejectedValue(unexpectedError);

      await saveEventHandler(req, rep);

      // ... (other assertions)
      expect(rep.code).toHaveBeenCalledWith(500);
      expect(rep.send).toHaveBeenCalledWith({ message: 'An error occurred while saving the event.' });
      expect(req.log.error).toHaveBeenCalledWith( // This uses direct object
        { error: unexpectedError, userId: mockAuthenticatedUser.id, eventId: mockEventIdToSave },
        'Error saving event',
      );
    });
  });


  describe('unsaveEventHandler', () => {
        const mockAuthenticatedUser = { id: 'user-unsave-event-id', username: 'eventUnsaver' };
        const mockEventIdToUnsave = 'event-to-be-unsaved-uuid';
    
        beforeEach(() => {
          // Reset mocks for Prisma operations relevant to unsaveEventHandler
          (prisma.userSavedEvent.delete as import('vitest').Mock).mockReset();
          // Reset any logger spies if they are set up per test or in a broader beforeEach
        });
    
        it('should unsave an event for an authenticated user successfully', async () => {
          const req = mockRequest<{ Params: EventParams }>({
            user: mockAuthenticatedUser,
            params: { eventId: mockEventIdToUnsave },
          }) as AppFastifyRequest<{ Params: EventParams }>;
          const rep = mockReply<any>() as AppFastifyReply<any>;
    
          // Spy on req.log.error (to ensure it's not called)
          // Spy on req.log.info (if any info logs were expected for the success path, though unsaveEventHandler only logs for P2025 or errors)
          if (!req.log) {
            req.log = {
              error: vi.fn(),
              warn: vi.fn(),
              info: vi.fn(),
              debug: vi.fn(),
              trace: vi.fn(),
              fatal: vi.fn(),
            } as any;
          } else {
            if (typeof req.log.error !== 'function' || !('mock' in req.log.error)) {
              vi.spyOn(req.log, 'error').mockImplementation(() => {});
            }
            if (typeof req.log.info !== 'function' || !('mock' in req.log.info)) {
              vi.spyOn(req.log, 'info').mockImplementation(() => {});
            }
          }
    
          // 1. Mock userSavedEvent.delete to simulate successful deletion
          //    The actual deleted object isn't used by the handler, so an empty object or mock is fine.
          (prisma.userSavedEvent.delete as import('vitest').Mock).mockResolvedValue({
            userId: mockAuthenticatedUser.id,
            eventId: mockEventIdToUnsave,
            savedAt: new Date(), // Or any valid UserSavedEvent structure
          });
    
          // Call the handler
          await unsaveEventHandler(req, rep);
    
          // Assertions:
          // Check that prisma.userSavedEvent.delete was called correctly
          expect(prisma.userSavedEvent.delete).toHaveBeenCalledWith({
            where: {
              userId_eventId: { userId: mockAuthenticatedUser.id, eventId: mockEventIdToUnsave },
            },
          });
    
          // Check for the 204 No Content response
          expect(rep.code).toHaveBeenCalledWith(204);
          expect(rep.send).toHaveBeenCalledWith(); // Or .toHaveBeenCalledTimes(1) if send() is called with no args
    
          // Ensure no error was logged, and no info log for P2025 was made
          expect(req.log.error).not.toHaveBeenCalled();
          expect(req.log.info).not.toHaveBeenCalled(); // As the P2025 path is not taken
        });
    
        it('should return 204 if the UserSavedEvent relation does not exist (Prisma P2025)', async () => {
          const req = mockRequest<{ Params: EventParams }>({
            user: mockAuthenticatedUser,
            params: { eventId: mockEventIdToUnsave },
          }) as AppFastifyRequest<{ Params: EventParams }>;
          const rep = mockReply<any>() as AppFastifyReply<any>;
    
          // Spy on req.log.info and req.log.error
          if (!req.log) {
            req.log = {
              error: vi.fn(),
              warn: vi.fn(),
              info: vi.fn(),
              debug: vi.fn(),
              trace: vi.fn(),
              fatal: vi.fn(),
            } as any;
          } else {
            if (typeof req.log.info !== 'function' || !('mock' in req.log.info)) {
              vi.spyOn(req.log, 'info').mockImplementation(() => {});
            }
            if (typeof req.log.error !== 'function' || !('mock' in req.log.error)) {
              vi.spyOn(req.log, 'error').mockImplementation(() => {});
            }
          }
    
          // 1. Mock userSavedEvent.delete to reject with a P2025 error
          const p2025Error = new Prisma.PrismaClientKnownRequestError(
            'An operation failed because it depends on one or more records that were required but not found. {cause}', // Example message
            { code: 'P2025', clientVersion: 'test-version' },
          );
          (prisma.userSavedEvent.delete as import('vitest').Mock).mockRejectedValue(p2025Error);
    
          // Call the handler
          await unsaveEventHandler(req, rep);
    
          // Assertions:
          // Check that prisma.userSavedEvent.delete was called correctly
          expect(prisma.userSavedEvent.delete).toHaveBeenCalledWith({
            where: {
              userId_eventId: { userId: mockAuthenticatedUser.id, eventId: mockEventIdToUnsave },
            },
          });
    
          // Check for the 204 No Content response (idempotent behavior)
          expect(rep.code).toHaveBeenCalledWith(204);
          expect(rep.send).toHaveBeenCalledWith();
    
          // Check that the specific info log for P2025 was made
          expect(req.log.info).toHaveBeenCalledWith(
            { eventId: mockEventIdToUnsave, userId: mockAuthenticatedUser.id },
            'User attempted to unsave an event that was not saved or already unsaved.',
          );
    
          // Ensure no error was logged to req.log.error
          expect(req.log.error).not.toHaveBeenCalled();
        });
    
        it('should return 500 if Prisma fails to delete UserSavedEvent relation (for reasons other than P2025)', async () => {
          const req = mockRequest<{ Params: EventParams }>({
            user: mockAuthenticatedUser,
            params: { eventId: mockEventIdToUnsave },
          }) as AppFastifyRequest<{ Params: EventParams }>;
          const rep = mockReply<any>() as AppFastifyReply<any>;
    
          // Spy on req.log.error
          if (!req.log) {
            req.log = {
              error: vi.fn(),
              warn: vi.fn(),
              info: vi.fn(),
              debug: vi.fn(),
              trace: vi.fn(),
              fatal: vi.fn(),
            } as any;
          } else if (typeof req.log.error !== 'function' || !('mock' in req.log.error)) {
            vi.spyOn(req.log, 'error').mockImplementation(() => {});
          }
    
          // 1. Mock userSavedEvent.delete to reject with a generic Prisma error (not P2025)
          //    Could also be a generic new Error('DB connection issue')
          const otherPrismaError = new Prisma.PrismaClientKnownRequestError(
            'Some other database error occurred during delete.',
            { code: 'P2000', clientVersion: 'test-version' }, // P2000: Value too long for column
          );
          (prisma.userSavedEvent.delete as import('vitest').Mock).mockRejectedValue(otherPrismaError);
    
          // Call the handler
          await unsaveEventHandler(req, rep);
    
          // Assertions:
          // Check that prisma.userSavedEvent.delete was called correctly
          expect(prisma.userSavedEvent.delete).toHaveBeenCalledWith({
            where: {
              userId_eventId: { userId: mockAuthenticatedUser.id, eventId: mockEventIdToUnsave },
            },
          });
    
          // Check for the 500 Internal Server Error response
          expect(rep.code).toHaveBeenCalledWith(500);
          expect(rep.send).toHaveBeenCalledWith({
            message: 'An error occurred while unsaving the event.',
          });
    
          // Check that the error was logged
          expect(req.log.error).toHaveBeenCalledWith(
            { error: otherPrismaError, eventId: mockEventIdToUnsave, userId: mockAuthenticatedUser.id },
            'Error unsaving event',
          );
        });
    
        it('should return 500 for unexpected errors', async () => {
          const req = mockRequest<{ Params: EventParams }>({
            user: mockAuthenticatedUser,
            params: { eventId: mockEventIdToUnsave },
          }) as AppFastifyRequest<{ Params: EventParams }>;
          const rep = mockReply<any>() as AppFastifyReply<any>;
    
          // Spy on req.log.error
          if (!req.log) {
            req.log = {
              error: vi.fn(),
              warn: vi.fn(),
              info: vi.fn(),
              debug: vi.fn(),
              trace: vi.fn(),
              fatal: vi.fn(),
            } as any;
          } else if (typeof req.log.error !== 'function' || !('mock' in req.log.error)) {
            vi.spyOn(req.log, 'error').mockImplementation(() => {});
          }
    
          // 1. Mock userSavedEvent.delete to reject with a generic, unexpected error
          const unexpectedError = new Error('A completely unexpected runtime error occurred!');
          (prisma.userSavedEvent.delete as import('vitest').Mock).mockRejectedValue(unexpectedError);
    
          // Call the handler
          await unsaveEventHandler(req, rep);
    
          // Assertions:
          // Check that prisma.userSavedEvent.delete was called correctly
          expect(prisma.userSavedEvent.delete).toHaveBeenCalledWith({
            where: {
              userId_eventId: { userId: mockAuthenticatedUser.id, eventId: mockEventIdToUnsave },
            },
          });
    
          // Check for the 500 Internal Server Error response
          expect(rep.code).toHaveBeenCalledWith(500);
          expect(rep.send).toHaveBeenCalledWith({
            message: 'An error occurred while unsaving the event.',
          });
    
          // Check that the error was logged
          expect(req.log.error).toHaveBeenCalledWith(
            { error: unexpectedError, eventId: mockEventIdToUnsave, userId: mockAuthenticatedUser.id },
            'Error unsaving event',
          );
        });
      });
    
      describe('getRandomEventHandler', () => {
        const mockPrismaEvent: PrismaEventType = {
          id: 'random-event-uuid-1',
          userId: 'user-for-random-event-1',
          title: 'A Truly Random Event',
          description: 'This is a randomly selected event for testing.',
          eventDate: new Date('2025-08-15T00:00:00.000Z'),
          eventTime: new Date('1970-01-01T15:30:00.000Z'),
          locationDescription: 'The Random Place',
          organizerName: 'Random Corp',
          category: 'Random & Fun',
          tags: ['random', 'test', 'event'],
          websiteUrl: 'https://randomtest.example.com',
          createdAt: new Date('2025-02-10T10:00:00.000Z'),
          updatedAt: new Date('2025-02-11T11:00:00.000Z'),
        };
    
        let mathRandomSpy: MockInstance<() => number>;
    
        beforeEach(() => {
          (prisma.event.count as import('vitest').Mock).mockReset();
          (prisma.event.findMany as import('vitest').Mock).mockReset();
          (prisma.event.findFirst as import('vitest').Mock).mockReset();
          mathRandomSpy = vi.spyOn(Math, 'random');
        });
    
        afterEach(() => {
          mathRandomSpy.mockRestore();
        });
    
        it('should return a random event if events exist (authenticated user)', async () => {
          const req = mockRequest({}) as AppFastifyRequest;
    
          // Aligning with the pattern from unsaveEventHandler for the reply object
          // This is less type-safe for rep.send() but resolves the declaration error
          // given the current AppFastifyReply definition.
          const rep = mockReply<any>() as AppFastifyReply<any>;
    
          if (!rep.log) {
            rep.log = {
              error: vi.fn(),
              warn: vi.fn(),
              info: vi.fn(),
              debug: vi.fn(),
              trace: vi.fn(),
              fatal: vi.fn(),
            } as any;
          } else {
            if (typeof rep.log.error !== 'function' || !('mock' in rep.log.error)) {
              rep.log.error = vi.fn();
            }
          }
    
          const totalEvents = 15;
          (prisma.event.count as import('vitest').Mock).mockResolvedValue(totalEvents);
    
          const mockRandomValue = 0.3;
          mathRandomSpy.mockReturnValue(mockRandomValue);
          const expectedSkip = Math.floor(mockRandomValue * totalEvents);
    
          (prisma.event.findMany as import('vitest').Mock).mockResolvedValue([mockPrismaEvent]);
    
          await getRandomEventHandler(req, rep);
    
          expect(prisma.event.count).toHaveBeenCalledTimes(1);
          expect(prisma.event.findMany).toHaveBeenCalledWith({
            skip: expectedSkip,
            take: 1,
            select: commonEventSelect,
          });
          expect(prisma.event.findFirst).not.toHaveBeenCalled();
    
          expect(rep.code).toHaveBeenCalledWith(200);
          // Note: With rep typed as AppFastifyReply<any>, the type checking on the argument
          // to rep.send() will be less strict.
          expect(rep.send).toHaveBeenCalledWith(transformEventForApi(mockPrismaEvent));
          expect(rep.log.error).not.toHaveBeenCalled();
        });
    
        it('should return a random event if events exist (unauthenticated user)', async () => {
          // For an unauthenticated user, request.user would be undefined or not present.
          // mockRequest({}) simulates this well as getRandomEventHandler doesn't use request.user.
          const req = mockRequest({}) as AppFastifyRequest;
          const rep = mockReply<any>() as AppFastifyReply<any>; // Using <any> for consistency
    
          if (!rep.log) {
            rep.log = {
              error: vi.fn(),
              warn: vi.fn(),
              info: vi.fn(),
              debug: vi.fn(),
              trace: vi.fn(),
              fatal: vi.fn(),
            } as any;
          } else {
            if (typeof rep.log.error !== 'function' || !('mock' in rep.log.error)) {
              rep.log.error = vi.fn();
            }
          }
    
          const totalEvents = 10; // Can use a different number to ensure test independence
          (prisma.event.count as import('vitest').Mock).mockResolvedValue(totalEvents);
    
          const mockRandomValue = 0.5;
          mathRandomSpy.mockReturnValue(mockRandomValue);
          const expectedSkip = Math.floor(mockRandomValue * totalEvents);
    
          (prisma.event.findMany as import('vitest').Mock).mockResolvedValue([mockPrismaEvent]); // Assuming mockPrismaEvent is suitable
    
          await getRandomEventHandler(req, rep);
    
          expect(prisma.event.count).toHaveBeenCalledTimes(1);
          expect(prisma.event.findMany).toHaveBeenCalledWith({
            skip: expectedSkip,
            take: 1,
            select: commonEventSelect,
          });
          expect(prisma.event.findFirst).not.toHaveBeenCalled(); // Fallback not expected here
    
          expect(rep.code).toHaveBeenCalledWith(200);
          expect(rep.send).toHaveBeenCalledWith(transformEventForApi(mockPrismaEvent));
          expect(rep.log.error).not.toHaveBeenCalled();
        });
    
        it('should return 404 if no events exist in the database', async () => {
          const req = mockRequest({}) as AppFastifyRequest;
          const rep = mockReply<any>() as AppFastifyReply<any>;
    
          if (!rep.log) {
            rep.log = {
              error: vi.fn(),
              warn: vi.fn(),
              info: vi.fn(),
              debug: vi.fn(),
              trace: vi.fn(),
              fatal: vi.fn(),
            } as any;
          } else {
            if (typeof rep.log.error !== 'function' || !('mock' in rep.log.error)) {
              rep.log.error = vi.fn();
            }
          }
    
          (prisma.event.count as MockInstance).mockResolvedValue(0); // No events
    
          await getRandomEventHandler(req, rep);
    
          expect(prisma.event.count).toHaveBeenCalledTimes(1);
          expect(prisma.event.findMany).not.toHaveBeenCalled(); // Should not attempt to find a random one
          expect(prisma.event.findFirst).not.toHaveBeenCalled(); // Fallback also not expected if count is 0
    
          expect(rep.code).toHaveBeenCalledWith(404);
          expect(rep.send).toHaveBeenCalledWith({ message: 'No events found.' });
          expect(rep.log.error).not.toHaveBeenCalled(); // Removed @ts-ignore
        });
    
        it('should return 500 if Prisma query for count fails', async () => {
          const req = mockRequest({}) as AppFastifyRequest;
          const rep = mockReply<any>() as AppFastifyReply<any>;
    
          // Ensure rep.log exists and rep.log.error is a mock for this test
          if (!rep.log) {
            rep.log = {} as any; // Initialize log object if it doesn't exist
          }
          // Directly assign a new mock function for this test.
          // This makes .mockClear() on it redundant if it's always new,
          // but ensures it's a MockInstance.
          rep.log.error = vi.fn();
    
          const countError = new Error('Simulated DB count error');
          (prisma.event.count as MockInstance).mockRejectedValue(countError);
    
          await getRandomEventHandler(req, rep);
    
          expect(prisma.event.count).toHaveBeenCalledTimes(1);
          expect(prisma.event.findMany).not.toHaveBeenCalled();
          expect(prisma.event.findFirst).not.toHaveBeenCalled();
          expect(mathRandomSpy).not.toHaveBeenCalled();
    
          expect(rep.code).toHaveBeenCalledWith(500);
          expect(rep.send).toHaveBeenCalledWith({
            message: 'An error occurred while fetching a random event.',
          });
          expect(rep.log.error).toHaveBeenCalledWith(
            { error: countError },
            'Error fetching random event',
          );
        });
    
        it('should return 500 if Prisma query for random event fails', async () => {
          const req = mockRequest({}) as AppFastifyRequest;
          const rep = mockReply<any>() as AppFastifyReply<any>;
    
          // Ensure rep.log exists and rep.log.error is a mock
          if (!rep.log) {
            rep.log = {} as any;
          }
          rep.log.error = vi.fn();
    
          const totalEvents = 5; // Assume some events exist
          (prisma.event.count as MockInstance).mockResolvedValue(totalEvents);
    
          const mockRandomValue = 0.4; // Example: 0.4 * 5 = 2 (skip index)
          mathRandomSpy.mockReturnValue(mockRandomValue);
          const expectedSkip = Math.floor(mockRandomValue * totalEvents);
    
          const findManyError = new Error('Simulated DB findMany error');
          (prisma.event.findMany as MockInstance).mockRejectedValue(findManyError);
    
          await getRandomEventHandler(req, rep);
    
          expect(prisma.event.count).toHaveBeenCalledTimes(1);
          expect(mathRandomSpy).toHaveBeenCalledTimes(1);
          expect(prisma.event.findMany).toHaveBeenCalledWith({
            skip: expectedSkip,
            take: 1,
            select: commonEventSelect,
          });
          // The fallback findFirst should not be called if findMany itself errors
          expect(prisma.event.findFirst).not.toHaveBeenCalled();
    
          expect(rep.code).toHaveBeenCalledWith(500);
          expect(rep.send).toHaveBeenCalledWith({
            message: 'An error occurred while fetching a random event.',
          });
          // Based on your controller: reply.log.error({ error }, 'Error fetching random event');
          expect(rep.log.error).toHaveBeenCalledWith(
            { error: findManyError },
            'Error fetching random event',
          );
        });
    
        it('should return an event using fallback if initial random pick fails but events exist', async () => {
          const req = mockRequest({}) as AppFastifyRequest;
          const rep = mockReply<any>() as AppFastifyReply<any>;
    
          // Consistent log setup from your other getRandomEventHandler tests
          if (!rep.log) {
            rep.log = {
              error: vi.fn(),
              warn: vi.fn(),
              info: vi.fn(),
              debug: vi.fn(),
              trace: vi.fn(),
              fatal: vi.fn(),
            } as any;
          } else {
            if (typeof rep.log.error !== 'function' || !('mock' in rep.log.error)) {
              rep.log.error = vi.fn(); // Ensure rep.log.error is a mock
            }
          }
    
          const totalEvents = 5; // Example: there are events in the DB
          const mockRandomValue = 0.9; // Example: this value leads to a skip that might find nothing
          const expectedSkip = Math.floor(mockRandomValue * totalEvents);
    
          // Setup Prisma mocks for this specific scenario:
          // 1. Event count indicates events exist
          (prisma.event.count as import('vitest').Mock).mockResolvedValue(totalEvents);
          // 2. Math.random returns our controlled value
          mathRandomSpy.mockReturnValue(mockRandomValue);
          // 3. Initial prisma.event.findMany returns an empty array (simulating the random pick failing)
          (prisma.event.findMany as import('vitest').Mock).mockResolvedValue([]);
          // 4. Fallback prisma.event.findFirst returns an event (using the existing mockPrismaEvent for simplicity)
          (prisma.event.findFirst as import('vitest').Mock).mockResolvedValue(mockPrismaEvent);
    
          await getRandomEventHandler(req, rep);
    
          // Assertions:
          expect(prisma.event.count).toHaveBeenCalledTimes(1);
          expect(mathRandomSpy).toHaveBeenCalledTimes(1);
          expect(prisma.event.findMany).toHaveBeenCalledWith({
            skip: expectedSkip,
            take: 1,
            select: commonEventSelect,
          });
          // Crucially, assert that the fallback was called
          expect(prisma.event.findFirst).toHaveBeenCalledTimes(1);
          expect(prisma.event.findFirst).toHaveBeenCalledWith({
            select: commonEventSelect,
          });
    
          expect(rep.code).toHaveBeenCalledWith(200);
          // transformEventForApi is mocked at the file level, so it will be called.
          // We expect it to be called with the event returned by the fallback.
          expect(rep.send).toHaveBeenCalledWith(transformEventForApi(mockPrismaEvent));
          expect(rep.log.error).not.toHaveBeenCalled();
        });
    
        it('should return 404 using fallback if initial random pick fails and no events exist (after count suggested otherwise)', async () => {
          const req = mockRequest({}) as AppFastifyRequest;
          const rep = mockReply<any>() as AppFastifyReply<any>;
    
          // Consistent log setup
          if (!rep.log) {
            rep.log = {
              error: vi.fn(),
              warn: vi.fn(),
              info: vi.fn(),
              debug: vi.fn(),
              trace: vi.fn(),
              fatal: vi.fn(),
            } as any;
          } else {
            if (typeof rep.log.error !== 'function' || !('mock' in rep.log.error)) {
              rep.log.error = vi.fn();
            }
          }
    
          const totalEventsInitiallyCounted = 3; // Simulate count finding events
          const mockRandomValue = 0.5; // Example value
          const expectedSkip = Math.floor(mockRandomValue * totalEventsInitiallyCounted);
    
          // Setup Prisma mocks for this specific scenario:
          // 1. Event count initially suggests events exist
          (prisma.event.count as import('vitest').Mock).mockResolvedValue(totalEventsInitiallyCounted);
          // 2. Math.random returns our controlled value
          mathRandomSpy.mockReturnValue(mockRandomValue);
          // 3. Initial prisma.event.findMany returns an empty array (simulating the random pick failing)
          (prisma.event.findMany as import('vitest').Mock).mockResolvedValue([]);
          // 4. Fallback prisma.event.findFirst also returns null (no event found by fallback)
          (prisma.event.findFirst as import('vitest').Mock).mockResolvedValue(null);
    
          await getRandomEventHandler(req, rep);
    
          // Assertions:
          expect(prisma.event.count).toHaveBeenCalledTimes(1);
          expect(mathRandomSpy).toHaveBeenCalledTimes(1);
          expect(prisma.event.findMany).toHaveBeenCalledWith({
            skip: expectedSkip,
            take: 1,
            select: commonEventSelect,
          });
          // Crucially, assert that the fallback was called
          expect(prisma.event.findFirst).toHaveBeenCalledTimes(1);
          expect(prisma.event.findFirst).toHaveBeenCalledWith({
            select: commonEventSelect,
          });
    
          // Assert the 404 response from the fallback path
          expect(rep.code).toHaveBeenCalledWith(404);
          expect(rep.send).toHaveBeenCalledWith({ message: 'No events found (fallback).' });
          expect(rep.log.error).not.toHaveBeenCalled();
        });
      });
});
