import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getEventCategoriesHandler,
  getEventTagsHandler,
  batchGetEventsHandler,
  // Import other controller handlers as you add tests for them
} from './event.controllers'; // Adjust path if your test file is elsewhere
import prisma from '../../lib/prisma'; // Import the actual prisma instance
import { AppFastifyRequest, AppFastifyReply, BatchGetEventsBody } from '../../types'; // Added BatchGetEventsBody
import { RouteGenericInterface } from 'fastify'; // Import for default generic

// Mock the prisma client
vi.mock('../../lib/prisma', () => {
  return {
    default: {
      event: {
        findMany: vi.fn(),
        // Add other prisma model methods you'll need to mock
      },
      // Mock other models if necessary
    },
  };
});

// Helper to create mock Fastify request and reply objects
const mockRequest = <T extends RouteGenericInterface = RouteGenericInterface>(
  data: Record<string, any> = {}
): Partial<AppFastifyRequest<T>> => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => mockRequest(data).log as any), // Basic child mock
    level: 'info', // Default level
    silent: vi.fn(),
  },
  ...data,
});

const mockReply = <T extends RouteGenericInterface = RouteGenericInterface>(): Partial<AppFastifyReply<T>> => {
  const reply: Partial<AppFastifyReply<T>> = {};
  reply.code = vi.fn().mockReturnValue(reply as AppFastifyReply<T>);
  reply.send = vi.fn().mockReturnValue(reply as AppFastifyReply<T>);
  reply.log = { // Add log on reply if your controllers use reply.log
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => mockReply<T>().log as any), // Basic child mock
    level: 'info', // Default level
    silent: vi.fn(),
  };
  return reply;
};


describe('Event Controllers Unit Tests', () => {

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
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
      expect(rep.send).toHaveBeenCalledWith({ message: 'An error occurred while fetching event categories.' });
    });
  });

  describe('getEventTagsHandler', () => {
    it('should return unique, trimmed, sorted, non-empty tags (case-insensitive uniqueness)', async () => {
      const req = mockRequest() as AppFastifyRequest;
      const rep = mockReply() as AppFastifyReply;
      const mockEventsWithTags = [
        { tags: ['  Tech ', 'API', '  '] }, // Includes whitespace and empty string after trim
        { tags: ['api', 'NodeJS', ''] },   // Includes duplicate 'api' (case-insensitive) and empty string
        { tags: ['  Tech  '] },            // Duplicate 'Tech' (case-insensitive)
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
        const mockEventsWithEmptyTags = [
            { tags: ['  ', ''] },
            { tags: ['   '] }
        ];
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
      expect(rep.send).toHaveBeenCalledWith({ message: 'An error occurred while fetching event tags.' });
    });
  });

  describe('batchGetEventsHandler', () => {
    it('should return events for given IDs', async () => {
      const eventIds = ['id1', 'id2'];
      // Specify the generic type for mockRequest and mockReply
      const req = mockRequest<{ Body: BatchGetEventsBody }>({ body: { eventIds } }) as AppFastifyRequest<{ Body: BatchGetEventsBody }>;
      const rep = mockReply<{ Body: BatchGetEventsBody }>() as AppFastifyReply<{ Body: BatchGetEventsBody }>;

      const mockDbEvents = [
        // ... (mock PrismaEventType objects, ensure they have all fields for transformEventForApi)
        // For simplicity, I'll mock the output of transformEventForApi directly if it's complex
        // or assume transformEventForApi is tested separately.
        // Let's assume transformEventForApi works and mock its input.
        { id: 'id1', title: 'Event 1', eventDate: new Date(), eventTime: new Date(), createdAt: new Date(), updatedAt: new Date(), userId: 'user1', description: '', locationDescription: '', organizerName: '', category: '', tags: [], websiteUrl: null },
        { id: 'id2', title: 'Event 2', eventDate: new Date(), eventTime: null, createdAt: new Date(), updatedAt: new Date(), userId: 'user2', description: '', locationDescription: '', organizerName: '', category: '', tags: [], websiteUrl: null },
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
          ])
        })
      );
      // More specific checks on transformed events if needed
      const sentData = (rep.send as import('vitest').Mock).mock.calls[0][0];
      expect(sentData.events.length).toBe(2);
    });

    it('should return an empty array if no events match IDs', async () => {
        const eventIds = ['idNonExistent1', 'idNonExistent2'];
        const req = mockRequest<{ Body: BatchGetEventsBody }>({ body: { eventIds } }) as AppFastifyRequest<{ Body: BatchGetEventsBody }>;
        const rep = mockReply<{ Body: BatchGetEventsBody }>() as AppFastifyReply<{ Body: BatchGetEventsBody }>;

        (prisma.event.findMany as import('vitest').Mock).mockResolvedValue([]);

        await batchGetEventsHandler(req, rep);
        expect(rep.code).toHaveBeenCalledWith(200);
        expect(rep.send).toHaveBeenCalledWith({ events: [] });
    });


    it('should return 500 if prisma query fails', async () => {
      const eventIds = ['id1'];
      const req = mockRequest<{ Body: BatchGetEventsBody }>({ body: { eventIds } }) as AppFastifyRequest<{ Body: BatchGetEventsBody }>;
      const rep = mockReply<{ Body: BatchGetEventsBody }>() as AppFastifyReply<{ Body: BatchGetEventsBody }>;
      const mockError = new Error('DB batch error');
      (prisma.event.findMany as import('vitest').Mock).mockRejectedValue(mockError);

      await batchGetEventsHandler(req, rep);

      expect(req.log.error).toHaveBeenCalledWith({ error: mockError, eventIds }, 'Error in batch-get events');
      expect(rep.code).toHaveBeenCalledWith(500);
      expect(rep.send).toHaveBeenCalledWith({ message: "An error occurred while fetching events." });
    });
  });

  // Add describe blocks for other controller functions (create, getById, list, update, delete, save, unsave, random)
  // For example:
  // describe('createEventHandler', () => { /* ... tests ... */ });
  // describe('getRandomEventHandler', () => { /* ... tests ... */ });

});