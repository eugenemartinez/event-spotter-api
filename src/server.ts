import { loadEnv } from './config/env'; // Your environment variable loader
import { build } from './app'; // The build function from your new app.ts

// Load environment variables at the very beginning
loadEnv();

const start = async () => {
  try {
    // The 'build' function now encapsulates logger setup, Redis client init (if part of app build),
    // plugin registration, and route registration.
    const app = await build(); // Call the build function from app.ts

    // Optional: Log routes if you want to see them at startup
    // This is useful for debugging. app.ready() is called within build().
    // app.log.info('--- Final Registered Routes by Fastify ---');
    // app.log.info('\n' + app.printRoutes());
    // app.log.info('-------------------------------------------------');

    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';

    await app.listen({ port, host });
    // Fastify's logger (configured in app.ts via loggerOptions)
    // will typically output listening information.
  } catch (err) {
    // Use console.error for critical startup errors, as the app logger might not be fully available.
    console.error('Error during server start:', err);
    process.exit(1);
  }
};

// Graceful Shutdown
// Note: Fastify's `app.listen()` also handles SIGINT/SIGTERM internally to call `app.close()`.
// This custom handler is an additional layer or can be primary if you have other resources to clean up.
const listeners = ['SIGINT', 'SIGTERM'] as const;
let appInstanceForShutdown: Awaited<ReturnType<typeof build>> | null = null; // To hold the app instance

// Modify start to assign appInstanceForShutdown
const modifiedStart = async () => {
  try {
    appInstanceForShutdown = await build();
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
    await appInstanceForShutdown.listen({ port, host });
  } catch (err) {
    console.error('Error during server start:', err);
    process.exit(1);
  }
};

listeners.forEach((signal) => {
  process.on(signal, async () => {
    console.log(`Received ${signal}, closing server...`);
    if (appInstanceForShutdown) {
      await appInstanceForShutdown.close();
      console.log('Server closed gracefully.');
    }
    process.exit(0);
  });
});

// Ensure server starts only when this file is executed directly
if (require.main === module) {
  // start(); // Use the modified start if you want the appInstanceForShutdown pattern
  modifiedStart();
}

// It's generally not needed to export 'start' or the app instance from server.ts
// if its sole purpose is to run the server.
