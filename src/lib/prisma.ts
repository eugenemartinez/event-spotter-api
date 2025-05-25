import { PrismaClient, Prisma } from '@prisma/client'; // Import Prisma namespace here

// Instantiate Prisma Client once
const prisma = new PrismaClient();

// Export the single instance and the Prisma namespace
export default prisma;
export { Prisma }; // Re-export the Prisma namespace
