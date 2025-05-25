import { FastifyError, FastifyRequest, FastifyServerOptions } from 'fastify'; // Import necessary types

const isProduction = process.env.NODE_ENV === 'production';

// Define a minimal type for reply for the serializer, similar to your server.ts
interface MinimalReply {
  statusCode: number;
  [key: string]: any;
}

export const loggerOptions: FastifyServerOptions['logger'] = {
  level: isProduction ? 'info' : 'debug',
  transport: !isProduction
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname,reqId,req,res,responseTime', // Adjusted to match your server.ts
          messageFormat: '{reqId} {msg} {if err}Error: {err.message}{end}{if req}({req.method} {req.url}){end}{if res}({res.statusCode}){end} {if responseTime}- {responseTime}ms{end}', // Adjusted
        },
      }
    : undefined,
  serializers: {
    req(request: FastifyRequest) {
      return {
        method: request.method,
        url: request.url,
        // params: request.params, // Original server.ts had 'parameters'
        parameters: request.params,
        hostname: request.hostname,
        remoteAddress: request.ip,
        remotePort: request.socket?.remotePort,
      };
    },
    res(reply: MinimalReply) { // Use the minimal reply type
      return {
        statusCode: reply.statusCode,
      };
    },
    err(error: FastifyError) {
      return {
        type: error.name,
        message: error.message,
        stack: isProduction ? '' : (error.stack || ''),
        code: error.code || '',
        statusCode: error.statusCode,
        validation: error.validation, // Make sure this aligns with FastifyError type
      };
    },
  },
};

// You can also include other Fastify options here if they are always the same
export const defaultFastifyOptions = {
  requestIdHeader: 'X-Request-Id',
  requestIdLogLabel: 'reqId',
  disableRequestLogging: false,
};