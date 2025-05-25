import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError, ZodIssue, ZodInvalidStringIssue, ZodTooSmallIssue } from 'zod';
import { Prisma } from '@prisma/client';
import { registerErrorHandler } from './errorHandler';

// Mock Fastify instance and its parts
const mockRequest = {
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
  id: 'test-request-id',
  method: 'GET',
  url: '/test',
} as unknown as FastifyRequest;

// Define an interface for the mocked reply parts to ensure correct types for mocks
interface MockedReply {
  status: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

const mockReplyParts: MockedReply = {
  status: vi.fn().mockReturnThis(),
  send: vi.fn().mockReturnThis(),
};
const mockReply = mockReplyParts as unknown as FastifyReply;

// Define an interface for the mocked server parts
interface MockedServer {
  setErrorHandler: ReturnType<typeof vi.fn>;
  log: {
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
}

const mockServerParts: MockedServer = {
  setErrorHandler: vi.fn(),
  log: {
    info: vi.fn(),
    error: vi.fn(),
  },
};
const mockServer = mockServerParts as unknown as FastifyInstance;

// Helper to get the error handler function
let registeredErrorHandler:
  | ((error: FastifyError | ZodError, request: FastifyRequest, reply: FastifyReply) => void)
  | null = null;

const setupErrorHandler = () => {
  mockServerParts.setErrorHandler.mockClear();
  registerErrorHandler(mockServer);
  if (mockServerParts.setErrorHandler.mock.calls.length > 0) {
    registeredErrorHandler = mockServerParts.setErrorHandler.mock.calls[0][0];
  } else {
    throw new Error('setErrorHandler was not called on mockServer');
  }
};

// Helper to create a mock item for Fastify's validation error array
// This structure needs to provide `params.issue` for `transformFastifyZodValidationToFieldErrors`
interface MockValidationItem {
  params: {
    issue: ZodIssue;
  };
  // Add other properties if your transform function uses them, e.g., message, keyword
  message?: string;
  keyword?: string;
  instancePath?: string;
  schemaPath?: string;
}

const createMockValidationItem = (path: string[], message: string): MockValidationItem => ({
  params: {
    issue: { path, message, code: 'custom' } as ZodIssue, // Ensure message is provided
  },
  message: `Validation failed for ${path.join('.')}`,
  keyword: 'mockKeyword',
  instancePath: `/mockInstancePath/${path.join('/')}`,
  schemaPath: `#/mockSchemaPath/${path.join('/')}`,
});

describe('errorHandler.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupErrorHandler();
  });

  describe('registerErrorHandler', () => {
    it('should register an error handler with the server', () => {
      expect(mockServerParts.setErrorHandler).toHaveBeenCalledTimes(1);
      expect(typeof mockServerParts.setErrorHandler.mock.calls[0][0]).toBe('function');
    });

    describe('Registered Error Handler Logic', () => {
      describe('Direct ZodError Instances', () => {
        it('should handle direct ZodError and return 400 with flattened field errors', () => {
          // Construct objects that conform to ZodIssue, ensuring 'message' is always a string.
          const zodIssues: ZodIssue[] = [
            {
              code: 'invalid_string',
              validation: 'email',
              path: ['email'],
              message: 'Invalid email',
            },
            {
              code: 'too_small',
              minimum: 8,
              type: 'string',
              inclusive: true,
              path: ['password'],
              message: 'Too short',
            },
          ];
          const error = new ZodError(zodIssues);

          registeredErrorHandler!(error, mockRequest, mockReply);

          expect(mockReplyParts.status).toHaveBeenCalledWith(400);
          expect(mockReplyParts.send).toHaveBeenCalledWith({
            message: 'Input validation failed',
            errors: error.flatten().fieldErrors,
          });
          expect(mockRequest.log.warn).toHaveBeenCalled();
        });
      });

      describe('Fastify FST_ERR_VALIDATION', () => {
        it('should handle FST_ERR_VALIDATION and return 400 with transformed field errors', () => {
          const validationError = new Error('Validation failed') as FastifyError;
          validationError.code = 'FST_ERR_VALIDATION';
          validationError.validation = [
            createMockValidationItem(['name'], 'Name is required'),
            createMockValidationItem(['age'], 'Must be a number'),
          ] as any[]; // Cast to any[] as the structure is custom for the test
          validationError.statusCode = 400;

          registeredErrorHandler!(validationError, mockRequest, mockReply);

          expect(mockReplyParts.status).toHaveBeenCalledWith(400);
          expect(mockReplyParts.send).toHaveBeenCalledWith(
            expect.objectContaining({
              message: 'Input validation failed',
              errors: {
                name: ['Name is required'],
                age: ['Must be a number'],
              },
            }),
          );
          expect(mockRequest.log.warn).toHaveBeenCalled();
        });

        it('should handle FST_ERR_VALIDATION with a cause property and log it', () => {
          const causeError = new Error('Underlying cause');
          const validationError = new Error('Validation failed') as FastifyError & {
            cause?: Error;
          };
          validationError.code = 'FST_ERR_VALIDATION';
          validationError.validation = [createMockValidationItem(['field'], 'Error')] as any[];
          validationError.statusCode = 400;
          validationError.cause = causeError;

          registeredErrorHandler!(validationError, mockRequest, mockReply);

          expect(mockRequest.log.warn).toHaveBeenCalledWith(
            expect.objectContaining({
              err: expect.objectContaining({
                cause: causeError,
              }),
            }),
            expect.stringContaining('Fastify FST_ERR_VALIDATION'),
          );
          expect(mockReplyParts.status).toHaveBeenCalledWith(400);
        });

        it('should handle FST_ERR_VALIDATION with a general error (no path in issue)', () => {
          const validationError = new Error('Validation failed') as FastifyError;
          validationError.code = 'FST_ERR_VALIDATION';
          validationError.validation = [
            createMockValidationItem(['name'], 'Name is required'), // Existing style
            // New item to target the else-if block
            {
              params: {
                issue: {
                  path: [],
                  message: 'A general validation error occurred',
                  code: 'custom',
                } as ZodIssue,
              },
              message: 'General error',
              keyword: 'mockKeyword',
              instancePath: '/mockInstancePath/general',
              schemaPath: '#/mockSchemaPath/general',
            } as MockValidationItem, // Using your MockValidationItem type
            {
              params: {
                // Simulate issue without a path property, or path being undefined
                issue: { message: 'Another general error', code: 'custom' } as ZodIssue,
              },
              message: 'Another General error',
              keyword: 'mockKeyword',
              instancePath: '/mockInstancePath/general2',
              schemaPath: '#/mockSchemaPath/general2',
            } as MockValidationItem,
          ] as any[];
          validationError.statusCode = 400;

          registeredErrorHandler!(validationError, mockRequest, mockReply);

          expect(mockReplyParts.status).toHaveBeenCalledWith(400);
          expect(mockReplyParts.send).toHaveBeenCalledWith(
            expect.objectContaining({
              message: 'Input validation failed',
              errors: {
                name: ['Name is required'],
                _general: ['A general validation error occurred', 'Another general error'],
              },
            }),
          );
          expect(mockRequest.log.warn).toHaveBeenCalled();
        });
      });

      // --- Prisma Error Handling ---
      describe('Prisma Errors', () => {
        it('should handle Prisma P2002 (unique constraint) and return 409', () => {
          const error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'x.y.z',
            meta: { target: ['email'] },
          });
          // Cast to FastifyError if the handler's signature expects it,
          // or ensure registeredErrorHandler can take Prisma errors if your handler checks `instanceof Prisma...`
          registeredErrorHandler!(error as FastifyError, mockRequest, mockReply);
          expect(mockReplyParts.status).toHaveBeenCalledWith(409); // Use mockReplyParts
          expect(mockReplyParts.send).toHaveBeenCalledWith({
            message: 'User with this username or email already exists',
          }); // Use mockReplyParts
        });

        it('should handle Prisma P2025 (not found) and return 404 with cause message', () => {
          const error = new Prisma.PrismaClientKnownRequestError('Record not found', {
            code: 'P2025',
            clientVersion: 'x.y.z',
            meta: { cause: 'Event not found.' },
          });
          registeredErrorHandler!(error, mockRequest, mockReply);
          expect(mockReplyParts.status).toHaveBeenCalledWith(404);
          expect(mockReplyParts.send).toHaveBeenCalledWith({ message: 'Event not found.' });
        });

        it('should handle Prisma P2025 (not found) and return 404 with default message if no cause', () => {
          const error = new Prisma.PrismaClientKnownRequestError(
            'Record not found',
            { code: 'P2025', clientVersion: 'x.y.z', meta: {} }, // No cause
          );
          registeredErrorHandler!(error, mockRequest, mockReply);
          expect(mockReplyParts.status).toHaveBeenCalledWith(404);
          expect(mockReplyParts.send).toHaveBeenCalledWith({
            message: 'The requested resource was not found.',
          });
        });

        it('should handle Prisma P2003 (foreign key constraint) and return 400', () => {
          const error = new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
            code: 'P2003',
            clientVersion: 'x.y.z',
            meta: { field_name: 'Event.userId' },
          });
          registeredErrorHandler!(error, mockRequest, mockReply);
          expect(mockReplyParts.status).toHaveBeenCalledWith(400);
          expect(mockReplyParts.send).toHaveBeenCalledWith({
            message: 'Invalid input: The specified Event.userId does not exist.',
          });
        });

        it('should handle Prisma P2003 with default field_name if not provided', () => {
          const error = new Prisma.PrismaClientKnownRequestError(
            'Foreign key constraint failed',
            { code: 'P2003', clientVersion: 'x.y.z', meta: {} }, // No field_name
          );
          registeredErrorHandler!(error, mockRequest, mockReply);
          expect(mockReplyParts.status).toHaveBeenCalledWith(400);
          expect(mockReplyParts.send).toHaveBeenCalledWith({
            message: 'Invalid input: The specified related resource does not exist.',
          });
        });

        it('should handle other Prisma known errors with a generic 500 message', () => {
          const error = new Prisma.PrismaClientKnownRequestError(
            'Some other Prisma error',
            { code: 'P2000', clientVersion: 'x.y.z' }, // Different code
          );
          registeredErrorHandler!(error, mockRequest, mockReply);
          expect(mockReplyParts.status).toHaveBeenCalledWith(500);
          expect(mockReplyParts.send).toHaveBeenCalledWith({
            message: 'A database error occurred processing your request.',
          });
        });
      });

      // --- Generic 4xx Errors ---
      describe('Generic 4xx Errors', () => {
        it('should handle errors with a 4xx statusCode and return it with the error message', () => {
          const error = new Error('Unauthorized access') as FastifyError;
          error.statusCode = 401;
          registeredErrorHandler!(error, mockRequest, mockReply);
          expect(mockReplyParts.status).toHaveBeenCalledWith(401);
          expect(mockReplyParts.send).toHaveBeenCalledWith({ message: 'Unauthorized access' });
        });
      });

      // --- FST_ERR_RESPONSE_SERIALIZATION ---
      describe('FST_ERR_RESPONSE_SERIALIZATION', () => {
        it('should log FST_ERR_RESPONSE_SERIALIZATION with detailed info and return 500', () => {
          const serializationError = new Error('Cannot serialize response') as FastifyError;
          serializationError.code = 'FST_ERR_RESPONSE_SERIALIZATION';
          serializationError.statusCode = 500; // Typically this error implies a 500

          // Simulate production for message check
          const originalEnv = process.env.NODE_ENV;
          process.env.NODE_ENV = 'production';

          registeredErrorHandler!(serializationError, mockRequest, mockReply);

          expect(mockRequest.log.error).toHaveBeenCalledWith(
            expect.objectContaining({
              message: 'FST_ERR_RESPONSE_SERIALIZATION encountered',
              errorCode: 'FST_ERR_RESPONSE_SERIALIZATION',
              fullErrorObject: serializationError,
            }),
            'Detailed log for FST_ERR_RESPONSE_SERIALIZATION',
          );
          expect(mockReplyParts.status).toHaveBeenCalledWith(500);
          expect(mockReplyParts.send).toHaveBeenCalledWith({
            message: 'An unexpected error occurred on the server.',
          });
          process.env.NODE_ENV = originalEnv; // Restore
        });
      });

      // --- Default 500 Error Handling ---
      describe('Default 500 Errors', () => {
        it('should default to 500 for unknown errors (production)', () => {
          const originalEnv = process.env.NODE_ENV;
          process.env.NODE_ENV = 'production';
          const error = new Error('Something broke!') as FastifyError;

          registeredErrorHandler!(error, mockRequest, mockReply);

          expect(mockReplyParts.status).toHaveBeenCalledWith(500);
          expect(mockReplyParts.send).toHaveBeenCalledWith({
            message: 'An unexpected error occurred on the server.',
          });
          process.env.NODE_ENV = originalEnv;
        });

        it('should default to 500 for unknown errors (development) and include message + stack hint', () => {
          const originalEnv = process.env.NODE_ENV;
          process.env.NODE_ENV = 'development';
          const error = new Error('Dev error') as FastifyError;
          error.stack = 'Error: Dev error at some_file.js:123:45';

          registeredErrorHandler!(error, mockRequest, mockReply);

          expect(mockReplyParts.status).toHaveBeenCalledWith(500);
          expect(mockReplyParts.send).toHaveBeenCalledWith({
            message: 'Dev error',
            stackTraceHint: 'Stack available in server logs.',
          });
          process.env.NODE_ENV = originalEnv;
        });

        it('should use error.statusCode if present and valid, otherwise default to 500', () => {
          const error = new Error('Service Unavailable') as FastifyError;
          error.statusCode = 503;
          registeredErrorHandler!(error, mockRequest, mockReply);
          expect(mockReplyParts.status).toHaveBeenCalledWith(503);
          expect(mockReplyParts.send).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Service Unavailable' }),
          );
        });

        it('should default to 500 if error.statusCode is invalid', () => {
          const error = new Error('Bad status') as FastifyError;
          (error as any).statusCode = 'not-a-number'; // Invalid status code
          registeredErrorHandler!(error, mockRequest, mockReply);
          expect(mockReplyParts.status).toHaveBeenCalledWith(500);
        });

        it('should not include stackTraceHint if error.stack is missing (development)', () => {
          const originalEnv = process.env.NODE_ENV;
          process.env.NODE_ENV = 'development';
          const error = new Error('No stack error') as FastifyError;
          (error as any).code = 'UNKNOWN_ERROR_NO_STACK'; // Ensure it's not caught by other specific handlers
          delete error.stack;

          registeredErrorHandler!(error, mockRequest, mockReply);

          expect(mockReplyParts.status).toHaveBeenCalledWith(500);
          const sentObject = mockReplyParts.send.mock.calls[0][0];
          expect(sentObject).toEqual({ message: 'No stack error' });
          expect(sentObject).not.toHaveProperty('stackTraceHint');
          process.env.NODE_ENV = originalEnv;
        });
      });
    });
  });
});
