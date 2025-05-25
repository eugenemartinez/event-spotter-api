import dotenv from 'dotenv';
import path from 'path';
import { beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Load .env.test variables if the file exists
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

const prisma = new PrismaClient(); // Will use DATABASE_URL from environment

beforeAll(async () => {
  try {
    await prisma.$connect(); // Explicitly connect before any tests run
    console.log('Vitest global setup: beforeAll - Prisma connected. Test suite starting.');
  } catch (error) {
    console.error('Vitest global setup: beforeAll - Prisma connection error.', error);
    throw error; // Fail fast if DB connection is an issue
  }
});

afterAll(async () => {
  await prisma.$disconnect();
  console.log('Vitest global setup: afterAll - Prisma disconnected. Test suite finished.');
});

beforeEach(async () => {
  console.log('Vitest global setup: beforeEach - Cleaning database tables...');
  // Delete in an order that respects foreign key constraints

  // Corrected model accessor:
  await prisma.userSavedEvent.deleteMany({}); // Changed from savedEvent to userSavedEvent

  // These should also match your schema.prisma model names (Event and User seem correct)
  await prisma.event.deleteMany({});
  await prisma.user.deleteMany({});

  console.log('Vitest global setup: beforeEach - Database tables cleaned.');
});