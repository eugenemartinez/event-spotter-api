import { FastifyError, FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { ZodError, ZodIssue } from 'zod'; // Import ZodIssue
import { Prisma } from '@prisma/client';

// Helper function to transform Fastify's validation errors (from Zod) into fieldErrors format
function transformFastifyZodValidationToFieldErrors(
  validationErrors: any[],
): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  if (Array.isArray(validationErrors)) {
    for (const err of validationErrors) {
      // The actual structure of `err` when Zod is used via setValidatorCompiler
      // might be directly ZodIssue-like or wrapped.
      // We need to inspect `err.params.issue` or `err` itself.
      // Based on typical Fastify + Zod setups, `err.params.issue` is common.
      const issue: ZodIssue | undefined = err.params?.issue || (err as ZodIssue);

      if (issue && Array.isArray(issue.path) && issue.path.length > 0) {
        const fieldName = issue.path.join('.'); // For nested paths, though likely flat here
        if (!fieldErrors[fieldName]) {
          fieldErrors[fieldName] = [];
        }
        fieldErrors[fieldName].push(issue.message);
      } else if (issue && issue.message) {
        // Fallback for non-path-specific Zod issues, though less common for body validation
        const generalField = '_general';
        if (!fieldErrors[generalField]) {
          fieldErrors[generalField] = [];
        }
        fieldErrors[generalField].push(issue.message);
      }
    }
  }
  return fieldErrors;
}

export function registerErrorHandler(server: FastifyInstance): void {
  server.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const { validation, statusCode } = error;
    const isProduction = process.env.NODE_ENV === 'production';

    // SIMPLIFIED LOGGING FOR FST_ERR_RESPONSE_SERIALIZATION
    if (error.code === 'FST_ERR_RESPONSE_SERIALIZATION') {
      request.log.error(
        {
          message: 'FST_ERR_RESPONSE_SERIALIZATION encountered',
          errorCode: error.code,
          errorName: error.name,
          errorMessage: error.message,
          errorStack: error.stack,
          // Log the entire error object to see all its properties, including a potential 'cause'
          fullErrorObject: error,
        },
        'Detailed log for FST_ERR_RESPONSE_SERIALIZATION',
      );
    } else {
      // Original detailed logging for other errors
      request.log.error(
        {
          err: {
            message: error.message,
            stack: error.stack,
            name: error.name,
            code: error.code,
            statusCode: statusCode,
            validation: validation,
          },
          requestId: request.id,
          method: request.method,
          url: request.url,
        },
        `Error caught by errorHandler.ts: ${error.message}`,
      );
    }

    // Handle ZodError instances directly
    if (error instanceof ZodError) {
      request.log.warn(
        { err: error.flatten(), details: error.issues },
        'Direct ZodError instance caught by errorHandler.ts',
      );
      return reply.status(400).send({
        message: 'Input validation failed',
        errors: error.flatten().fieldErrors,
      });
    }

    // Handle Fastify's FST_ERR_VALIDATION
    if (error.code === 'FST_ERR_VALIDATION' && validation) {
      request.log.warn(
        {
          err: {
            message: error.message,
            code: error.code,
            statusCode: error.statusCode,
            validationContext: (error as any).validationContext,
            validation: (error as any).validation,
            // Corrected conditional spread for cause
            ...(error.code === 'FST_ERR_VALIDATION' && error.cause ? { cause: error.cause } : {}),
          },
        },
        'Fastify FST_ERR_VALIDATION (likely Zod-originated) caught by errorHandler.ts',
      );

      const fieldErrors = transformFastifyZodValidationToFieldErrors(validation as any[]);

      return reply.status(400).send({
        message: 'Input validation failed',
        errors: fieldErrors,
      });
    }

    // Handle Prisma-specific errors (as before)
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      request.log.warn(
        { err: error },
        `PrismaClientKnownRequestError in errorHandler.ts: ${error.code}`,
      );
      if (error.code === 'P2002') {
        const target = (error.meta?.target as string[])?.join(', ');
        return reply.status(409).send({
          message: `User with this username or email already exists`, // Keep this message consistent with test
        });
      }
      if (error.code === 'P2025') {
        return reply.status(404).send({
          // statusCode: 404,
          // error: "Not Found",
          message: (error.meta?.cause as string) || 'The requested resource was not found.',
        });
      }
      if (error.code === 'P2003') {
        const fieldName = (error.meta?.field_name as string) || 'related resource';
        return reply.status(400).send({
          // statusCode: 400,
          // error: "Bad Request",
          message: `Invalid input: The specified ${fieldName} does not exist.`,
        });
      }
      // Fallback for other Prisma known errors
      return reply
        .status(500)
        .send({ message: 'A database error occurred processing your request.' });
    }

    // Handle errors with a specific statusCode (e.g., from @fastify/sensible)
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        // statusCode: statusCode,
        // error: error.name || "Client Error", // error.name can be too generic like "Error"
        message: error.message,
      });
    }

    // Default to 500 Internal Server Error
    const responseMessage = isProduction
      ? 'An unexpected error occurred on the server.'
      : error.message;
    const errorName = isProduction
      ? 'Internal Server Error'
      : error.name || 'Internal Server Error';
    // Ensure statusCode is a valid HTTP status code, default to 500
    const finalStatusCode =
      typeof statusCode === 'number' && statusCode >= 100 && statusCode <= 599 ? statusCode : 500;

    reply.status(finalStatusCode).send({
      // statusCode: finalStatusCode,
      // error: errorName, // Message is often sufficient
      message: responseMessage,
      ...(!isProduction && error.stack && { stackTraceHint: 'Stack available in server logs.' }), // Don't send full stack to client
    });
  });

  server.log.info('Global error handler registered from errorHandler.ts.');
}
