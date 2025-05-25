import { PrismaClient, User } from '@prisma/client';
import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') }); // Adjust path to .env if script is run from a different CWD

const prisma = new PrismaClient();
const JSON_EVENT_FILE_PATH = path.join(__dirname, 'seed_db.json');
const SALT_ROUNDS = 10;

interface SeedEventData {
  title: string;
  description: string;
  eventDate: string; // "YYYY-MM-DD"
  eventTime?: string; // "HH:MM:SS"
  locationDescription: string;
  organizerName: string;
  category: string;
  tags: string[];
  websiteUrl?: string;
  organizerEmail: string; // Used to link to a seeded user
}

async function main() {
  console.log('Starting database seeding process...');

  // --- 1. Seed Users ---
  console.log('Seeding users...');
  const usersToSeed = [
    { username: 'UserOne', email: 'user1@example.com', password: 'SecurePassword1!' },
    { username: 'UserTwo', email: 'user2@example.com', password: 'SecurePassword2@' },
    { username: 'UserThree', email: 'user3@example.com', password: 'SecurePassword3#' },
  ];

  const seededUsersMap = new Map<string, User>(); // email -> User object

  for (const userData of usersToSeed) {
    try {
      const hashedPassword = await bcrypt.hash(userData.password, SALT_ROUNDS);
      const user = await prisma.user.upsert({
        where: { email: userData.email },
        update: {
          username: userData.username,
          passwordHash: hashedPassword,
        },
        create: {
          username: userData.username,
          email: userData.email,
          passwordHash: hashedPassword,
        },
      });
      seededUsersMap.set(user.email, user);
      console.log(`Upserted user: ${user.email} (ID: ${user.id})`);
    } catch (error) {
      console.error(`Error upserting user ${userData.email}:`, error);
    }
  }

  if (seededUsersMap.size === 0) {
    console.error('No users were seeded. Aborting event seeding as events require a userId.');
    return;
  }
  console.log(`Successfully seeded/updated ${seededUsersMap.size} users.`);

  // --- 2. Read Event JSON Data ---
  console.log(`Reading event data from: ${JSON_EVENT_FILE_PATH}`);
  let eventJsonData: SeedEventData[];
  try {
    const fileContent = await fs.readFile(JSON_EVENT_FILE_PATH, 'utf-8');
    eventJsonData = JSON.parse(fileContent);
    console.log(`Successfully loaded ${eventJsonData.length} event records from JSON.`);
  } catch (error) {
    console.error('Error reading or parsing event JSON file:', error);
    return; // Exit if we can't read the event data
  }

  // --- 3. Seed Events ---
  console.log('Seeding events...');
  let eventsCreatedCount = 0;
  let eventsSkippedCount = 0;

  for (const eventData of eventJsonData) {
    const organizer = seededUsersMap.get(eventData.organizerEmail);
    if (!organizer) {
      console.warn(`Organizer with email ${eventData.organizerEmail} not found for event "${eventData.title}". Skipping.`);
      eventsSkippedCount++;
      continue;
    }

    try {
      // Construct Date objects for eventDate and eventTime
      // eventDate is YYYY-MM-DD, eventTime is HH:MM:SS
      // Prisma expects DateTime, but @db.Date and @db.Time will store only relevant parts
      let eventDateObject: Date | null = null;
      if (eventData.eventDate) {
        eventDateObject = new Date(eventData.eventDate + "T00:00:00.000Z"); // Ensure UTC for date part
      } else {
        console.warn(`Event "${eventData.title}" is missing eventDate. Skipping.`);
        eventsSkippedCount++;
        continue;
      }


      let eventTimeObject: Date | null = null;
      if (eventData.eventTime && eventData.eventDate) {
         // Combine date and time for a full ISO string then create Date
         // This helps Prisma interpret the time correctly against the date
        eventTimeObject = new Date(`${eventData.eventDate}T${eventData.eventTime}Z`);
      }


      await prisma.event.create({
        data: {
          title: eventData.title,
          description: eventData.description,
          eventDate: eventDateObject,
          eventTime: eventTimeObject, // Can be null if not provided
          locationDescription: eventData.locationDescription,
          organizerName: eventData.organizerName,
          category: eventData.category,
          tags: eventData.tags,
          websiteUrl: eventData.websiteUrl,
          userId: organizer.id,
        },
      });
      eventsCreatedCount++;
      // console.log(`Created event: "${eventData.title}"`);
    } catch (error) {
      console.error(`Error creating event "${eventData.title}":`, error);
      eventsSkippedCount++;
    }
  }
  console.log(`Successfully created ${eventsCreatedCount} events.`);
  if (eventsSkippedCount > 0) {
    console.log(`Skipped ${eventsSkippedCount} events due to missing data or errors.`);
  }

  console.log('Database seeding completed.');
}

main()
  .catch((e) => {
    console.error('Unhandled error during seeding process:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log('Prisma client disconnected.');
  });
