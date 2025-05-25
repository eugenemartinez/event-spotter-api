import { FastifyInstance } from 'fastify';
import supertest from 'supertest';
import { build } from '../../src/app'; // Path relative to this new file's location
import { hashPassword } from '../../src/utils/hash'; // Path relative to this new file's location
import { CreateEventInput } from '../../src/api/events/event.schemas'; // Add this import
import { Prisma } from '@prisma/client'; // Add this import for Prisma types

export interface TestEnvironment {
  app: FastifyInstance;
  testUserId: string;
  testUserToken: string;
  testUserUsername: string;
  testUserEmail: string; // Added for completeness if needed
}

/**
 * Sets up the test environment.
 * - Builds the Fastify application.
 * - Creates a unique test user.
 * - Logs in the test user to obtain an authentication token.
 * @param userIdentifier Optional string to make user email/username more unique (e.g., 'create-event')
 * @returns A promise that resolves to an object containing the app instance, user ID, token, and username.
 */
export async function setupTestEnvironment(userIdentifier: string = 'test'): Promise<TestEnvironment> {
  const app = await build();

  const uniqueId = Date.now();
  const testUserEmail = `${userIdentifier}-user-${uniqueId}@example.com`;
  const testUserUsername = `${userIdentifier}-user-${uniqueId}`;
  const testUserPassword = 'Password123!';

  const user = await app.prisma.user.create({
    data: {
      email: testUserEmail,
      username: testUserUsername,
      passwordHash: await hashPassword(testUserPassword),
    },
  });

  const loginResponse = await supertest(app.server)
    .post('/api/auth/login')
    .send({ identifier: testUserEmail, password: testUserPassword });

  if (loginResponse.status !== 200) {
    console.error('Login failed during test setup:', loginResponse.body);
    throw new Error(`Login failed with status ${loginResponse.status} during test setup for user ${testUserEmail}`);
  }

  const testUserToken = loginResponse.body.token;

  console.log(`[TestHelper] Setup complete for user: ${user.id} (${user.username})`);

  return {
    app,
    testUserId: user.id,
    testUserToken,
    testUserUsername: user.username, // Use the username from the created user object
    testUserEmail: user.email,
  };
}

/**
 * Tears down the test environment.
 * - Deletes UserSavedEvent records associated with the test user.
 * - Deletes events associated with the test user.
 * - Deletes the test user.
 * - Closes the Fastify application.
 * @param env - The test environment object obtained from setupTestEnvironment.
 */
export async function teardownTestEnvironment(env: TestEnvironment | null): Promise<void> {
  if (!env) {
    console.warn('[TestHelper Teardown] Called with null environment. Skipping.');
    return;
  }

  const { app, testUserId } = env;

  if (testUserId) {
    console.log(`[TestHelper Teardown] Starting cleanup for user: ${testUserId}`);
    try {
      // 1. Delete UserSavedEvent records associated with the user
      const savedEventsDeletion = await app.prisma.userSavedEvent.deleteMany({
        where: { userId: testUserId },
      });
      console.log(`[TestHelper Teardown] Deleted ${savedEventsDeletion.count} UserSavedEvent records for user: ${testUserId}`);

      // 2. Delete Event records created by the user
      const eventsDeletion = await app.prisma.event.deleteMany({
        where: { userId: testUserId },
      });
      console.log(`[TestHelper Teardown] Deleted ${eventsDeletion.count} Event records for user: ${testUserId}`);

      // 3. Delete the User record itself
      const userDeletion = await app.prisma.user.deleteMany({ // or .delete if you are certain only one matches
        where: { id: testUserId },
      });
      console.log(`[TestHelper Teardown] Deleted ${userDeletion.count} User record(s) for user: ${testUserId}`);
      
    } catch (error) {
      console.error(`[TestHelper Teardown] Error during data cleanup for user ${testUserId}:`, error);
      // Consider re-throwing if a failed cleanup should fail the test suite,
      // or if specific tests rely on this cleanup being perfect.
      // For now, logging is good for diagnosis.
    }
  } else {
    console.warn('[TestHelper Teardown] testUserId was null or undefined. Skipping data cleanup.');
  }

  try {
    await app.close();
    console.log('[TestHelper Teardown] App closed successfully.');
  } catch (error) {
    console.error('[TestHelper Teardown] Error closing the app:', error);
  }
  console.log(`[TestHelper Teardown] Teardown complete for user: ${testUserId || 'N/A'}`);
}

// Add the new createTestEvent function
/**
 * Helper function to create a test event directly in the database.
 * @param app FastifyInstance (used for prisma client)
 * @param userId The ID of the user creating the event.
 * @param eventData Partial data for the event.
 * @returns The created event object.
 */
export async function createTestEvent(
  app: FastifyInstance,
  userId: string,
  eventData: Partial<Omit<CreateEventInput, 'userId' | 'eventTime' | 'websiteUrl'>> & { eventDate: string; title: string; description: string; locationDescription: string; category: string; tags?: string[]; organizerName?: string; }
): Promise<Prisma.EventGetPayload<{ select: { id: true; title: true; userId: true } }>> {
  const fullEventData = {
    title: eventData.title,
    description: eventData.description,
    eventDate: new Date(eventData.eventDate), // Ensure eventDate is a Date object
    eventTime: null, // Default or make configurable
    locationDescription: eventData.locationDescription,
    organizerName: eventData.organizerName || 'Default Test Organizer', // Default or make configurable
    category: eventData.category,
    tags: eventData.tags || [],
    websiteUrl: null, // Default or make configurable
    userId: userId,
  };

  const createdEvent = await app.prisma.event.create({
    data: fullEventData,
    select: {
      id: true,
      title: true,
      userId: true,
    }
  });
  console.log(`[TestHelper] Created test event: ${createdEvent.id} for user ${userId}`);
  return createdEvent;
}