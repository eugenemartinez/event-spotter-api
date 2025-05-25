import { z } from 'zod';
// Import the PRD-aligned apiEventResponseSchema
import { apiEventResponseSchema } from '../events/event.schemas';

// --- Request Zod Schemas ---
export const registerUserSchema = z
  .object({
    username: z
      .string()
      .min(3, 'Username must be at least 3 characters long')
      .max(50, 'Username must be at most 50 characters long') // Added message for consistency, no period
      .describe('The desired username for the new account. Must be unique.'),
    email: z
      .string()
      .email('Invalid email address')
      .describe('The email address for the new account. Must be unique.'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters long')
      .describe('The password for the new account. Must be at least 8 characters.'),
  })
  .describe('Payload for registering a new user.');
export type RegisterUserInput = z.infer<typeof registerUserSchema>;

export const loginUserSchema = z.object({
  identifier: z
    .string()
    .min(1, 'Email or Username is required')
    .describe("The user's email address or username."),
  password: z.string().min(1, 'Password cannot be empty')
    .describe("The user's password."),
})
.describe("Payload for user login.");
export type LoginUserInput = z.infer<typeof loginUserSchema>;

export const updateUserProfileSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters long")
    .max(50, "Username must be at most 50 characters long")
    .optional()
    .describe("The new username for the user. Must be unique if provided."),
  email: z
    .string()
    .email("Invalid email address")
    .optional()
    .describe("The new email address for the user. Must be unique if provided."),
}).partial().describe("Payload for updating the current user's profile information (username or email).");
// Removed .refine() that was causing issues with empty payload tests,
// as per previous discussions to allow no-op updates.
// If a refine is added back, its message must also be period-free.
export type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z
    .string()
    .min(1, "Current password cannot be empty")
    .describe("The user's current password."),
  newPassword: z
    .string()
    .min(8, "New password must be at least 8 characters long")
    .describe("The desired new password. Must be at least 8 characters."),
}).describe("Payload for changing the current user's password.");
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;


// --- Response Zod Schemas ---
export const authSuccessResponseSchema = z.object({
  id: z.string().uuid().describe("The unique identifier of the authenticated user."),
  username: z.string().describe("The username of the authenticated user."),
  email: z.string().email().describe("The email address of the authenticated user."),
  token: z.string().describe('JWT authentication token for subsequent requests.'),
}).describe("Response payload upon successful user registration or login.");

export const apiUserResponseSchema = z.object({
  id: z.string().uuid().describe("User's unique identifier."),
  username: z.string().describe("User's username."),
  email: z.string().email().describe("User's email address."),
  createdAt: z.string().datetime().describe("Timestamp of user creation (ISO 8601 format)."),
  updatedAt: z.string().datetime().describe("Timestamp of last user update (ISO 8601 format)."),
}).describe("Detailed profile information for a user.");

// Corrected definition:
export const savedEventsResponseSchema = z.object({
  events: z.array(apiEventResponseSchema)
}).describe("A list of events saved by the user.");

// --- Plain JavaScript Objects for Explicit Swagger Examples ---
export const registerUserRequestExample = {
  username: 'testuser1',
  email: 'testuser1@example.com',
  password: 'Password123!',
};

export const updateUserProfileRequestExample = {
  username: "new_username_example",
};

export const changePasswordRequestExample = {
  currentPassword: "currentPasswordExample123",
  newPassword: "newStrongPasswordExample456!"
};

export const authSuccessResponseExample = {
  id: 'a1b2c3d4-e89b-12d3-a456-426614174000',
  username: 'testuser1',
  email: 'testuser1@example.com',
  token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImExYjJjM2Q0LWU1ZjYtNzg5MC0xMjM0LTU2Nzg5MGFiY2RlZiIsInVzZXJuYW1lIjoidGVzdHVzZXIxIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
};

export const apiUserResponseExample = {
  id: 'b1c2d3e4-f5a6-7890-1234-567890abcdef',
  username: 'currentuser',
  email: 'currentuser@example.com',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const singleEventExamplePrd = {
  id: "event-uuid-1",
  userId: "user-uuid-for-event-1",
  title: "Community BBQ",
  description: "Join us for a fun community BBQ with games and food.",
  eventDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  eventTime: "14:00:00",
  locationDescription: "Central Park, near the fountain",
  organizerName: "City Council Events Team",
  category: "Community",
  tags: ["food", "family-friendly", "outdoor"],
  websiteUrl: "https://example.com/community-bbq",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const savedEventsResponseExample = { events: [singleEventExamplePrd] }; // Also update example if it was a direct array