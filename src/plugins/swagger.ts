import { FastifyInstance } from 'fastify';
import fastifySwaggerPlugin from '@fastify/swagger';
import fastifySwaggerUiPlugin, { FastifySwaggerUiOptions } from '@fastify/swagger-ui';
import path from 'path';
import fp from 'fastify-plugin';
import { OpenAPI, OpenAPIV3, OpenAPIV3_1 } from 'openapi-types'; // Import OpenAPI for the union type

async function swaggerSetup(server: FastifyInstance) {
  const port = process.env.PORT || 3000;

  const serverList: OpenAPIV3_1.ServerObject[] = [
    {
      url: `http://127.0.0.1:${port}/api`,
      description: 'Local development server (127.0.0.1)',
    },
    {
      url: `http://localhost:${port}/api`,
      description: 'Local development server (localhost)',
    },
  ];

  const productionBaseUrl = process.env.PUBLIC_DOMAIN_URL;
  let secureProductionApiOrigin = ''; // Variable to store the secure production origin

  if (process.env.NODE_ENV === 'production' && productionBaseUrl) {
    secureProductionApiOrigin = productionBaseUrl.startsWith('http')
      ? productionBaseUrl // Assuming it's already a full origin like https://domain.com
      : `https://${productionBaseUrl}`; // Prepend https if it's just a hostname
    serverList.unshift({
      url: `${secureProductionApiOrigin}/api`,
      description: 'Production server',
    });
  }

  await server.register(fastifySwaggerPlugin, {
    mode: 'static' as const,
    specification: {
      path: path.join(__dirname, '..', '..', 'public', 'openapi.yaml'),
      baseDir: path.join(__dirname, '..', '..', 'public'),
      postProcessor: (swaggerDoc: OpenAPI.Document): OpenAPI.Document => {
        // Type guard to ensure this is an OpenAPI V3.x document
        if ('openapi' in swaggerDoc && swaggerDoc.openapi.startsWith('3.')) {
          // Now it's safe to cast to a V3 document type to access 'servers'
          const v3Doc = swaggerDoc as OpenAPIV3.Document | OpenAPIV3_1.Document;
          v3Doc.servers = serverList;
        }
        return swaggerDoc;
      },
    },
    // exposeRoute: true, // Default is true, can be omitted
  });
  server.log.info('@fastify/swagger (static mode) registered successfully.');

  const localDevApiOrigins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];

  const swaggerUiPluginOptions: FastifySwaggerUiOptions = {
    routePrefix: '/documentation',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
    staticCSP: true,
    transformStaticCSP: (_header) => {
      const connectSrcSources = ["'self'"]; // Always allow 'self'

      if (process.env.NODE_ENV === 'production') {
        // Use the secureProductionApiOrigin derived earlier
        if (secureProductionApiOrigin) {
          connectSrcSources.push(secureProductionApiOrigin);
        }
      } else {
        // For local development, allow connections to local API servers
        connectSrcSources.push(...localDevApiOrigins);
      }

      const cspDirectives = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'", // 'unsafe-inline' is often needed for Swagger UI's inline scripts
        "style-src 'self' https: 'unsafe-inline'", // 'unsafe-inline' for styles, and https: for external fonts if any
        "img-src 'self' data: validator.swagger.io", // Allows Swagger validator badge
        `connect-src ${connectSrcSources.join(' ')}`, // Add other sources here
      ];
      return cspDirectives.join('; ');
    },
  };
  server.log.info('Registering @fastify/swagger-ui');
  await server.register(fastifySwaggerUiPlugin, swaggerUiPluginOptions);
  server.log.info('@fastify/swagger-ui registered successfully.');
}

export default fp(swaggerSetup);
