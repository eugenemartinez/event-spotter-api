# EventSpotter API

A Fastify-based API for managing and discovering events.

## Overview

EventSpotter API provides a backend service for creating, managing, and discovering events. It includes features for user authentication, event creation, event listing with filtering and pagination, and user-specific actions like saving events.

## Features

*   **User Authentication:** Register, login, view/update profile, change password.
*   **Event Management:**
    *   Create, read, update, and delete events (CRUD).
    *   List events with pagination, filtering (category, tags, date range), sorting, and search.
    *   Retrieve unique event categories and tags.
    *   Fetch a random event.
    *   Batch retrieval of events by IDs.
*   **User Actions:** Save and unsave events.
*   **API Documentation:** Interactive API documentation available via Swagger UI.
*   **Rate Limiting:** Basic protection against abuse.
*   **Input Validation:** Using Zod for request validation.

## Technologies Used

*   **Framework:** [Fastify](https://www.fastify.io/)
*   **Database ORM:** [Prisma](https://www.prisma.io/)
*   **Database:** PostgreSQL (compatible)
*   **Caching/Rate Limiting:** Redis (optional, falls back to in-memory)
*   **Authentication:** JSON Web Tokens (JWT)
*   **Validation:** [Zod](https://zod.dev/)
*   **API Specification:** OpenAPI (served via `@fastify/swagger` and `@fastify/swagger-ui`)
*   **Language:** TypeScript

## Prerequisites

*   Node.js (v18.x or later recommended)
*   npm or yarn
*   A running PostgreSQL instance
*   A running Redis instance (optional, for enhanced rate limiting)

## Setup and Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/eugenemartinez/event-spotter-api
    cd event-spotter-api
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    # or
    yarn install
    ```

3.  **Set up environment variables:**
    Create a `.env` file in the root of the project by copying `.env.example` (if you have one, otherwise create it from scratch).
    Fill in the required variables (see [Environment Variables](#environment-variables) section below).

4.  **Generate Prisma Client:**
    ```bash
    npx prisma generate
    ```

5.  **Run database migrations:**
    (Assuming you have migration files created with `prisma migrate dev`)
    ```bash
    npx prisma migrate deploy
    # For development, you might use:
    # npx prisma migrate dev
    ```

## Running the Application

*   **Development Mode (with hot-reloading):**
    ```bash
    npm run dev
    ```
    This typically uses `nodemon` or a similar tool defined in your `package.json`.

*   **Production Mode:**
    ```bash
    npm run build
    npm start
    ```

The API will usually be available at `http://localhost:3000` (or the port specified in your `.env` file).

## Environment Variables

Create a `.env` file in the project root with the following variables:

*   `DATABASE_URL`: Connection string for your PostgreSQL database.
    *   Example: `postgresql://user:password@host:port/database?schema=public`
*   `REDIS_URL`: Connection string for your Redis instance (optional).
    *   Example: `redis://localhost:6379`
*   `JWT_SECRET`: A strong, random string for signing JWTs.
*   `JWT_EXPIRES_IN`: Token expiration time (e.g., `1d`, `7h`, `60m`).
*   `PORT`: The port the application will run on (e.g., `3000`).
*   `NODE_ENV`: Set to `development` or `production`.
*   `CORS_ALLOWED_ORIGINS`: Comma-separated list of allowed origins for CORS (e.g., `http://localhost:3001,https://yourfrontend.com` or `*` to allow all).
*   `PUBLIC_DOMAIN_URL`: The public URL of your deployed API (e.g., `https://event-spotter-api.vercel.app`). Used for generating correct links in responses and documentation.
*   `DEFAULT_RATE_LIMIT_MAX`: (Optional) Max requests for rate limiting.
*   `DEFAULT_RATE_LIMIT_TIME_WINDOW`: (Optional) Time window for rate limiting (e.g., `1 minute`).

## API Endpoints

The API is prefixed with `/api`.

### General

*   `GET /api`: API base information.
*   `GET /api/ping`: Health check endpoint.

### Authentication (`/api/auth`)

*   `POST /register`: Register a new user.
*   `POST /login`: Log in an existing user.
*   `GET /me`: Get current authenticated user's profile.
*   `PATCH /me`: Update current authenticated user's profile.
*   `POST /me/password`: Change current authenticated user's password.
*   `GET /me/saved-events`: Get events saved by the current user.

### Events (`/api/events`)

*   `POST /`: Create a new event (requires authentication).
*   `GET /`: List all events (paginated, filterable, sortable).
*   `GET /random`: Get a single random event.
*   `GET /categories`: Get all unique event categories.
*   `GET /tags`: Get all unique event tags.
*   `POST /batch-get`: Retrieve multiple events by their IDs.
*   `GET /:eventId`: Get a single event by ID.
*   `PATCH /:eventId`: Update an existing event (requires authentication and ownership).
*   `DELETE /:eventId`: Delete an event (requires authentication and ownership).
*   `POST /:eventId/save`: Save an event (requires authentication).
*   `DELETE /:eventId/save`: Unsave an event (requires authentication).

## API Documentation

Interactive API documentation is available via Swagger UI when the server is running:

*   Navigate to `/documentation` (e.g., `http://localhost:3000/documentation`).

The OpenAPI specification can be found at `/openapi.yaml`.
A simple landing page is available at the root `/`.
