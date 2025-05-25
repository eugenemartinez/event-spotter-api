import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { ZodError, ZodIssueCode } from 'zod';
import { Prisma as PrismaTypes } from '@prisma/client'; // Renamed for type usage

// Import default (mocked prisma client) and Prisma namespace (mocked) from '../../lib/prisma'
import prismaClientMock, { Prisma as PrismaMockedNamespace } from '../../lib/prisma';

import * as AuthControllers from './auth.controllers';
import * as HashUtils from '../../utils/hash';
import * as EventTransformers from '../events/event.controllers';

// Mock Prisma module
vi.mock('../../lib/prisma', async (importActual) => {
  const actual = await importActual<typeof PrismaTypes>(); // Get actual types if needed

  // This is the class that will be used for Prisma.PrismaClientKnownRequestError
  // by both the controller (via its import) and the test (via its import).
  const MockedPrismaError = class {
    public message: string;
    public code: string;
    public clientVersion: string;
    public meta?: Record<string, unknown>;

    constructor(
      message: string,
      params: { code: string; clientVersion: string; meta?: Record<string, unknown> },
    ) {
      this.message = message;
      this.code = params.code;
      this.clientVersion = params.clientVersion;
      this.meta = params.meta;
    }
  };

  return {
    __esModule: true, // Helps with default and named exports from mock
    default: {
      // Mock for the default prisma client instance
      user: {
        findFirst: vi.fn(),
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      userSavedEvent: {
        findMany: vi.fn(),
      },
      // Add other models if needed
    },
    Prisma: {
      // Mock for the Prisma namespace
      PrismaClientKnownRequestError: MockedPrismaError,
      // If your controller uses other things from Prisma namespace, mock them here too
      // e.g., Prisma.ModelName if it's an enum used in selects etc.
    },
  };
});

// Mock HashUtils (remains the same)
vi.mock('../../utils/hash', () => ({
  hashPassword: vi.fn(),
  comparePasswords: vi.fn(),
}));

// Mock EventTransformers (remains the same)
vi.mock('../events/event.controllers', async (importOriginal) => {
  const original = await importOriginal<typeof EventTransformers>();
  return {
    ...original,
    transformEventForApi: vi.fn(),
  };
});

describe('Auth Controllers', () => {
  let mockRequest: any;
  let mockReply: any;

  beforeEach(() => {
    mockRequest = {
      body: {},
      user: null, // Will be set in tests requiring authenticated user
      log: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      },
    };
    mockReply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      jwtSign: vi.fn(), // For register and login
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --- registerUserHandler ---
  describe('registerUserHandler', () => {
    it('should register a new user successfully and return user data with a token', async () => {
      // Arrange
      const input = {
        username: 'newUser',
        email: 'newuser@example.com',
        password: 'Password123!',
      };
      mockRequest.body = input;

      const mockHashedPassword = 'hashedPassword123';
      const mockNewUser = {
        id: 'user-id-new',
        username: input.username,
        email: input.email,
      };
      const mockToken = 'mock.jwt.token';

      (prismaClientMock.user.findFirst as Mock).mockResolvedValue(null); // Use the mocked client
      (HashUtils.hashPassword as Mock).mockResolvedValue(mockHashedPassword); // Changed: Used 'Mock' directly
      (prismaClientMock.user.create as Mock).mockResolvedValue(mockNewUser); // Changed: Used 'Mock' directly
      (mockReply.jwtSign as Mock).mockResolvedValue(mockToken); // Changed: Used 'Mock' directly

      // Act
      await AuthControllers.registerUserHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.user.findFirst).toHaveBeenCalledWith({
        where: { OR: [{ email: input.email }, { username: input.username }] },
      });
      expect(HashUtils.hashPassword).toHaveBeenCalledWith(input.password);
      expect(prismaClientMock.user.create).toHaveBeenCalledWith({
        data: {
          email: input.email,
          passwordHash: mockHashedPassword,
          username: input.username,
        },
        select: { id: true, username: true, email: true },
      });
      expect(mockReply.jwtSign).toHaveBeenCalledWith({
        id: mockNewUser.id,
        username: mockNewUser.username,
        email: mockNewUser.email,
      });
      expect(mockReply.code).toHaveBeenCalledWith(201);
      expect(mockReply.send).toHaveBeenCalledWith({
        id: mockNewUser.id,
        username: mockNewUser.username,
        email: mockNewUser.email,
        token: mockToken,
      });
      expect(mockRequest.log.info).toHaveBeenCalledWith(
        { userId: mockNewUser.id, username: mockNewUser.username },
        'User registered successfully.',
      );
    });

    it('should return 409 if user with the same email already exists', async () => {
      // Arrange
      const input = {
        username: 'newUser',
        email: 'existing@example.com',
        password: 'Password123!',
      };
      mockRequest.body = input;
      const existingUser = { id: 'user-id-existing', email: input.email, username: 'anotherUser' };

      (prismaClientMock.user.findFirst as Mock).mockResolvedValue(existingUser); // Use the mocked client

      // Act
      await AuthControllers.registerUserHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.user.findFirst).toHaveBeenCalledWith({
        where: { OR: [{ email: input.email }, { username: input.username }] },
      });
      expect(mockReply.code).toHaveBeenCalledWith(409);
      expect(mockReply.send).toHaveBeenCalledWith({
        message: 'User with this username or email already exists',
      });
      expect(prismaClientMock.user.create).not.toHaveBeenCalled();
      expect(HashUtils.hashPassword).not.toHaveBeenCalled();
      expect(mockReply.jwtSign).not.toHaveBeenCalled();
      expect(mockRequest.log.info).toHaveBeenCalledWith(
        // CORRECTED to log.info
        { email: input.email, username: input.username },
        'Registration attempt failed: User already exists.', // Ensure this message matches controller
      );
    });

    it('should return 409 if user with the same username already exists', async () => {
      // Arrange
      const input = {
        username: 'existingUser',
        email: 'new@example.com',
        password: 'Password123!',
      };
      mockRequest.body = input;
      const existingUser = {
        id: 'user-id-existing',
        email: 'another@example.com',
        username: input.username,
      };

      (prismaClientMock.user.findFirst as Mock).mockResolvedValue(existingUser); // Use the mocked client

      // Act
      await AuthControllers.registerUserHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.user.findFirst).toHaveBeenCalledWith({
        where: { OR: [{ email: input.email }, { username: input.username }] },
      });
      expect(mockReply.code).toHaveBeenCalledWith(409);
      expect(mockReply.send).toHaveBeenCalledWith({
        message: 'User with this username or email already exists', // CORRECTED
      });
      expect(prismaClientMock.user.create).not.toHaveBeenCalled();
      expect(HashUtils.hashPassword).not.toHaveBeenCalled();
      expect(mockReply.jwtSign).not.toHaveBeenCalled();
      expect(mockRequest.log.info).toHaveBeenCalledWith(
        // CORRECTED to log.info
        { email: input.email, username: input.username }, // Adjust if input is different
        'Registration attempt failed: User already exists.',
      );
    });

    it('should return 409 if user with the same username and email already exists', async () => {
      // Arrange
      const input = {
        username: 'existingUser',
        email: 'existing@example.com',
        password: 'Password123!',
      };
      mockRequest.body = input;
      const existingUser = { id: 'user-id-existing', email: input.email, username: input.username };

      (prismaClientMock.user.findFirst as Mock).mockResolvedValue(existingUser); // Use the mocked client

      // Act
      await AuthControllers.registerUserHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.user.findFirst).toHaveBeenCalledWith({
        where: { OR: [{ email: input.email }, { username: input.username }] },
      });
      expect(mockReply.code).toHaveBeenCalledWith(409);
      expect(mockReply.send).toHaveBeenCalledWith({
        message: 'User with this username or email already exists', // CORRECTED
      });
      expect(prismaClientMock.user.create).not.toHaveBeenCalled();
      expect(HashUtils.hashPassword).not.toHaveBeenCalled();
      expect(mockReply.jwtSign).not.toHaveBeenCalled();
      expect(mockRequest.log.info).toHaveBeenCalledWith(
        // CORRECTED to log.info
        { email: input.email, username: input.username }, // Adjust if input is different
        'Registration attempt failed: User already exists.',
      );
    });

    it('should handle ZodError for invalid input by returning 400', async () => {
      // Arrange
      const input = {
        username: 'new',
        email: 'not-an-email',
        password: 'short',
      };
      mockRequest.body = input;

      const fieldErrors = {
        username: ['String must contain at least 3 character(s)'],
        email: ['Invalid email'],
        password: ['String must contain at least 8 character(s)'],
      };

      // Construct a ZodError with proper issues
      const zodErrorInstance = new ZodError([
        {
          code: ZodIssueCode.too_small, // Example issue code
          minimum: 3,
          type: 'string',
          inclusive: true,
          exact: false,
          message: 'String must contain at least 3 character(s)',
          path: ['username'],
        },
        {
          code: ZodIssueCode.invalid_string, // Example issue code
          validation: 'email',
          message: 'Invalid email',
          path: ['email'],
        },
        {
          code: ZodIssueCode.too_small, // Example issue code
          minimum: 8,
          type: 'string',
          inclusive: true,
          exact: false,
          message: 'String must contain at least 8 character(s)',
          path: ['password'],
        },
      ]);

      (prismaClientMock.user.findFirst as Mock).mockRejectedValue(zodErrorInstance); // Use the mocked client

      // Act
      await AuthControllers.registerUserHandler(mockRequest, mockReply);

      // Assert
      expect(mockReply.code).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith({
        message: 'Validation error',
        errors: fieldErrors,
      });
      expect(mockRequest.log.error).toHaveBeenCalled();
      expect(prismaClientMock.user.create).not.toHaveBeenCalled();
    });

    it('should handle Prisma unique constraint violation (P2002) during create by returning 409', async () => {
      // Arrange
      const input = {
        username: 'newUser',
        email: 'newuser@example.com',
        password: 'Password123!',
      };
      mockRequest.body = input;
      const mockHashedPassword = 'hashedPassword123';

      (prismaClientMock.user.findFirst as Mock).mockResolvedValue(null); // Use the mocked client
      (HashUtils.hashPassword as Mock).mockResolvedValue(mockHashedPassword);

      // Use the PrismaMockedNamespace to instantiate the error
      // This ensures it's an instance of MockedPrismaError from our mock setup
      const prismaError = new PrismaMockedNamespace.PrismaClientKnownRequestError(
        'Unique constraint failed on create', // More specific message for clarity if needed
        { code: 'P2002', clientVersion: 'mock-client-version-xyz' },
      );
      (prismaClientMock.user.create as Mock).mockRejectedValue(prismaError); // Use the mocked client

      // Act
      await AuthControllers.registerUserHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.user.findFirst).toHaveBeenCalled();
      expect(HashUtils.hashPassword).toHaveBeenCalledWith(input.password);
      expect(prismaClientMock.user.create).toHaveBeenCalledWith({
        data: {
          email: input.email,
          passwordHash: mockHashedPassword,
          username: input.username,
        },
        select: { id: true, username: true, email: true },
      });
      expect(mockReply.code).toHaveBeenCalledWith(409);
      expect(mockReply.send).toHaveBeenCalledWith({
        message: 'User with this username or email already exists.',
      });
      expect(mockRequest.log.warn).toHaveBeenCalledWith(
        { email: input.email, username: input.username, prismaCode: 'P2002' },
        'Prisma unique constraint violation during registration.',
      );
      expect(mockReply.jwtSign).not.toHaveBeenCalled();
    });

    it('should handle other errors by throwing them', async () => {
      // Arrange
      const input = {
        username: 'newUser',
        email: 'newuser@example.com',
        password: 'Password123!',
      };
      mockRequest.body = input;
      const genericError = new Error('Something went very wrong!');

      // Simulate a generic error during the first async operation
      (prismaClientMock.user.findFirst as Mock).mockRejectedValue(genericError);

      // Act & Assert
      // We expect the function to throw the error, so we wrap the call in a try/catch
      // or use expect(...).rejects.toThrow()
      await expect(AuthControllers.registerUserHandler(mockRequest, mockReply)).rejects.toThrow(
        genericError,
      );

      // Also assert that no response was sent and no user was created/token generated
      expect(mockReply.code).not.toHaveBeenCalled();
      expect(mockReply.send).not.toHaveBeenCalled();
      expect(prismaClientMock.user.create).not.toHaveBeenCalled();
      expect(HashUtils.hashPassword).not.toHaveBeenCalled();
      expect(mockReply.jwtSign).not.toHaveBeenCalled();
      expect(mockRequest.log.error).toHaveBeenCalledWith(
        { error: genericError, email: input.email, username: input.username },
        'Error during user registration',
      );
    });
  });

  // --- loginUserHandler ---
  describe('loginUserHandler', () => {
    it('should log in an existing user successfully and return user data with a token', async () => {
      // Arrange
      const input = {
        identifier: 'testuser@example.com', // Can be email or username
        password: 'Password123!',
      };
      mockRequest.body = input;

      const mockUserFromDb = {
        id: 'user-id-123',
        username: 'testuser',
        email: 'testuser@example.com',
        passwordHash: 'hashedPasswordFromDb',
      };
      const mockToken = 'mock.jwt.token.login';

      (prismaClientMock.user.findFirst as Mock).mockResolvedValue(mockUserFromDb);
      (HashUtils.comparePasswords as Mock).mockResolvedValue(true);
      (mockReply.jwtSign as Mock).mockResolvedValue(mockToken);

      // Act
      await AuthControllers.loginUserHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.user.findFirst).toHaveBeenCalledWith({
        where: { OR: [{ email: input.identifier }, { username: input.identifier }] },
      });
      expect(HashUtils.comparePasswords).toHaveBeenCalledWith(
        input.password,
        mockUserFromDb.passwordHash,
      );
      expect(mockReply.jwtSign).toHaveBeenCalledWith({
        id: mockUserFromDb.id,
        username: mockUserFromDb.username,
        email: mockUserFromDb.email,
      });
      expect(mockReply.code).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalledWith({
        id: mockUserFromDb.id,
        username: mockUserFromDb.username,
        email: mockUserFromDb.email,
        token: mockToken,
      });
      expect(mockRequest.log.info).toHaveBeenCalledWith(
        { userId: mockUserFromDb.id, username: mockUserFromDb.username },
        'User logged in successfully.',
      );
    });

    it('should return 401 if user is not found', async () => {
      // Arrange
      const input = {
        identifier: 'nonexistent@example.com',
        password: 'Password123!',
      };
      mockRequest.body = input;

      (prismaClientMock.user.findFirst as Mock).mockResolvedValue(null); // Simulate user not found

      // Act
      await AuthControllers.loginUserHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.user.findFirst).toHaveBeenCalledWith({
        where: { OR: [{ email: input.identifier }, { username: input.identifier }] },
      });
      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({ message: 'Invalid credentials' });
      expect(HashUtils.comparePasswords).not.toHaveBeenCalled();
      expect(mockReply.jwtSign).not.toHaveBeenCalled();
      expect(mockRequest.log.info).toHaveBeenCalledWith(
        { identifier: input.identifier },
        'Login attempt failed: User not found.',
      );
    });

    it('should return 401 if password does not match', async () => {
      // Arrange
      const input = {
        identifier: 'testuser@example.com',
        password: 'WrongPassword123!',
      };
      mockRequest.body = input;

      const mockUserFromDb = {
        id: 'user-id-123',
        username: 'testuser',
        email: 'testuser@example.com',
        passwordHash: 'hashedPasswordFromDb',
      };

      (prismaClientMock.user.findFirst as Mock).mockResolvedValue(mockUserFromDb);
      (HashUtils.comparePasswords as Mock).mockResolvedValue(false); // Simulate password mismatch

      // Act
      await AuthControllers.loginUserHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.user.findFirst).toHaveBeenCalled();
      expect(HashUtils.comparePasswords).toHaveBeenCalledWith(
        input.password,
        mockUserFromDb.passwordHash,
      );
      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({ message: 'Invalid credentials' });
      expect(mockReply.jwtSign).not.toHaveBeenCalled();
      expect(mockRequest.log.info).toHaveBeenCalledWith(
        { userId: mockUserFromDb.id, identifier: input.identifier },
        'Login attempt failed: Invalid password.',
      );
    });

    it('should handle ZodError for invalid input by returning 400', async () => {
      // Arrange
      const input = {
        identifier: '', // Invalid: empty identifier
        password: '', // Invalid: empty password
      };
      mockRequest.body = input;

      const fieldErrors = {
        identifier: ['Email or Username is required'], // Based on LoginUserInput schema
        password: ['Password cannot be empty'], // Based on LoginUserInput schema
      };
      const zodErrorInstance = new ZodError([
        {
          code: ZodIssueCode.too_small,
          minimum: 1,
          type: 'string',
          inclusive: true,
          exact: false,
          message: 'Email or Username is required',
          path: ['identifier'],
        },
        {
          code: ZodIssueCode.too_small,
          minimum: 1,
          type: 'string',
          inclusive: true,
          exact: false,
          message: 'Password cannot be empty',
          path: ['password'],
        },
      ]);

      // Simulate ZodError being thrown from an internal operation
      (prismaClientMock.user.findFirst as Mock).mockRejectedValue(zodErrorInstance);

      // Act
      await AuthControllers.loginUserHandler(mockRequest, mockReply);

      // Assert
      expect(mockReply.code).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith({
        message: 'Validation error',
        errors: fieldErrors,
      });
      expect(mockRequest.log.error).toHaveBeenCalled();
      expect(HashUtils.comparePasswords).not.toHaveBeenCalled();
      expect(mockReply.jwtSign).not.toHaveBeenCalled();
    });

    it('should handle other errors by throwing them', async () => {
      // Arrange
      const input = {
        identifier: 'testuser@example.com',
        password: 'Password123!',
      };
      mockRequest.body = input;
      const genericError = new Error('Database connection lost!');

      (prismaClientMock.user.findFirst as Mock).mockRejectedValue(genericError);

      // Act & Assert
      await expect(AuthControllers.loginUserHandler(mockRequest, mockReply)).rejects.toThrow(
        genericError,
      );

      expect(mockReply.code).not.toHaveBeenCalled();
      expect(mockReply.send).not.toHaveBeenCalled();
      expect(HashUtils.comparePasswords).not.toHaveBeenCalled();
      expect(mockReply.jwtSign).not.toHaveBeenCalled();
      expect(mockRequest.log.error).toHaveBeenCalledWith(
        { error: genericError, identifier: input.identifier },
        'Error during user login',
      );
    });
  });

  // --- getAuthenticatedUserDetailsHandler ---
  describe('getAuthenticatedUserDetailsHandler', () => {
    beforeEach(() => {
      // Default authenticated user for these tests
      mockRequest.user = { id: 'user-id-123', username: 'testuser', email: 'test@example.com' };
    });

    it('should return authenticated user details if user exists in DB', async () => {
      // Arrange
      const now = new Date();
      const mockUserFromDb = {
        id: mockRequest.user.id,
        username: mockRequest.user.username,
        email: mockRequest.user.email,
        createdAt: now,
        updatedAt: now,
      };

      (prismaClientMock.user.findUnique as Mock).mockResolvedValue(mockUserFromDb);

      // Act
      await AuthControllers.getAuthenticatedUserDetailsHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockRequest.user.id },
        select: { id: true, username: true, email: true, createdAt: true, updatedAt: true },
      });
      expect(mockReply.code).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalledWith({
        id: mockUserFromDb.id,
        username: mockUserFromDb.username,
        email: mockUserFromDb.email,
        createdAt: mockUserFromDb.createdAt.toISOString(),
        updatedAt: mockUserFromDb.updatedAt.toISOString(),
      });
      // The controller doesn't have a specific success log for this path after fetching,
      // but it does log if the user from token is not found, or on general errors.
    });

    it('should return 401 if request.user is not populated', async () => {
      // Arrange
      mockRequest.user = null; // Simulate no user on request (e.g., token verification failed upstream)

      // Act
      await AuthControllers.getAuthenticatedUserDetailsHandler(mockRequest, mockReply);

      // Assert
      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({
        message: 'Authentication token did not yield a user.',
      });
      expect(prismaClientMock.user.findUnique).not.toHaveBeenCalled();
      expect(mockRequest.log.warn).toHaveBeenCalledWith(
        'getAuthenticatedUserDetailsHandler called without a valid user object on request.',
      );
    });

    it('should return 401 if request.user.id is missing', async () => {
      // Arrange
      // @ts-ignore // Testing a malformed user object
      mockRequest.user = { username: 'testuser', email: 'test@example.com' }; // No id

      // Act
      await AuthControllers.getAuthenticatedUserDetailsHandler(mockRequest, mockReply);

      // Assert
      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({
        message: 'Authentication token did not yield a user.',
      });
      expect(prismaClientMock.user.findUnique).not.toHaveBeenCalled();
      expect(mockRequest.log.warn).toHaveBeenCalledWith(
        'getAuthenticatedUserDetailsHandler called without a valid user object on request.',
      );
    });

    it('should return 404 if user from token is not found in DB', async () => {
      // Arrange
      // mockRequest.user is set by beforeEach to { id: 'user-id-123', ... }
      (prismaClientMock.user.findUnique as Mock).mockResolvedValue(null); // Simulate user not found in DB

      // Act
      await AuthControllers.getAuthenticatedUserDetailsHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockRequest.user.id },
        select: { id: true, username: true, email: true, createdAt: true, updatedAt: true },
      });
      expect(mockReply.code).toHaveBeenCalledWith(404);
      expect(mockReply.send).toHaveBeenCalledWith({ message: 'User not found' }); // Message from controller
      expect(mockRequest.log.warn).toHaveBeenCalledWith(
        { userIdFromToken: mockRequest.user.id },
        'User from valid token not found in DB for /me endpoint.',
      );
    });

    it('should handle other errors by throwing them', async () => {
      // Arrange
      // mockRequest.user is set by beforeEach
      const genericError = new Error('Network issue connecting to database!');
      (prismaClientMock.user.findUnique as Mock).mockRejectedValue(genericError);

      // Act & Assert
      await expect(
        AuthControllers.getAuthenticatedUserDetailsHandler(mockRequest, mockReply),
      ).rejects.toThrow(genericError);

      expect(prismaClientMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockRequest.user.id },
        select: { id: true, username: true, email: true, createdAt: true, updatedAt: true },
      });
      expect(mockReply.code).not.toHaveBeenCalled();
      expect(mockReply.send).not.toHaveBeenCalled();
      expect(mockRequest.log.error).toHaveBeenCalledWith(
        { error: genericError, userIdFromToken: mockRequest.user.id },
        'Error fetching authenticated user details',
      );
    });
  });

  // --- updateUserProfileHandler ---
  describe('updateUserProfileHandler', () => {
    beforeEach(() => {
      // Default authenticated user for these tests
      mockRequest.user = {
        id: 'user-id-for-update',
        username: 'originalUser',
        email: 'original@example.com',
      };
    });

    it('should update username successfully', async () => {
      // Arrange
      const input = { username: 'newUsername' };
      mockRequest.body = input;
      const now = new Date();
      const expectedUpdatedUser = {
        id: mockRequest.user.id,
        username: input.username,
        email: mockRequest.user.email, // Email remains original
        createdAt: now, // Assuming createdAt doesn't change on update for this test
        updatedAt: now,
      };

      // No conflicting user
      (prismaClientMock.user.findFirst as Mock).mockResolvedValue(null);
      (prismaClientMock.user.update as Mock).mockResolvedValue(expectedUpdatedUser);

      // Act
      await AuthControllers.updateUserProfileHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.user.findFirst).toHaveBeenCalledWith({
        where: {
          AND: [{ NOT: { id: mockRequest.user.id } }, { OR: [{ username: input.username }] }],
        },
      });
      expect(prismaClientMock.user.update).toHaveBeenCalledWith({
        where: { id: mockRequest.user.id },
        data: { username: input.username },
        select: { id: true, username: true, email: true, createdAt: true, updatedAt: true },
      });
      expect(mockReply.code).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalledWith({
        ...expectedUpdatedUser,
        createdAt: expectedUpdatedUser.createdAt.toISOString(),
        updatedAt: expectedUpdatedUser.updatedAt.toISOString(),
      });
      expect(mockRequest.log.info).toHaveBeenCalledWith(
        { userId: mockRequest.user.id, updatedFields: input },
        'User profile updated successfully.',
      );
    });

    it('should update email successfully', async () => {
      // Arrange
      const input = { email: 'newemail@example.com' };
      mockRequest.body = input;
      const now = new Date();
      const expectedUpdatedUser = {
        id: mockRequest.user.id,
        username: mockRequest.user.username, // Username remains original
        email: input.email,
        createdAt: now,
        updatedAt: now,
      };

      (prismaClientMock.user.findFirst as Mock).mockResolvedValue(null); // No conflicting user
      (prismaClientMock.user.update as Mock).mockResolvedValue(expectedUpdatedUser);

      // Act
      await AuthControllers.updateUserProfileHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.user.findFirst).toHaveBeenCalledWith({
        where: {
          AND: [{ NOT: { id: mockRequest.user.id } }, { OR: [{ email: input.email }] }],
        },
      });
      expect(prismaClientMock.user.update).toHaveBeenCalledWith({
        where: { id: mockRequest.user.id },
        data: { email: input.email },
        select: { id: true, username: true, email: true, createdAt: true, updatedAt: true },
      });
      expect(mockReply.code).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalledWith({
        ...expectedUpdatedUser,
        createdAt: expectedUpdatedUser.createdAt.toISOString(),
        updatedAt: expectedUpdatedUser.updatedAt.toISOString(),
      });
      expect(mockRequest.log.info).toHaveBeenCalled();
    });

    it('should update both username and email successfully', async () => {
      // Arrange
      const input = { username: 'anotherNewUser', email: 'anothernew@example.com' };
      mockRequest.body = input;
      const now = new Date();
      const expectedUpdatedUser = {
        id: mockRequest.user.id,
        username: input.username,
        email: input.email,
        createdAt: now,
        updatedAt: now,
      };

      (prismaClientMock.user.findFirst as Mock).mockResolvedValue(null); // No conflicting user
      (prismaClientMock.user.update as Mock).mockResolvedValue(expectedUpdatedUser);

      // Act
      await AuthControllers.updateUserProfileHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.user.findFirst).toHaveBeenCalledWith({
        where: {
          AND: [
            { NOT: { id: mockRequest.user.id } },
            { OR: [{ username: input.username }, { email: input.email }] },
          ],
        },
      });
      expect(prismaClientMock.user.update).toHaveBeenCalledWith({
        where: { id: mockRequest.user.id },
        data: { username: input.username, email: input.email },
        select: { id: true, username: true, email: true, createdAt: true, updatedAt: true },
      });
      expect(mockReply.code).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalledWith({
        ...expectedUpdatedUser,
        createdAt: expectedUpdatedUser.createdAt.toISOString(),
        updatedAt: expectedUpdatedUser.updatedAt.toISOString(),
      });
      expect(mockRequest.log.info).toHaveBeenCalled();
    });

    it('should return 409 if new username is already taken', async () => {
      // Arrange
      const input = { username: 'takenUsername' };
      mockRequest.body = input;
      const conflictingUser = {
        id: 'other-user-id',
        username: 'takenUsername',
        email: 'other@example.com',
      };

      (prismaClientMock.user.findFirst as Mock).mockResolvedValue(conflictingUser);

      // Act
      await AuthControllers.updateUserProfileHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.user.findFirst).toHaveBeenCalledWith({
        where: {
          AND: [{ NOT: { id: mockRequest.user.id } }, { OR: [{ username: input.username }] }],
        },
      });
      expect(mockReply.code).toHaveBeenCalledWith(409);
      expect(mockReply.send).toHaveBeenCalledWith({
        message: 'User with this username already exists.',
      });
      expect(prismaClientMock.user.update).not.toHaveBeenCalled();
      expect(mockRequest.log.warn).toHaveBeenCalledWith(
        {
          userId: mockRequest.user.id,
          requestedUsername: input.username,
          conflictingUserId: conflictingUser.id,
        },
        'Profile update failed: Username already taken.',
      );
    });

    it('should return 409 if new email is already taken', async () => {
      // Arrange
      const input = { email: 'takenemail@example.com' };
      mockRequest.body = input;
      const conflictingUser = {
        id: 'other-user-id',
        username: 'anotherUser',
        email: 'takenemail@example.com',
      };

      (prismaClientMock.user.findFirst as Mock).mockResolvedValue(conflictingUser);

      // Act
      await AuthControllers.updateUserProfileHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.user.findFirst).toHaveBeenCalledWith({
        where: {
          AND: [{ NOT: { id: mockRequest.user.id } }, { OR: [{ email: input.email }] }],
        },
      });
      expect(mockReply.code).toHaveBeenCalledWith(409);
      expect(mockReply.send).toHaveBeenCalledWith({
        message: 'User with this email already exists.',
      });
      expect(prismaClientMock.user.update).not.toHaveBeenCalled();
      expect(mockRequest.log.warn).toHaveBeenCalledWith(
        {
          userId: mockRequest.user.id,
          requestedEmail: input.email,
          conflictingUserId: conflictingUser.id,
        },
        'Profile update failed: Email already taken.',
      );
    });

    it('should return 409 if new username and email are taken by the same other user', async () => {
      // Arrange
      const input = { username: 'takenUsername', email: 'takenemail@example.com' };
      mockRequest.body = input;
      const conflictingUser = {
        id: 'other-user-id',
        username: 'takenUsername',
        email: 'takenemail@example.com',
      };

      (prismaClientMock.user.findFirst as Mock).mockResolvedValue(conflictingUser);

      // Act
      await AuthControllers.updateUserProfileHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.user.findFirst).toHaveBeenCalledWith({
        where: {
          AND: [
            { NOT: { id: mockRequest.user.id } },
            { OR: [{ username: input.username }, { email: input.email }] },
          ],
        },
      });
      expect(mockReply.code).toHaveBeenCalledWith(409);
      expect(mockReply.send).toHaveBeenCalledWith({
        message: 'User with this username and email already exists.',
      });
      expect(prismaClientMock.user.update).not.toHaveBeenCalled();
      expect(mockRequest.log.warn).toHaveBeenCalledWith(
        {
          userId: mockRequest.user.id,
          requestedUsername: input.username,
          requestedEmail: input.email,
          conflictingUserId: conflictingUser.id,
        },
        'Profile update failed: Username and email already taken.',
      );
    });

    it('should handle ZodError for invalid input by returning 400', async () => {
      // Arrange
      const input = { username: 'u' }; // Invalid: username too short
      mockRequest.body = input;

      // Manually create a ZodError instance that matches what the schema would produce
      // The actual error would be thrown by schema parsing if it were part of the route handling,
      // but here we simulate it being caught in the controller's try/catch.
      const zodErrorInstance = new ZodError([
        {
          code: ZodIssueCode.too_small,
          minimum: 3,
          type: 'string',
          inclusive: true,
          exact: false,
          message: 'Username must be at least 3 characters long',
          path: ['username'],
        },
      ]);
      const expectedFieldErrors = {
        username: ['Username must be at least 3 characters long'],
      };

      // To trigger the ZodError catch block in the controller,
      // we can mock a call within the try block to throw this error.
      // The conflict check (findFirst) happens before the update.
      // If input is invalid, Zod parsing (done by Fastify typically) would prevent handler execution.
      // However, our controller has a catch for ZodError for robustness,
      // so we simulate an error that might occur *after* initial checks if Zod was used internally.
      (prismaClientMock.user.findFirst as Mock).mockResolvedValue(null); // No conflict
      (prismaClientMock.user.update as Mock).mockRejectedValue(zodErrorInstance);

      // Act
      await AuthControllers.updateUserProfileHandler(mockRequest, mockReply);

      // Assert
      // Since Zod validation is typically handled by Fastify before the handler,
      // the controller's ZodError catch block is more of a fallback.
      // If the error is thrown from prisma.user.update as simulated:
      expect(mockReply.code).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith({
        message: 'Validation error',
        errors: expectedFieldErrors,
      });
      expect(mockRequest.log.error).toHaveBeenCalled();
      // Ensure prisma.user.update was called (and threw the error)
      expect(prismaClientMock.user.update).toHaveBeenCalled();
    });

    it('should handle Prisma unique constraint violation (P2002) during update by returning 409', async () => {
      // Arrange
      const input = { username: 'newUsernameAttempt' };
      mockRequest.body = input;
      mockRequest.user = {
        id: 'user-id-for-update',
        username: 'originalUser',
        email: 'original@example.com',
      };

      // Simulate no conflict found initially
      (prismaClientMock.user.findFirst as Mock).mockResolvedValue(null);

      // Simulate PrismaClientKnownRequestError with code P2002 during update
      const prismaError = new PrismaMockedNamespace.PrismaClientKnownRequestError(
        'Unique constraint failed on update',
        {
          code: 'P2002',
          clientVersion: 'mock-client-version-p2002',
          meta: { target: ['username'] },
        }, // Example meta
      );
      (prismaClientMock.user.update as Mock).mockRejectedValue(prismaError);

      // Act
      await AuthControllers.updateUserProfileHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.user.findFirst).toHaveBeenCalled(); // Initial conflict check
      expect(prismaClientMock.user.update).toHaveBeenCalledWith({
        where: { id: mockRequest.user.id },
        data: input,
        select: { id: true, username: true, email: true, createdAt: true, updatedAt: true },
      });
      expect(mockReply.code).toHaveBeenCalledWith(409);
      // The controller sends a generic message for P2002 on update
      expect(mockReply.send).toHaveBeenCalledWith({ message: 'Username or email already taken.' });
      expect(mockRequest.log.warn).toHaveBeenCalledWith(
        { userId: mockRequest.user.id, body: input, prismaCode: 'P2002' },
        'Prisma unique constraint violation during profile update.',
      );
    });

    it('should handle other errors by throwing them', async () => {
      // Arrange
      const input = { username: 'someNewUsername' };
      mockRequest.body = input;
      mockRequest.user = {
        id: 'user-id-for-update',
        username: 'originalUser',
        email: 'original@example.com',
      };
      const genericError = new Error('Unexpected database failure!');

      // Simulate no conflict found initially
      (prismaClientMock.user.findFirst as Mock).mockResolvedValue(null);
      // Simulate the generic error during the update operation
      (prismaClientMock.user.update as Mock).mockRejectedValue(genericError);

      // Act & Assert
      await expect(
        AuthControllers.updateUserProfileHandler(mockRequest, mockReply),
      ).rejects.toThrow(genericError);

      // Verify that the initial findFirst and the update attempt were made
      expect(prismaClientMock.user.findFirst).toHaveBeenCalled();
      expect(prismaClientMock.user.update).toHaveBeenCalledWith({
        where: { id: mockRequest.user.id },
        data: input,
        select: { id: true, username: true, email: true, createdAt: true, updatedAt: true },
      });

      // Ensure no response was sent by this handler
      expect(mockReply.code).not.toHaveBeenCalled();
      expect(mockReply.send).not.toHaveBeenCalled();

      // Verify error logging
      expect(mockRequest.log.error).toHaveBeenCalledWith(
        { error: genericError, userId: mockRequest.user.id, body: input },
        'Error updating user profile',
      );
    });

    it('should allow updating to the same username or email without conflict', async () => {
      // Arrange
      const currentUser = {
        id: 'user-id-for-update',
        username: 'originalUser',
        email: 'original@example.com',
      };
      mockRequest.user = currentUser;
      // Input is the same as current user's details
      const input = { username: currentUser.username, email: currentUser.email };
      mockRequest.body = input;

      const now = new Date();
      const expectedUpdatedUser = {
        // Prisma update would still return the user
        id: currentUser.id,
        username: currentUser.username,
        email: currentUser.email,
        createdAt: now, // Assuming these are returned by prisma.update
        updatedAt: now,
      };

      // Crucially, the conflict check should find no *other* user
      (prismaClientMock.user.findFirst as Mock).mockResolvedValue(null);
      (prismaClientMock.user.update as Mock).mockResolvedValue(expectedUpdatedUser);

      // Act
      await AuthControllers.updateUserProfileHandler(mockRequest, mockReply);

      // Assert
      // Verify the conflict check was made (and correctly found no other conflicting user)
      expect(prismaClientMock.user.findFirst).toHaveBeenCalledWith({
        where: {
          AND: [
            { NOT: { id: currentUser.id } },
            { OR: [{ username: input.username }, { email: input.email }] },
          ],
        },
      });
      // Verify the update was called (even if it's a no-op for the data)
      expect(prismaClientMock.user.update).toHaveBeenCalledWith({
        where: { id: currentUser.id },
        data: input,
        select: { id: true, username: true, email: true, createdAt: true, updatedAt: true },
      });
      expect(mockReply.code).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalledWith({
        ...expectedUpdatedUser,
        createdAt: expectedUpdatedUser.createdAt.toISOString(),
        updatedAt: expectedUpdatedUser.updatedAt.toISOString(),
      });
      expect(mockRequest.log.info).toHaveBeenCalledWith(
        { userId: currentUser.id, updatedFields: input },
        'User profile updated successfully.',
      );
    });

    it('should handle empty payload (no fields to update) gracefully', async () => {
      // Arrange
      const currentUser = {
        id: 'user-id-for-update',
        username: 'originalUser',
        email: 'original@example.com',
      };
      mockRequest.user = currentUser;
      const input = {}; // Empty payload
      mockRequest.body = input;

      const now = new Date();
      // Prisma update with empty data would still return the user, potentially with an updated 'updatedAt'
      const userAsReturnedByPrisma = {
        id: currentUser.id,
        username: currentUser.username,
        email: currentUser.email,
        createdAt: now, // Or original createdAt if not changed
        updatedAt: now, // This would likely be updated by Prisma
      };

      // The conflict check (findFirst) should NOT be called if dataToUpdate is empty
      // because conflictQueryParts will be empty.
      (prismaClientMock.user.update as Mock).mockResolvedValue(userAsReturnedByPrisma);

      // Act
      await AuthControllers.updateUserProfileHandler(mockRequest, mockReply);

      // Assert
      expect(mockRequest.log.info).toHaveBeenCalledWith(
        { userId: currentUser.id },
        'Profile update attempt with empty payload.',
      );
      // Ensure the conflict check (findFirst) was NOT called for an empty payload
      expect(prismaClientMock.user.findFirst).not.toHaveBeenCalled();

      // Ensure prisma.user.update was called (Prisma handles empty data gracefully)
      expect(prismaClientMock.user.update).toHaveBeenCalledWith({
        where: { id: currentUser.id },
        data: {}, // Empty data
        select: { id: true, username: true, email: true, createdAt: true, updatedAt: true },
      });

      expect(mockReply.code).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalledWith({
        ...userAsReturnedByPrisma,
        createdAt: userAsReturnedByPrisma.createdAt.toISOString(),
        updatedAt: userAsReturnedByPrisma.updatedAt.toISOString(),
      });
      // The second log.info for successful update should also be called
      expect(mockRequest.log.info).toHaveBeenCalledWith(
        { userId: currentUser.id, updatedFields: input }, // updatedFields will be {}
        'User profile updated successfully.',
      );
    });
  });

  // --- changePasswordHandler ---
  describe('changePasswordHandler', () => {
    beforeEach(() => {
      mockRequest.user = { id: 'user-id-123', username: 'testuser', email: 'test@example.com' };
    });

    it('should change user password successfully', async () => {
      // Arrange
      const input = {
        currentPassword: 'OldPassword123!',
        newPassword: 'NewStrongPassword456!',
      };
      mockRequest.body = input;

      const mockUserFromDb = {
        id: mockRequest.user.id,
        passwordHash: 'hashedOldPassword',
        // other user fields if needed by controller logic, but not for this path
      };
      const mockNewHashedPassword = 'hashedNewPassword';

      (prismaClientMock.user.findUnique as Mock).mockResolvedValue(mockUserFromDb);
      (HashUtils.comparePasswords as Mock).mockResolvedValue(true); // Current password matches
      (HashUtils.hashPassword as Mock).mockResolvedValue(mockNewHashedPassword);
      // prisma.user.update for password change doesn't need to return a specific value for this test,
      // but we can mock it to resolve to signify success.
      (prismaClientMock.user.update as Mock).mockResolvedValue({});

      // Act
      await AuthControllers.changePasswordHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockRequest.user.id },
      });
      expect(HashUtils.comparePasswords).toHaveBeenCalledWith(
        input.currentPassword,
        mockUserFromDb.passwordHash,
      );
      expect(HashUtils.hashPassword).toHaveBeenCalledWith(input.newPassword);
      expect(prismaClientMock.user.update).toHaveBeenCalledWith({
        where: { id: mockRequest.user.id },
        data: { passwordHash: mockNewHashedPassword },
      });
      expect(mockReply.code).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalledWith({ message: 'Password changed successfully.' });
      expect(mockRequest.log.info).toHaveBeenCalledWith(
        { userId: mockRequest.user.id },
        'User password changed successfully.',
      );
    });

    it('should return 404 if authenticated user is not found in DB (should not happen)', async () => {
      // Arrange
      const input = {
        currentPassword: 'OldPassword123!',
        newPassword: 'NewStrongPassword456!',
      };
      mockRequest.body = input;
      // mockRequest.user is set by beforeEach

      (prismaClientMock.user.findUnique as Mock).mockResolvedValue(null); // Simulate user not found

      // Act
      await AuthControllers.changePasswordHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockRequest.user.id },
      });
      expect(mockReply.code).toHaveBeenCalledWith(404);
      expect(mockReply.send).toHaveBeenCalledWith({ message: 'User not found.' }); // Matches controller message
      expect(HashUtils.comparePasswords).not.toHaveBeenCalled();
      expect(HashUtils.hashPassword).not.toHaveBeenCalled();
      expect(prismaClientMock.user.update).not.toHaveBeenCalled();
      // No specific log for this path in the controller, besides the generic error log if it throws later
    });

    it('should return 401 if current password is invalid', async () => {
      // Arrange
      const input = {
        currentPassword: 'WrongOldPassword123!',
        newPassword: 'NewStrongPassword456!',
      };
      mockRequest.body = input;
      // mockRequest.user is set by beforeEach

      const mockUserFromDb = {
        id: mockRequest.user.id,
        passwordHash: 'hashedCorrectOldPassword',
      };

      (prismaClientMock.user.findUnique as Mock).mockResolvedValue(mockUserFromDb);
      (HashUtils.comparePasswords as Mock).mockResolvedValue(false); // Current password does NOT match

      // Act
      await AuthControllers.changePasswordHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockRequest.user.id },
      });
      expect(HashUtils.comparePasswords).toHaveBeenCalledWith(
        input.currentPassword,
        mockUserFromDb.passwordHash,
      );
      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({ message: 'Invalid current password.' }); // Matches controller message
      expect(HashUtils.hashPassword).not.toHaveBeenCalled();
      expect(prismaClientMock.user.update).not.toHaveBeenCalled();
      // No specific log for this path in the controller, besides the generic error log if it throws later
    });

    it('should handle ZodError for invalid input by returning 400', async () => {
      // Arrange
      const input = {
        currentPassword: 'OldPassword123!',
        newPassword: 'short', // Invalid: new password too short
      };
      mockRequest.body = input;
      // mockRequest.user is set by beforeEach

      const fieldErrors = {
        newPassword: ['New password must be at least 8 characters long'], // From changePasswordSchema
      };
      const zodErrorInstance = new ZodError([
        {
          code: ZodIssueCode.too_small,
          minimum: 8,
          type: 'string',
          inclusive: true,
          exact: false,
          message: 'New password must be at least 8 characters long',
          path: ['newPassword'],
        },
      ]);

      // Simulate ZodError being thrown. In a real scenario, Fastify's schema validation
      // would likely catch this before the handler. To test the handler's catch block:
      (prismaClientMock.user.findUnique as Mock).mockRejectedValue(zodErrorInstance);

      // Act
      await AuthControllers.changePasswordHandler(mockRequest, mockReply);

      // Assert
      expect(mockReply.code).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith({
        message: 'Validation error',
        errors: fieldErrors,
      });
      expect(mockRequest.log.error).toHaveBeenCalled();
      expect(HashUtils.comparePasswords).not.toHaveBeenCalled();
      expect(HashUtils.hashPassword).not.toHaveBeenCalled();
      expect(prismaClientMock.user.update).not.toHaveBeenCalled();
    });

    it('should handle other errors by throwing them', async () => {
      // Arrange
      const input = {
        currentPassword: 'OldPassword123!',
        newPassword: 'NewStrongPassword456!',
      };
      mockRequest.body = input;
      // mockRequest.user is set by beforeEach
      const genericError = new Error('Failed to connect to hashing service!');

      // Simulate error during password comparison or hashing
      // Let's say findUnique succeeds, but comparePasswords throws
      const mockUserFromDb = { id: mockRequest.user.id, passwordHash: 'hashedOldPassword' };
      (prismaClientMock.user.findUnique as Mock).mockResolvedValue(mockUserFromDb);
      (HashUtils.comparePasswords as Mock).mockRejectedValue(genericError);

      // Act & Assert
      await expect(AuthControllers.changePasswordHandler(mockRequest, mockReply)).rejects.toThrow(
        genericError,
      );

      expect(prismaClientMock.user.findUnique).toHaveBeenCalled();
      expect(HashUtils.comparePasswords).toHaveBeenCalled(); // It was called and threw
      expect(mockReply.code).not.toHaveBeenCalled();
      expect(mockReply.send).not.toHaveBeenCalled();
      expect(HashUtils.hashPassword).not.toHaveBeenCalled();
      expect(prismaClientMock.user.update).not.toHaveBeenCalled();
      expect(mockRequest.log.error).toHaveBeenCalledWith(
        { error: genericError, userId: mockRequest.user.id },
        'Error changing user password',
      );
    });
  });

  // --- getSavedEventsHandler ---
  // (ENSURE THIS IS THE ONLY describe BLOCK FOR getSavedEventsHandler)
  describe('getSavedEventsHandler', () => {
    beforeEach(() => {
      // This is where mockRequest.user should be set.
      // Ensure mockRequest itself is the correct, shared instance.
      mockRequest.user = { id: 'user-id-123', username: 'testuser', email: 'test@example.com' };
      mockRequest.log = {
        // Make sure log is also initialized if controller uses it early
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnThis(),
      } as any;
      mockReply.code.mockClear();
      mockReply.send.mockClear();
    });

    it('should return a list of saved events for the authenticated user', async () => {
      // Arrange
      const now = new Date();
      const eventDate1 = new Date(now);
      eventDate1.setDate(now.getDate() + 5);
      const eventDate2 = new Date(now);
      eventDate2.setDate(now.getDate() + 10);

      const mockPrismaEvent1 = {
        id: 'event-id-1',
        userId: 'user-id-other',
        title: 'Test Event 1',
        description: 'Description 1',
        eventDate: eventDate1,
        eventTime: '10:00:00',
        locationDescription: 'Location 1',
        organizerName: 'Organizer 1',
        category: 'Tech',
        tags: ['api', 'code'],
        websiteUrl: 'http://example.com/event1',
        createdAt: now,
        updatedAt: now,
        _count: { savedByUsers: 1 },
        isSavedByCurrentUser: undefined,
      };
      const mockPrismaEvent2 = {
        id: 'event-id-2',
        userId: 'user-id-other-2',
        title: 'Test Event 2',
        description: 'Description 2',
        eventDate: eventDate2,
        eventTime: '14:00:00',
        locationDescription: 'Location 2',
        organizerName: 'Organizer 2',
        category: 'Music',
        tags: ['live', 'concert'],
        websiteUrl: 'http://example.com/event2',
        createdAt: now,
        updatedAt: now,
        _count: { savedByUsers: 5 },
        isSavedByCurrentUser: undefined,
      };

      const mockUserSavedEventsRelations = [
        {
          userId: mockRequest.user.id,
          eventId: 'event-id-1',
          savedAt: now,
          event: mockPrismaEvent1,
        },
        {
          userId: mockRequest.user.id,
          eventId: 'event-id-2',
          savedAt: now,
          event: mockPrismaEvent2,
        },
      ];

      // Define the expected transformed structure more completely
      const mockApiEvent1Full = {
        id: 'event-id-1',
        userId: 'user-id-other',
        title: 'Test Event 1',
        description: 'Description 1',
        eventDate: eventDate1.toISOString().split('T')[0],
        eventTime: '10:00:00',
        locationDescription: 'Location 1',
        organizerName: 'Organizer 1',
        category: 'Tech',
        tags: ['api', 'code'],
        websiteUrl: 'http://example.com/event1',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        isSavedByCurrentUser: true,
        savesCount: 1,
      };
      const mockApiEvent2Full = {
        id: 'event-id-2',
        userId: 'user-id-other-2',
        title: 'Test Event 2',
        description: 'Description 2',
        eventDate: eventDate2.toISOString().split('T')[0],
        eventTime: '14:00:00',
        locationDescription: 'Location 2',
        organizerName: 'Organizer 2',
        category: 'Music',
        tags: ['live', 'concert'],
        websiteUrl: 'http://example.com/event2',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        isSavedByCurrentUser: true,
        savesCount: 5,
      };

      (prismaClientMock.userSavedEvent.findMany as Mock).mockResolvedValue(
        mockUserSavedEventsRelations,
      );
      (EventTransformers.transformEventForApi as Mock).mockImplementation(
        (event: any, currentUserId?: string) => {
          console.log(
            `[DEBUG] transformEventForApi mock called. Event ID: ${event?.id}, Received currentUserId: ${currentUserId}`,
          );
          if (event.id === 'event-id-1') return mockApiEvent1Full;
          if (event.id === 'event-id-2') return mockApiEvent2Full;
          return null;
        },
      );

      // Act
      await AuthControllers.getSavedEventsHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.userSavedEvent.findMany).toHaveBeenCalledWith({
        where: { userId: mockRequest.user.id },
        include: { event: { select: EventTransformers.commonEventSelect } },
        orderBy: { savedAt: 'desc' },
      });
      expect(EventTransformers.transformEventForApi).toHaveBeenCalledTimes(2);

      const transformCalls = (EventTransformers.transformEventForApi as Mock).mock.calls;

      // Check the first call - only one argument expected
      expect(transformCalls[0][0].id).toBe(mockPrismaEvent1.id);
      expect(transformCalls[0].length).toBe(1); // Ensure only one argument was passed

      // Check the second call - only one argument expected
      expect(transformCalls[1][0].id).toBe(mockPrismaEvent2.id);
      expect(transformCalls[1].length).toBe(1); // Ensure only one argument was passed

      expect(mockReply.code).toHaveBeenCalledWith(200);
      // The response should reflect that these events are saved by the current user.
      // This means either the mock for transformEventForApi sets it, or the controller would.
      // For this test, we'll make the mock set it.
      const expectedResponseEvent1 = {
        ...mockApiEvent1Full,
        isSavedByCurrentUser: true,
        savesCount: mockPrismaEvent1._count.savedByUsers,
      };
      const expectedResponseEvent2 = {
        ...mockApiEvent2Full,
        isSavedByCurrentUser: true,
        savesCount: mockPrismaEvent2._count.savedByUsers,
      };

      expect(mockReply.send).toHaveBeenCalledWith({
        events: [
          expect.objectContaining(expectedResponseEvent1),
          expect.objectContaining(expectedResponseEvent2),
        ],
      });
    });

    it('should return an empty list if user has no saved events', async () => {
      // Arrange
      // mockRequest.user is set by beforeEach

      // Simulate prisma.userSavedEvent.findMany returning an empty array
      (prismaClientMock.userSavedEvent.findMany as Mock).mockResolvedValue([]);

      // Act
      await AuthControllers.getSavedEventsHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.userSavedEvent.findMany).toHaveBeenCalledWith({
        where: { userId: mockRequest.user.id },
        include: { event: { select: EventTransformers.commonEventSelect } },
        orderBy: { savedAt: 'desc' },
      });

      // transformEventForApi should not have been called if there are no saved events
      expect(EventTransformers.transformEventForApi).not.toHaveBeenCalled();

      expect(mockReply.code).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalledWith({
        events: [], // Expect an empty array for events
      });

      expect(mockRequest.log.info).toHaveBeenCalledWith(
        { userId: mockRequest.user.id, relationsCount: 0 },
        'Fetched savedEventsRelations.',
      );
      expect(mockRequest.log.info).toHaveBeenCalledWith(
        { userId: mockRequest.user.id, eventsForApiCount: 0 },
        'Constructed eventsForApi.',
      );
    });

    it('should handle cases where a saved event relation points to a non-existent event', async () => {
      // Arrange
      const now = new Date();
      const eventDateValid = new Date(now);
      eventDateValid.setDate(now.getDate() + 7);

      const mockValidPrismaEvent = {
        id: 'valid-event-id-1',
        userId: 'user-id-other',
        title: 'Valid Test Event',
        description: 'Valid Description',
        eventDate: eventDateValid,
        eventTime: '12:00:00',
        locationDescription: 'Valid Location',
        organizerName: 'Valid Organizer',
        category: 'Valid Category',
        tags: ['valid', 'test'],
        websiteUrl: 'http://example.com/valid',
        createdAt: now,
        updatedAt: now,
        _count: { savedByUsers: 1 },
        // isSavedByCurrentUser: undefined, // This field is not on PrismaEventType
      };

      const mockUserSavedEventsRelations = [
        {
          userId: mockRequest.user.id,
          eventId: 'valid-event-id-1',
          savedAt: now,
          event: mockValidPrismaEvent,
        },
        {
          userId: mockRequest.user.id,
          eventId: 'non-existent-event-id',
          savedAt: now,
          event: null,
        }, // Relation to a non-existent event
      ];

      const mockApiValidEvent = {
        id: 'valid-event-id-1',
        title: 'Valid Test Event',
        // ... other transformed fields from your actual transformEventForApi for mockValidPrismaEvent
        // For this test, we assume the controller will add isSavedByCurrentUser: true
        // and transformEventForApi (mocked) will provide savesCount
        isSavedByCurrentUser: true, // This will be added by the controller or test mock logic
        savesCount: 1,
        // Ensure all fields returned by your transformEventForApi mock are here
        userId: mockValidPrismaEvent.userId,
        description: mockValidPrismaEvent.description,
        eventDate: mockValidPrismaEvent.eventDate.toISOString().split('T')[0],
        eventTime: mockValidPrismaEvent.eventTime,
        locationDescription: mockValidPrismaEvent.locationDescription,
        organizerName: mockValidPrismaEvent.organizerName,
        category: mockValidPrismaEvent.category,
        tags: mockValidPrismaEvent.tags,
        websiteUrl: mockValidPrismaEvent.websiteUrl,
        createdAt: mockValidPrismaEvent.createdAt.toISOString(),
        updatedAt: mockValidPrismaEvent.updatedAt.toISOString(),
      };

      (prismaClientMock.userSavedEvent.findMany as Mock).mockResolvedValue(
        mockUserSavedEventsRelations,
      );
      // Mock transformEventForApi to only be called for the valid event
      // and to return the structure that includes savesCount.
      (EventTransformers.transformEventForApi as Mock).mockImplementation(
        (event: any /*, currentUserId?: string */) => {
          // currentUserId is not passed by controller
          if (event.id === 'valid-event-id-1') {
            // Simulate what the real transformEventForApi would do,
            // especially regarding savesCount if _count is available.
            return {
              ...mockApiValidEvent, // Use the more complete definition
              savesCount: event._count?.savedByUsers ?? 0,
              // isSavedByCurrentUser will be handled by the controller or test assertion logic
            };
          }
          return null; // Should not be called for the null event
        },
      );

      // Act
      await AuthControllers.getSavedEventsHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.userSavedEvent.findMany).toHaveBeenCalledWith({
        where: { userId: mockRequest.user.id },
        include: { event: { select: EventTransformers.commonEventSelect } },
        orderBy: { savedAt: 'desc' },
      });

      // transformEventForApi should only be called for the valid event
      expect(EventTransformers.transformEventForApi).toHaveBeenCalledTimes(1);
      expect(EventTransformers.transformEventForApi).toHaveBeenCalledWith(mockValidPrismaEvent);

      // Check for the warning log
      expect(mockRequest.log.warn).toHaveBeenCalledWith(
        { savedEventUserId: mockRequest.user.id, savedEventEventId: 'non-existent-event-id' },
        'UserSavedEvent found with a missing/null associated event. Skipping.',
      );

      expect(mockReply.code).toHaveBeenCalledWith(200);
      // The response should only contain the valid event, and it should have isSavedByCurrentUser: true
      // (assuming the controller or test logic ensures this for saved events)
      const expectedSentEvent = {
        ...mockApiValidEvent, // This already has isSavedByCurrentUser: true and savesCount from its definition
      };
      expect(mockReply.send).toHaveBeenCalledWith({
        events: [expect.objectContaining(expectedSentEvent)],
      });

      expect(mockRequest.log.info).toHaveBeenCalledWith(
        { userId: mockRequest.user.id, relationsCount: 2 }, // Fetched 2 relations
        'Fetched savedEventsRelations.',
      );
      expect(mockRequest.log.info).toHaveBeenCalledWith(
        { userId: mockRequest.user.id, eventsForApiCount: 1 }, // Constructed 1 event for API
        'Constructed eventsForApi.',
      );
    });

    it('should handle errors during event transformation and return successfully transformed events', async () => {
      // Arrange
      const now = new Date();
      const eventDate1 = new Date(now);
      eventDate1.setDate(now.getDate() + 5);
      const eventDate2 = new Date(now);
      eventDate2.setDate(now.getDate() + 10);

      const mockPrismaEventOK = {
        id: 'event-ok-id',
        userId: 'user-other-1',
        title: 'OK Event',
        description: 'This event is fine',
        eventDate: eventDate1,
        eventTime: '10:00:00',
        locationDescription: 'Location OK',
        organizerName: 'Organizer OK',
        category: 'Tech',
        tags: ['ok'],
        websiteUrl: 'http://example.com/ok',
        createdAt: now,
        updatedAt: now,
        _count: { savedByUsers: 1 },
      };
      const mockPrismaEventFail = {
        id: 'event-fail-id',
        userId: 'user-other-2',
        title: 'Fail Event',
        description: 'This event will fail transformation',
        eventDate: eventDate2,
        eventTime: '14:00:00',
        locationDescription: 'Location Fail',
        organizerName: 'Organizer Fail',
        category: 'Music',
        tags: ['fail'],
        websiteUrl: 'http://example.com/fail',
        createdAt: now,
        updatedAt: now,
        _count: { savedByUsers: 2 },
      };

      const mockUserSavedEventsRelations = [
        {
          userId: mockRequest.user.id,
          eventId: 'event-ok-id',
          savedAt: now,
          event: mockPrismaEventOK,
        },
        {
          userId: mockRequest.user.id,
          eventId: 'event-fail-id',
          savedAt: now,
          event: mockPrismaEventFail,
        },
      ];

      const mockApiEventOK = {
        id: 'event-ok-id',
        title: 'OK Event',
        // ... other transformed fields for mockPrismaEventOK
        isSavedByCurrentUser: true, // Assuming controller/test logic adds this
        savesCount: 1,
        userId: mockPrismaEventOK.userId,
        description: mockPrismaEventOK.description,
        eventDate: mockPrismaEventOK.eventDate.toISOString().split('T')[0],
        eventTime: mockPrismaEventOK.eventTime,
        locationDescription: mockPrismaEventOK.locationDescription,
        organizerName: mockPrismaEventOK.organizerName,
        category: mockPrismaEventOK.category,
        tags: mockPrismaEventOK.tags,
        websiteUrl: mockPrismaEventOK.websiteUrl,
        createdAt: mockPrismaEventOK.createdAt.toISOString(),
        updatedAt: mockPrismaEventOK.updatedAt.toISOString(),
      };

      const transformationError = new Error('Failed to transform event data');

      (prismaClientMock.userSavedEvent.findMany as Mock).mockResolvedValue(
        mockUserSavedEventsRelations,
      );

      (EventTransformers.transformEventForApi as Mock).mockImplementation((event: any) => {
        if (event.id === 'event-ok-id') {
          return { ...mockApiEventOK, savesCount: event._count?.savedByUsers ?? 0 };
        }
        if (event.id === 'event-fail-id') {
          throw transformationError;
        }
        return null;
      });

      // Act
      await AuthControllers.getSavedEventsHandler(mockRequest, mockReply);

      // Assert
      expect(prismaClientMock.userSavedEvent.findMany).toHaveBeenCalledWith({
        where: { userId: mockRequest.user.id },
        include: { event: { select: EventTransformers.commonEventSelect } },
        orderBy: { savedAt: 'desc' },
      });

      expect(EventTransformers.transformEventForApi).toHaveBeenCalledTimes(2);
      expect(EventTransformers.transformEventForApi).toHaveBeenCalledWith(mockPrismaEventOK);
      expect(EventTransformers.transformEventForApi).toHaveBeenCalledWith(mockPrismaEventFail);

      // Check for the error log for the failed transformation
      expect(mockRequest.log.error).toHaveBeenCalledWith(
        {
          savedEventUserId: mockRequest.user.id,
          savedEventEventId: 'event-fail-id',
          error: transformationError,
        },
        'Error transforming event in getSavedEventsHandler. Skipping.',
      );

      expect(mockReply.code).toHaveBeenCalledWith(200);
      // The response should only contain the successfully transformed event
      const expectedSentEventOK = {
        ...mockApiEventOK, // This already has isSavedByCurrentUser: true and savesCount from its definition
      };
      expect(mockReply.send).toHaveBeenCalledWith({
        events: [expect.objectContaining(expectedSentEventOK)],
      });

      expect(mockRequest.log.info).toHaveBeenCalledWith(
        { userId: mockRequest.user.id, relationsCount: 2 }, // Fetched 2 relations
        'Fetched savedEventsRelations.',
      );
      expect(mockRequest.log.info).toHaveBeenCalledWith(
        { userId: mockRequest.user.id, eventsForApiCount: 1 }, // Constructed 1 event for API
        'Constructed eventsForApi.',
      );
    });

    it('should handle other errors by throwing them', async () => {
      // Arrange
      // mockRequest.user is set by beforeEach
      const genericError = new Error('Database connection failed unexpectedly');

      // Simulate prisma.userSavedEvent.findMany throwing an error
      (prismaClientMock.userSavedEvent.findMany as Mock).mockRejectedValue(genericError);

      // Act & Assert
      await expect(AuthControllers.getSavedEventsHandler(mockRequest, mockReply)).rejects.toThrow(
        genericError,
      );

      // Verify that the attempt to fetch saved events was made
      expect(prismaClientMock.userSavedEvent.findMany).toHaveBeenCalledWith({
        where: { userId: mockRequest.user.id },
        include: { event: { select: EventTransformers.commonEventSelect } },
        orderBy: { savedAt: 'desc' },
      });

      // transformEventForApi should not have been called
      expect(EventTransformers.transformEventForApi).not.toHaveBeenCalled();

      // The reply should not have been sent by this handler as it threw an error
      expect(mockReply.code).not.toHaveBeenCalled();
      expect(mockReply.send).not.toHaveBeenCalled();

      // Check for the critical error log
      expect(mockRequest.log.error).toHaveBeenCalledWith(
        { error: genericError, userId: mockRequest.user.id },
        'CRITICAL Error in getSavedEventsHandler outer catch block',
      );
    });
  });
});
