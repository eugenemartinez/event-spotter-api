import { ZodError } from 'zod';
import prisma, { Prisma } from '../../lib/prisma';
import { hashPassword, comparePasswords } from '../../utils/hash';
import {
  RegisterUserInput,
  LoginUserInput,
  UpdateUserProfileInput,
  ChangePasswordInput,
  savedEventsResponseSchema,
} from './auth.schemas';
import {
  transformEventForApi,
  commonEventSelect,
  PrismaEventType,
} from '../events/event.controllers'; // Import PrismaEventType
import { ApiEventResponse } from '../events/event.schemas';
import { AuthenticatedUser, AppFastifyRequest, AppFastifyReply } from '../../types';

// --- Controller for POST /api/auth/register ---
export async function registerUserHandler(
  request: AppFastifyRequest<{ Body: RegisterUserInput }>,
  reply: AppFastifyReply<{ Body: RegisterUserInput }>,
) {
  const { email, password, username } = request.body;

  try {
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });

    if (existingUser) {
      request.log.info({ email, username }, 'Registration attempt failed: User already exists.');
      return reply.code(409).send({ message: 'User with this username or email already exists' });
    }

    const passwordHash = await hashPassword(password);
    const newUser = await prisma.user.create({
      data: { email, passwordHash, username },
      select: { id: true, username: true, email: true }, // Ensure these are selected
    });

    request.log.info(
      { userId: newUser.id, username: newUser.username },
      'User registered successfully.',
    );

    const token = await reply.jwtSign({
      id: newUser.id,
      username: newUser.username,
      email: newUser.email,
    });

    // Corrected response structure:
    return reply.code(201).send({
      id: newUser.id,
      username: newUser.username,
      email: newUser.email,
      token,
    });
  } catch (error: unknown) {
    request.log.error({ error, email, username }, 'Error during user registration');
    if (error instanceof ZodError) {
      return reply
        .code(400)
        .send({ message: 'Validation error', errors: error.flatten().fieldErrors });
    }
    // Handle potential Prisma unique constraint violation if the initial check somehow misses (though unlikely with the current logic)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      request.log.warn(
        { email, username, prismaCode: error.code },
        'Prisma unique constraint violation during registration.',
      );
      return reply.code(409).send({ message: 'User with this username or email already exists.' });
    }
    throw error; // For global error handler
  }
}

// --- Controller for POST /api/auth/login ---
export async function loginUserHandler(
  request: AppFastifyRequest<{ Body: LoginUserInput }>,
  reply: AppFastifyReply<{ Body: LoginUserInput }>,
) {
  const { identifier, password } = request.body;
  try {
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
    });

    if (!user) {
      request.log.info({ identifier }, 'Login attempt failed: User not found.');
      return reply.code(401).send({ message: 'Invalid credentials' }); // Remove period
    }

    const isPasswordValid = await comparePasswords(password, user.passwordHash);
    if (!isPasswordValid) {
      request.log.info({ userId: user.id, identifier }, 'Login attempt failed: Invalid password.');
      return reply.code(401).send({ message: 'Invalid credentials' }); // Remove period
    }

    request.log.info({ userId: user.id, username: user.username }, 'User logged in successfully.');
    const token = await reply.jwtSign({
      id: user.id,
      username: user.username,
      email: user.email,
    });
    // Corrected response structure:
    return reply.code(200).send({
      id: user.id,
      username: user.username,
      email: user.email,
      token,
    });
  } catch (error: unknown) {
    request.log.error({ error, identifier }, 'Error during user login');
    if (error instanceof ZodError) {
      return reply
        .code(400)
        .send({ message: 'Validation error', errors: error.flatten().fieldErrors });
    }
    throw error;
  }
}

// --- Controller for GET /api/auth/me ---
export async function getAuthenticatedUserDetailsHandler(
  request: AppFastifyRequest, // No specific body/params/query needed for this handler
  reply: AppFastifyReply,
) {
  // request.user should be populated by the 'authenticate' hook (JWT payload)
  const jwtUser = request.user as {
    id: string;
    username: string;
    email: string;
    iat?: number;
    exp?: number;
  }; // Adjust based on your actual JWT payload

  if (!jwtUser || !jwtUser.id) {
    // This case should ideally be caught by the authenticate hook if token is malformed
    // or if jwtVerify didn't populate request.user as expected.
    request.log.warn(
      'getAuthenticatedUserDetailsHandler called without a valid user object on request.',
    );
    return reply.code(401).send({ message: 'Authentication token did not yield a user.' });
  }

  try {
    const userFromDb = await prisma.user.findUnique({
      where: { id: jwtUser.id },
      select: { id: true, username: true, email: true, createdAt: true, updatedAt: true },
    });

    if (!userFromDb) {
      request.log.warn(
        { userIdFromToken: jwtUser.id },
        'User from valid token not found in DB for /me endpoint.',
      );
      // This is where the message is coming from for your failing test.
      // Standardize the message here:
      return reply.code(404).send({ message: 'User not found' }); // Or 'User not found.' to match test
    }

    // request.log.info({ userId: userFromDb.id }, 'Authenticated user details retrieved.');
    return reply.code(200).send({
      id: userFromDb.id,
      username: userFromDb.username,
      email: userFromDb.email,
      createdAt: userFromDb.createdAt.toISOString(),
      updatedAt: userFromDb.updatedAt.toISOString(),
    });
  } catch (error: unknown) {
    request.log.error(
      { error, userIdFromToken: jwtUser.id },
      'Error fetching authenticated user details',
    );
    throw error; // Let global error handler deal with unexpected errors
  }
}

// --- Controller for GET /api/auth/me/saved-events ---
export async function getSavedEventsHandler(request: AppFastifyRequest, reply: AppFastifyReply) {
  const authUser = request.user as AuthenticatedUser;
  request.log.info({ userId: authUser.id }, '--- ENTERING getSavedEventsHandler ---'); // Entry log

  try {
    const savedEventsRelations = await prisma.userSavedEvent.findMany({
      where: { userId: authUser.id },
      include: {
        event: {
          select: commonEventSelect,
        },
      },
      orderBy: {
        savedAt: 'desc',
      },
    });
    request.log.info(
      { userId: authUser.id, relationsCount: savedEventsRelations.length },
      'Fetched savedEventsRelations.',
    );

    const eventsForApi = savedEventsRelations
      .map((relation) => {
        if (!relation.event) {
          request.log.warn(
            { savedEventUserId: relation.userId, savedEventEventId: relation.eventId },
            'UserSavedEvent found with a missing/null associated event. Skipping.',
          );
          return null;
        }
        try {
          return transformEventForApi(relation.event as PrismaEventType);
        } catch (transformError) {
          request.log.error(
            {
              savedEventUserId: relation.userId,
              savedEventEventId: relation.eventId,
              error: transformError,
            },
            'Error transforming event in getSavedEventsHandler. Skipping.',
          );
          return null;
        }
      })
      .filter((event) => event !== null) as ApiEventResponse[];
    request.log.info(
      { userId: authUser.id, eventsForApiCount: eventsForApi.length },
      'Constructed eventsForApi.',
    );

    const responsePayload = { events: eventsForApi };

    return reply.code(200).send(responsePayload);
  } catch (error: unknown) {
    request.log.error(
      { error, userId: authUser.id },
      'CRITICAL Error in getSavedEventsHandler outer catch block',
    );
    throw error; // Re-throw to be caught by global error handler
  }
}

// --- Controller for PUT /api/auth/me/profile ---
// Note: The route is PATCH, but the handler name is updateUserProfileHandler.
// The types should reflect the actual schema used (UpdateUserProfileInput for Body).
export async function updateUserProfileHandler(
  request: AppFastifyRequest<{ Body: UpdateUserProfileInput }>,
  reply: AppFastifyReply<{ Body: UpdateUserProfileInput }>,
) {
  const authUser = request.user as AuthenticatedUser;
  const dataToUpdate = request.body; // Use a consistent name for request.body

  try {
    // Check if there's anything to update
    if (Object.keys(dataToUpdate).length === 0) {
      request.log.info({ userId: authUser.id }, 'Profile update attempt with empty payload.');
      // Optionally, return the current user profile or a specific message
      // For now, let's assume the controller proceeds and Prisma handles empty data update gracefully
      // Or, you could return a 200 with current data or 304 Not Modified, or 400 if it's an error
      // Depending on desired behavior for empty payload.
      // For this example, we'll let it proceed to the update logic,
      // which will effectively do nothing if dataToUpdate is empty.
      // A more robust approach might be:
      // return reply.code(200).send({ message: "No changes provided." }); // Or send current user data
    }

    // Check for conflicts if username or email is being updated
    let conflictQueryParts: Prisma.UserWhereInput[] = [];
    if (dataToUpdate.username) {
      conflictQueryParts.push({ username: dataToUpdate.username });
    }
    if (dataToUpdate.email) {
      conflictQueryParts.push({ email: dataToUpdate.email });
    }

    if (conflictQueryParts.length > 0) {
      const conflictingUser = await prisma.user.findFirst({
        where: {
          AND: [{ NOT: { id: authUser.id } }, { OR: conflictQueryParts }],
        },
      });

      if (conflictingUser) {
        let conflictField = 'username or email'; // Default
        let logDetails: any = { userId: authUser.id, conflictingUserId: conflictingUser.id };
        let logMessage = 'Profile update failed: ';

        const wantsToUpdateUsername = !!dataToUpdate.username;
        const wantsToUpdateEmail = !!dataToUpdate.email;
        const usernameConflict =
          wantsToUpdateUsername && conflictingUser.username === dataToUpdate.username;
        const emailConflict = wantsToUpdateEmail && conflictingUser.email === dataToUpdate.email;

        if (usernameConflict && emailConflict) {
          conflictField = 'username and email';
          logDetails.requestedUsername = dataToUpdate.username;
          logDetails.requestedEmail = dataToUpdate.email;
          logMessage += 'Username and email already taken.';
        } else if (usernameConflict) {
          conflictField = 'username';
          logDetails.requestedUsername = dataToUpdate.username;
          logMessage += 'Username already taken.';
        } else if (emailConflict) {
          conflictField = 'email';
          logDetails.requestedEmail = dataToUpdate.email;
          logMessage += 'Email already taken.';
        }
        // If only one field was requested for update, and it conflicted, the above will catch it.
        // If both were requested, and only one conflicted, the above also handles it.

        request.log.warn(logDetails, logMessage); // ADDED LOGGING
        return reply.code(409).send({ message: `User with this ${conflictField} already exists.` });
      }
    }

    // Proceed with update if no conflicts or no fields that need conflict checking were provided
    const updatedUserFromDb = await prisma.user.update({
      where: { id: authUser.id },
      data: dataToUpdate, // Pass the whole dataToUpdate object
      select: { id: true, username: true, email: true, createdAt: true, updatedAt: true },
    });

    request.log.info(
      { userId: authUser.id, updatedFields: dataToUpdate },
      'User profile updated successfully.',
    );
    return reply.code(200).send({
      id: updatedUserFromDb.id,
      username: updatedUserFromDb.username,
      email: updatedUserFromDb.email,
      createdAt: updatedUserFromDb.createdAt.toISOString(),
      updatedAt: updatedUserFromDb.updatedAt.toISOString(),
    });
  } catch (error: unknown) {
    request.log.error(
      { error, userId: authUser.id, body: dataToUpdate },
      'Error updating user profile',
    );
    if (error instanceof ZodError) {
      return reply
        .code(400)
        .send({ message: 'Validation error', errors: error.flatten().fieldErrors });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      request.log.warn(
        { userId: authUser.id, body: dataToUpdate, prismaCode: error.code },
        'Prisma unique constraint violation during profile update.',
      );
      // The P2002 message from Prisma is generic, so we provide a user-friendly one.
      return reply.code(409).send({ message: 'Username or email already taken.' });
    }
    throw error;
  }
}

// --- Controller for PUT /api/auth/me/password ---
// Note: The route is POST.
export async function changePasswordHandler(
  request: AppFastifyRequest<{ Body: ChangePasswordInput }>,
  reply: AppFastifyReply<{ Body: ChangePasswordInput }>,
) {
  const authUser = request.user as AuthenticatedUser;
  const { currentPassword, newPassword } = request.body;

  try {
    const userFromDb = await prisma.user.findUnique({ where: { id: authUser.id } });
    if (!userFromDb) {
      // Should not happen if authenticate hook works
      return reply.code(404).send({ message: 'User not found.' });
    }

    const isCurrentPasswordValid = await comparePasswords(currentPassword, userFromDb.passwordHash);
    if (!isCurrentPasswordValid) {
      return reply.code(401).send({ message: 'Invalid current password.' });
    }

    const newHashedPassword = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: authUser.id },
      data: { passwordHash: newHashedPassword },
    });

    request.log.info({ userId: authUser.id }, 'User password changed successfully.');
    // Consider security implications: e.g., log out other sessions, notify user.
    return reply.code(200).send({ message: 'Password changed successfully.' });
  } catch (error: unknown) {
    request.log.error({ error, userId: authUser.id }, 'Error changing user password');
    if (error instanceof ZodError) {
      return reply
        .code(400)
        .send({ message: 'Validation error', errors: error.flatten().fieldErrors });
    }
    throw error;
  }
}
