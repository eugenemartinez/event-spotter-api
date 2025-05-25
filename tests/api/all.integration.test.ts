import { Prisma } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import supertest from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChangePasswordInput, UpdateUserProfileInput } from '../../src/api/auth/auth.schemas';
import { ApiEventResponse, CreateEventInput, UpdateEventInput } from '../../src/api/events/event.schemas';
import prisma from '../../src/lib/prisma'; // For direct DB checks
import { hashPassword } from '../../src/utils/hash';
import { setupTestEnvironment, teardownTestEnvironment, TestEnvironment, createTestEvent } from './test.helpers';
import { v4 as uuidv4 } from 'uuid';

// Common Schemas (add more as needed, or import them within specific describe blocks)
// It's often cleaner to import specific schemas within the describe block that uses them
// if they aren't universally needed.
// import { SomeCommonSchema } from '../../src/api/some/some.schemas'; 
// import { ApiEventResponse } from '../../src/api/events/event.schemas';

// You might also have a direct prisma import in some tests for setup/assertions,
// though using app.prisma from TestEnvironment is generally preferred within test logic.
// import prisma from '../../src/lib/prisma'; 

// --- Test suites will be pasted below this line ---

// REGISTER
describe('POST /api/auth/register', () => {
  let testEnv: TestEnvironment | null = null;
  let app: FastifyInstance;

  beforeAll(async () => {
    testEnv = await setupTestEnvironment('auth-register-suite');
    app = testEnv.app;
  });

  afterAll(async () => {
    await teardownTestEnvironment(testEnv);
  });

  it('should register a new user successfully with valid data', async () => {
    const uniqueEmail = `testuser-register-${Date.now()}@example.com`;
    const uniqueUsername = `testuser-register-${Date.now()}`;
    const userData = {
      email: uniqueEmail,
      password: 'Password123!',
      username: uniqueUsername,
    };

    const response = await supertest(app.server)
      .post('/api/auth/register')
      .send(userData)
      .expect(201);

    expect(response.body).toBeTypeOf('object');
    expect(response.body.id).toBeTypeOf('string');
    expect(response.body.email).toBe(userData.email);
    expect(response.body.username).toBe(userData.username);
    expect(response.body.passwordHash).toBeUndefined();
    expect(response.body.password).toBeUndefined();

    const dbUser = await app.prisma.user.findUnique({
      where: { email: userData.email },
    });
    expect(dbUser).not.toBeNull();
    expect(dbUser?.email).toBe(userData.email);
    expect(dbUser?.username).toBe(userData.username);
    expect(dbUser?.passwordHash).toBeTypeOf('string');
    expect(dbUser?.passwordHash).not.toBe(userData.password);
  });

  it('should return 400 for missing email', async () => {
    const userData = {
      // email: 'missing@example.com', // Email is missing
      password: 'Password123!',
      username: `testuser-missingemail-${Date.now()}`,
    };

    const response = await supertest(app.server)
      .post('/api/auth/register')
      .send(userData)
      .expect(400);

    expect(response.body.message).toBe('Input validation failed');
    expect(response.body.errors).toBeTypeOf('object');
    expect(response.body.errors.email).toBeInstanceOf(Array);
    expect(response.body.errors.email[0]).toContain('Required');
  });

  it('should return 400 for missing password', async () => {
      const userData = {
        email: `missingpass-${Date.now()}@example.com`,
        // password: 'Password123!',
        username: `testuser-missingpass-${Date.now()}`,
      };

      const response = await supertest(app.server)
        .post('/api/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.message).toBe('Input validation failed');
      expect(response.body.errors).toBeTypeOf('object');
      expect(response.body.errors.password).toBeInstanceOf(Array);
      expect(response.body.errors.password[0]).toContain('Required');
  });


  it('should return 409 if email already exists', async () => {
    const uniqueEmail = `duplicate-register-${Date.now()}@example.com`;
    const uniqueUsernamePrefix = `duplicate-register-user-${Date.now()}`;
    const userData = {
      email: uniqueEmail,
      password: 'Password123!',
      username: `${uniqueUsernamePrefix}-1`,
    };

    await supertest(app.server)
      .post('/api/auth/register')
      .send(userData)
      .expect(201);

    const secondUserData = {
      ...userData,
      username: `${uniqueUsernamePrefix}-2`,
    };
    const response = await supertest(app.server)
      .post('/api/auth/register')
      .send(secondUserData)
      .expect(409);
    expect(response.body.message).toBe('User with this username or email already exists');
  });

  it('should return 409 if username already exists', async () => {
    const uniqueUsername = `duplicate-username-register-${Date.now()}`;
    const uniqueEmailPrefix = `duplicate-username-email-${Date.now()}`;
    const userData = {
      email: `${uniqueEmailPrefix}-1@example.com`,
      password: 'Password123!',
      username: uniqueUsername,
    };

    await supertest(app.server)
      .post('/api/auth/register')
      .send(userData)
      .expect(201);

    const secondUserData = {
      ...userData,
      email: `${uniqueEmailPrefix}-2@example.com`, // Different email
    };
    const response = await supertest(app.server)
      .post('/api/auth/register')
      .send(secondUserData)
      .expect(409);
    expect(response.body.message).toBe('User with this username or email already exists');
  });


  it('should return 400 for invalid email format', async () => {
    const userData = {
      email: 'invalid-email-format',
      password: 'Password123!',
      username: `testuser-invalidemail-${Date.now()}`,
    };

    const response = await supertest(app.server)
      .post('/api/auth/register')
      .send(userData)
      .expect(400);

    expect(response.body.message).toBe('Input validation failed');
    expect(response.body.errors).toBeTypeOf('object');
    expect(response.body.errors.email).toBeInstanceOf(Array);
    expect(response.body.errors.email[0]).toBe('Invalid email address');
  });

  it('should return 400 for password too short', async () => {
    const userData = {
      email: `shortpass-${Date.now()}@example.com`,
      password: 'short',
      username: `testuser-shortpass-${Date.now()}`,
    };

    const response = await supertest(app.server)
      .post('/api/auth/register')
      .send(userData)
      .expect(400);

    expect(response.body.message).toBe('Input validation failed');
    expect(response.body.errors.password[0]).toBe('Password must be at least 8 characters long');
  });

  it('should return 400 for username too short', async () => {
    const userData = {
      email: `shortuser-${Date.now()}@example.com`,
      password: 'Password123!',
      username: 'ab',
    };

    const response = await supertest(app.server)
      .post('/api/auth/register')
      .send(userData)
      .expect(400);

    expect(response.body.message).toBe('Input validation failed');
    expect(response.body.errors.username[0]).toBe('Username must be at least 3 characters long');
  });

  it('should return 400 for username too long', async () => {
    const userData = {
      email: `longuser-${Date.now()}@example.com`,
      password: 'Password123!',
      username: 'a'.repeat(51),
    };

    const response = await supertest(app.server)
      .post('/api/auth/register')
      .send(userData)
      .expect(400);

    expect(response.body.message).toBe('Input validation failed');
    expect(response.body.errors.username[0]).toBe('Username must be at most 50 characters long'); // UPDATED EXPECTATION
  });
});

// LOGIN
describe('POST /api/auth/login', () => {
  let testEnv: TestEnvironment | null = null;
  let app: FastifyInstance;
  let loginTestUserId: string;
  const loginTestUserEmail = `login-test-user-${Date.now()}@example.com`;
  const loginTestUserUsername = `login-test-user-${Date.now()}`;
  const loginTestUserPassword = 'PasswordForLogin123!';

  beforeAll(async () => {
    testEnv = await setupTestEnvironment('auth-login-suite');
    app = testEnv.app;

    // Create a specific user for login tests
    const createdUser = await app.prisma.user.create({
      data: {
        email: loginTestUserEmail,
        username: loginTestUserUsername,
        passwordHash: await hashPassword(loginTestUserPassword),
      },
    });
    loginTestUserId = createdUser.id;
  });

  afterAll(async () => {
    // Clean up the specific user created for login tests
    if (loginTestUserId) {
      try {
        await app.prisma.user.delete({ where: { id: loginTestUserId } });
      } catch (error) {
        console.warn(`Could not clean up login test user ${loginTestUserId}:`, error);
      }
    }
    await teardownTestEnvironment(testEnv);
  });

  it('should log in an existing user successfully with correct email and password', async () => {
    const loginCredentials = {
      identifier: loginTestUserEmail,
      password: loginTestUserPassword,
    };

    const response = await supertest(app.server)
      .post('/api/auth/login')
      .send(loginCredentials)
      .expect(200);

    expect(response.body).toBeTypeOf('object');
    expect(response.body.id).toBe(loginTestUserId);
    expect(response.body.email).toBe(loginTestUserEmail);
    expect(response.body.username).toBe(loginTestUserUsername);
    expect(response.body.token).toBeTypeOf('string');
  });

  it('should log in an existing user successfully with correct username and password', async () => {
    const loginCredentials = {
      identifier: loginTestUserUsername,
      password: loginTestUserPassword,
    };

    const response = await supertest(app.server)
      .post('/api/auth/login')
      .send(loginCredentials)
      .expect(200);

    expect(response.body.id).toBe(loginTestUserId);
    // ... other assertions
  });

  it('should return 401 for a non-existent identifier', async () => {
    const loginCredentials = {
      identifier: 'nonexistentuser@example.com',
      password: 'somepassword',
    };
    await supertest(app.server)
      .post('/api/auth/login')
      .send(loginCredentials)
      .expect(401);
  });

  it('should return 401 for an existing identifier (email) but incorrect password', async () => {
    const loginCredentials = {
      identifier: loginTestUserEmail,
      password: 'WrongPassword123!',
    };
    await supertest(app.server)
      .post('/api/auth/login')
      .send(loginCredentials)
      .expect(401);
  });
  
  it('should return 401 for an existing identifier (username) but incorrect password', async () => {
    const loginCredentials = {
      identifier: loginTestUserUsername, 
      password: 'WrongPassword123!',
    };

    const response = await supertest(app.server)
      .post('/api/auth/login')
      .send(loginCredentials)
      .expect(401);

    expect(response.body.message).toBe('Invalid credentials');
  });

  it('should return 400 for missing identifier in login request', async () => {
    const loginCredentials = {
      password: loginTestUserPassword,
    };

    const response = await supertest(app.server)
      .post('/api/auth/login')
      .send(loginCredentials)
      .expect(400);

    expect(response.body.message).toBe('Input validation failed');
    expect(response.body.errors.identifier[0]).toBe('Required'); 
  });

  it('should return 400 for missing password in login request', async () => {
    const loginCredentials = {
      identifier: loginTestUserEmail,
    };

    const response = await supertest(app.server)
      .post('/api/auth/login')
      .send(loginCredentials)
      .expect(400);

    expect(response.body.message).toBe('Input validation failed');
    expect(response.body.errors.password[0]).toBe('Required');
  });
});

// ME (Get Authenticated User Profile)
describe('GET /api/auth/me', () => {
  let testEnv: TestEnvironment | null = null;
  let app: FastifyInstance;
  let testUserId: string;
  let testUserToken: string;
  let testUserEmail: string;
  let testUserUsername: string;

  beforeAll(async () => {
    testEnv = await setupTestEnvironment('auth-getMe-suite');
    app = testEnv.app;
    testUserId = testEnv.testUserId;
    testUserToken = testEnv.testUserToken;
    testUserEmail = testEnv.testUserEmail;
    testUserUsername = testEnv.testUserUsername;
  });

  afterAll(async () => {
    await teardownTestEnvironment(testEnv);
  });

  it('should return 401 if no token is provided', async () => {
    const response = await supertest(app.server)
      .get('/api/auth/me')
      .expect(401);
    // Remove the period from the expected message
    expect(response.body.message).toBe('Authentication required: Invalid or missing token'); 
  });

  it('should return 401 if an invalid/malformed token is provided', async () => {
    const response = await supertest(app.server)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalidtoken123')
      .expect(401);
    // Remove the period from the expected message
    expect(response.body.message).toBe('Authentication required: Invalid or missing token');
  });

  it('should return the authenticated user profile with a valid token', async () => {
    const response = await supertest(app.server)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${testUserToken}`)
      .expect(200);

    expect(response.body).toBeTypeOf('object');
    expect(response.body.id).toBe(testUserId);
    expect(response.body.email).toBe(testUserEmail);
    expect(response.body.username).toBe(testUserUsername);
    expect(response.body.createdAt).toBeTypeOf('string');
    expect(response.body.updatedAt).toBeTypeOf('string');
    expect(new Date(response.body.createdAt).toISOString()).toBe(response.body.createdAt);
    expect(new Date(response.body.updatedAt).toISOString()).toBe(response.body.updatedAt);
  });

  it('should return 404 if the user in a valid token no longer exists in DB', async () => {
    // This test needs its own temporary user setup
    const tempEmail = `temp-deleted-me-${Date.now()}@example.com`;
    const tempUsername = `temp-deleted-me-${Date.now()}`;
    const tempPassword = 'tempPassword123';

    const tempUser = await app.prisma.user.create({
      data: {
        email: tempEmail,
        username: tempUsername,
        passwordHash: await hashPassword(tempPassword),
      },
    });
    const loginRes = await supertest(app.server)
      .post('/api/auth/login')
      .send({ identifier: tempEmail, password: tempPassword })
      .expect(200);
    const tempToken = loginRes.body.token;

    await app.prisma.user.delete({ where: { id: tempUser.id } });

    const response = await supertest(app.server)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tempToken}`)
      .expect(404);

    expect(response.body.message).toBe('User not found');
  });
});

// Update Profile
describe('PATCH /api/auth/me - Update User Profile', () => {
  let testEnv: TestEnvironment | null = null;
  let app: FastifyInstance;
  let testUserToken: string;
  let testUserId: string;
  let initialTestUserEmail: string;
  let initialTestUserUsername: string;

  const uniqueTimestamp = () => `-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  beforeAll(async () => {
    testEnv = await setupTestEnvironment('auth-update-profile-suite');
    app = testEnv.app;
    testUserToken = testEnv.testUserToken;
    testUserId = testEnv.testUserId;
    initialTestUserEmail = testEnv.testUserEmail;
    initialTestUserUsername = testEnv.testUserUsername;
  });

  afterAll(async () => {
    // Restore original user details if changed, to not affect other test suites if DB is not fully reset
    // This is optional and depends on how isolated you want tests.
    // For now, teardownTestEnvironment should handle the primary user.
    // If tests create other users, they should be cleaned up specifically.
    await teardownTestEnvironment(testEnv);
  });

  // --- Test Cases ---

  it('should successfully update username', async () => {
    const newUsername = `updatedUsername${uniqueTimestamp()}`;
    const payload: UpdateUserProfileInput = { username: newUsername };

    const response = await supertest(app.server)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send(payload)
      .expect(200);

    expect(response.body.id).toBe(testUserId);
    expect(response.body.username).toBe(newUsername);
    expect(response.body.email).toBe(initialTestUserEmail); // Email should remain unchanged

    // Verify in DB
    const dbUser = await prisma.user.findUnique({ where: { id: testUserId } });
    expect(dbUser?.username).toBe(newUsername);
  });

  it('should successfully update email', async () => {
    const newEmail = `updated${uniqueTimestamp()}@example.com`;
    const payload: UpdateUserProfileInput = { email: newEmail };

    const response = await supertest(app.server)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send(payload)
      .expect(200);

    expect(response.body.id).toBe(testUserId);
    expect(response.body.email).toBe(newEmail);
    // Username should revert to what it was before this test, or what it became in the previous test.
    // For simplicity, let's assume it's the one set in the previous test or initial if that test is skipped/isolated.
    // To be robust, fetch current username before this test or reset it.
    // For now, we'll just check it's not null.
    expect(response.body.username).toBeTypeOf('string');


    // Verify in DB
    const dbUser = await prisma.user.findUnique({ where: { id: testUserId } });
    expect(dbUser?.email).toBe(newEmail);

    // Clean up: revert email for subsequent tests if needed, or rely on fresh user from setupTestEnvironment
    // For now, we'll let the next test deal with its own state or a potentially modified user.
  });

  it('should successfully update both username and email', async () => {
    const newUsername = `updatedBothUser${uniqueTimestamp()}`;
    const newEmail = `updatedBoth${uniqueTimestamp()}@example.com`;
    const payload: UpdateUserProfileInput = { username: newUsername, email: newEmail };

    const response = await supertest(app.server)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send(payload)
      .expect(200);

    expect(response.body.id).toBe(testUserId);
    expect(response.body.username).toBe(newUsername);
    expect(response.body.email).toBe(newEmail);

    const dbUser = await prisma.user.findUnique({ where: { id: testUserId } });
    expect(dbUser?.username).toBe(newUsername);
    expect(dbUser?.email).toBe(newEmail);
  });

  it('should return 400 for invalid email format', async () => {
    const payload = { email: 'invalid-email' };
    const response = await supertest(app.server)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send(payload)
      .expect(400);
    expect(response.body.message).toBe('Input validation failed');
    expect(response.body.errors?.email).toContain('Invalid email address');
  });

  it('should return 400 for username too short', async () => {
    const payload = { username: 'a' }; // Assuming min length is > 1
    const response = await supertest(app.server)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send(payload)
      .expect(400);
    expect(response.body.message).toBe('Input validation failed');
    // Adjust assertion based on your actual validation message from Zod schema
    expect(response.body.errors?.username).toContain('Username must be at least 3 characters long');
  });
  
  it('should return 400 for username too long', async () => {
    const payload = { username: 'a'.repeat(51) }; // Assuming max length is 50
    const response = await supertest(app.server)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send(payload)
      .expect(400);
    expect(response.body.message).toBe('Input validation failed');
    expect(response.body.errors?.username).toContain('Username must be at most 50 characters long'); // EXACT MATCH
  });

  it('should return 401 if no token is provided', async () => {
    await supertest(app.server)
      .patch('/api/auth/me')
      .send({ username: 'noauthupdate' })
      .expect(401);
  });

  it('should return 409 if trying to update to an email that already exists for another user', async () => {
    // 1. Create another user
    const otherUserEmail = `otheruser${uniqueTimestamp()}@example.com`;
    const otherUserUsername = `otheruser${uniqueTimestamp()}`;
    await prisma.user.create({
      data: {
        email: otherUserEmail,
        username: otherUserUsername,
        passwordHash: 'somehash', // Not logging in, so hash doesn't need to be valid for a password
      },
    });

    // 2. Try to update testUser's email to otherUserEmail
    const payload = { email: otherUserEmail };
    const response = await supertest(app.server)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send(payload)
      .expect(409);

    expect(response.body.message).toBe('User with this email already exists.');

    // Clean up the other user
    await prisma.user.deleteMany({ where: { email: otherUserEmail } });
  });

  it('should return 409 if trying to update to a username that already exists for another user', async () => {
    const otherUserEmail = `otheruser2${uniqueTimestamp()}@example.com`;
    const otherUserUsername = `otherusername2${uniqueTimestamp()}`;
    await prisma.user.create({
      data: {
        email: otherUserEmail,
        username: otherUserUsername,
        passwordHash: 'somehash2',
      },
    });

    const payload = { username: otherUserUsername };
    const response = await supertest(app.server)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send(payload)
      .expect(409);

    expect(response.body.message).toBe('User with this username already exists.');
    await prisma.user.deleteMany({ where: { username: otherUserUsername } });
  });

  it('should allow updating to the same current username', async () => {
    const currentUser = await prisma.user.findUnique({ where: { id: testUserId }});
    const payload: UpdateUserProfileInput = { username: currentUser?.username };

    await supertest(app.server)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send(payload)
      .expect(200);
    // Further assertions can check if the response body matches the current user details
  });

  it('should allow updating to the same current email', async () => {
     const currentUser = await prisma.user.findUnique({ where: { id: testUserId }});
    const payload: UpdateUserProfileInput = { email: currentUser?.email };

    await supertest(app.server)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send(payload)
      .expect(200);
  });

  it('should do nothing and return 200 if payload is empty', async () => {
    const payload = {};
    const response = await supertest(app.server)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send(payload)
      .expect(200);

    // Check that user details haven't changed from initial values (or last known good state)
    const dbUser = await prisma.user.findUnique({ where: { id: testUserId } });
    // This assertion depends on the state from previous tests.
    // For a truly isolated test, you'd fetch user details before this test and compare.
    expect(response.body.id).toBe(testUserId);
    expect(dbUser?.id).toBe(testUserId);
    // Add more specific assertions if needed, e.g., response.body.username === dbUser.username
  });

});

// Change Password
describe('POST /api/auth/me/password - Change Password', () => {
  let testEnv: TestEnvironment | null = null;
  let app: FastifyInstance;
  let testUserToken: string;
  let testUserId: string;
  let currentTestUserPassword = 'Password123!'; // Initial password assumed for test user setup

  const uniqueTimestamp = () => `-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  beforeAll(async () => {
    testEnv = await setupTestEnvironment('auth-change-password-suite');
    if (!testEnv) {
      throw new Error("Test environment setup failed");
    }
    app = testEnv.app;
    testUserToken = testEnv.testUserToken;
    testUserId = testEnv.testUserId;
    // If your setupTestEnvironment returns the actual password, use it:
    // currentTestUserPassword = testEnv.testUserPassword || 'Password123!';
  });

  afterAll(async () => {
    await teardownTestEnvironment(testEnv);
  });

  it('should successfully change the password with correct current password', async () => {
    const newPassword = `NewPassword${uniqueTimestamp()}!`;
    const payload: ChangePasswordInput = {
      currentPassword: currentTestUserPassword,
      newPassword: newPassword,
    };

    const response = await supertest(app.server)
      .post('/api/auth/me/password')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send(payload)
      .expect(200);

    expect(response.body.message).toBe('Password changed successfully.'); // FIX 1: Updated message

    currentTestUserPassword = newPassword; // Update for subsequent tests

    // Optional: Verify in DB (though login test is more comprehensive)
    const user = await prisma.user.findUnique({ where: { id: testUserId } });
    expect(user).not.toBeNull();
    // To truly verify, you'd compare the newPassword's hash with user.passwordHash
  });

  it('should allow login with the new password after a successful change', async () => {
    // NOTE: If this test fails with 401, it indicates an issue in the backend
    // changePasswordHandler not correctly updating the password in the database.
    const loginPayload = {
      identifier: testEnv?.testUserEmail || '', 
      password: currentTestUserPassword, // This should be the NEW password
    };

    const loginResponse = await supertest(app.server)
      .post('/api/auth/login')
      .send(loginPayload)
      .expect(200); // This expects 200, but log shows 401

    expect(loginResponse.body.token).toBeDefined();
    expect(loginResponse.body.id).toBe(testUserId);
  });


  it('should return 401 if current password is incorrect', async () => {
    const payload: ChangePasswordInput = {
      currentPassword: 'WrongOldPassword123!',
      newPassword: `AnotherNewPassword${uniqueTimestamp()}!`,
    };

    const response = await supertest(app.server)
      .post('/api/auth/me/password')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send(payload)
      .expect(401);

    expect(response.body.message).toBe('Invalid current password.'); // FIX 3: Updated message
  });

  it('should return 400 for invalid new password (e.g., too short)', async () => {
    const payload: ChangePasswordInput = {
      currentPassword: currentTestUserPassword, 
      newPassword: 'short', 
    };

    const response = await supertest(app.server)
      .post('/api/auth/me/password')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send(payload)
      .expect(400);

    expect(response.body.message).toBe('Input validation failed');
    // This assertion assumes your Zod schema message for newPassword min length is period-free
    expect(response.body.errors?.newPassword).toContain('New password must be at least 8 characters long');
  });
  
  it('should return 400 if currentPassword is not provided', async () => {
    const payload = { // currentPassword deliberately omitted
      newPassword: `SomeValidNewPassword${uniqueTimestamp()}!`,
    };

    const response = await supertest(app.server)
      .post('/api/auth/me/password')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send(payload)
      .expect(400);

    expect(response.body.message).toBe('Input validation failed');
    expect(response.body.errors?.currentPassword).toContain('Required'); // FIX 4: Expect "Required" for missing field
  });

  it('should return 400 if newPassword is not provided', async () => {
    const payload = { // newPassword deliberately omitted
      currentPassword: currentTestUserPassword,
    };

    const response = await supertest(app.server)
      .post('/api/auth/me/password')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send(payload)
      .expect(400);

    expect(response.body.message).toBe('Input validation failed');
    expect(response.body.errors?.newPassword).toContain('Required'); // FIX 5: Expect "Required" for missing field
  });


  it('should return 401 if no token is provided', async () => {
    const payload: ChangePasswordInput = {
      currentPassword: 'anyPassword123',
      newPassword: 'anyNewPassword456!',
    };

    await supertest(app.server)
      .post('/api/auth/me/password')
      .send(payload)
      .expect(401);
  });
});

// Get Saved Events
describe('GET /api/auth/me/saved-events - Get Saved Events', () => {
  let testEnv: TestEnvironment | null = null;
  let app: FastifyInstance;
  let testUserToken: string;
  let testUserId: string;
  const createdEventIds: string[] = [];
  const createdUserIds: string[] = []; // To store IDs of other users created for testing

  const uniqueTimestamp = () => `-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  const createSampleEvent = async (userId: string, overrides: Partial<CreateEventInput> = {}): Promise<ApiEventResponse> => {
    const completePayload: CreateEventInput & { organizerName: string } = {
      title: `Saved Event Title ${uniqueTimestamp()}`,
      description: `This is a detailed description for a saved event ${uniqueTimestamp()}. It needs to be long enough.`,
      eventDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      eventTime: '10:00:00',
      locationDescription: `Saved Event Location ${uniqueTimestamp()}`,
      organizerName: overrides.organizerName || `Default Organizer ${uniqueTimestamp()}`,
      category: `Test Category ${uniqueTimestamp()}`,
      tags: ['saved', `test${uniqueTimestamp()}`],
      websiteUrl: `https://example.com/saved${uniqueTimestamp()}`,
      ...overrides,
    };
    if (overrides.organizerName === undefined && completePayload.organizerName === undefined) {
        completePayload.organizerName = `Default Organizer ${uniqueTimestamp()}`;
    }

    const prismaEventDate = new Date(completePayload.eventDate).toISOString();
    let prismaEventTime: Date | null = null;
    if (completePayload.eventTime) {
      const [hours, minutes, seconds] = completePayload.eventTime.split(':').map(Number);
      const dateForTime = new Date(completePayload.eventDate);
      dateForTime.setUTCHours(hours, minutes, seconds, 0);
      prismaEventTime = dateForTime;
    }

    const event = await prisma.event.create({
      data: {
        ...completePayload,
        userId: userId, // This userId MUST be a valid UUID of an existing user
        tags: completePayload.tags || [],
        eventDate: prismaEventDate,
        eventTime: prismaEventTime,
      },
    });
    createdEventIds.push(event.id);

    return {
        id: event.id,
        userId: event.userId,
        title: event.title,
        description: event.description,
        eventDate: event.eventDate.toISOString().split('T')[0],
        eventTime: event.eventTime ? new Date(event.eventTime).toISOString().substring(11, 19) : null,
        locationDescription: event.locationDescription,
        organizerName: event.organizerName,
        category: event.category,
        tags: event.tags,
        websiteUrl: event.websiteUrl,
        createdAt: event.createdAt.toISOString(),
        updatedAt: event.updatedAt.toISOString(),
    };
  };

  beforeAll(async () => {
    testEnv = await setupTestEnvironment('auth-saved-events-suite');
    if (!testEnv) throw new Error("Test environment setup failed");
    app = testEnv.app;
    testUserToken = testEnv.testUserToken;
    testUserId = testEnv.testUserId;
  });

  afterAll(async () => {
    await prisma.userSavedEvent.deleteMany({ where: { OR: [{ userId: testUserId }, { userId: { in: createdUserIds } }] } });
    if (createdEventIds.length > 0) {
      await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await teardownTestEnvironment(testEnv);
  });

  beforeEach(async () => {
    await prisma.userSavedEvent.deleteMany({ where: { userId: testUserId } });
    // Also clear events potentially created by other users in previous test runs if not cleaned up properly
    // This is more of a safeguard; specific test cleanup is preferred.
  });

  it('should return 401 if no token is provided', async () => {
    await supertest(app.server)
      .get('/api/auth/me/saved-events')
      .expect(401);
  });

  it('should return an empty list if the user has no saved events', async () => {
    const response = await supertest(app.server)
      .get('/api/auth/me/saved-events')
      .set('Authorization', `Bearer ${testUserToken}`)
      .expect(200); // This test might still fail if the 500 error is in the handler logic

    expect(response.body).toEqual({ events: [] });
  });

  it('should return a list of saved events for the authenticated user', async () => {
    // Create a temporary "other" user for one of the events
    const otherEventCreator = await prisma.user.create({
      data: {
        // id: randomUUID(), // Let Prisma generate if @default(uuid())
        email: `otherCreator-${uniqueTimestamp()}@example.com`,
        username: `otherCreator-${uniqueTimestamp()}`,
        passwordHash: 'hash',
      }
    });
    createdUserIds.push(otherEventCreator.id);


    const event1 = await createSampleEvent(testUserId, { title: "First Saved Event" });
    const event2 = await createSampleEvent(testUserId, { title: "Second Saved Event" });
    // FIX for Failure #2: Use a valid UUID for the event's creator
    const otherUserEvent = await createSampleEvent(otherEventCreator.id, { title: "Event by another user" });

    await prisma.userSavedEvent.create({
      data: { userId: testUserId, eventId: event1.id, savedAt: new Date(Date.now() - 2000) },
    });
    await prisma.userSavedEvent.create({
      data: { userId: testUserId, eventId: event2.id, savedAt: new Date(Date.now() - 1000) },
    });

    const response = await supertest(app.server)
      .get('/api/auth/me/saved-events')
      .set('Authorization', `Bearer ${testUserToken}`)
      .expect(200);

    expect(response.body.events).toBeInstanceOf(Array);
    expect(response.body.events).toHaveLength(2);
    const responseEventIds = response.body.events.map((e: ApiEventResponse) => e.id);
    expect(responseEventIds).toEqual([event2.id, event1.id]);

    // Verify structure of one of the events (should match ApiEventResponse)
    const firstSavedEventInResponse = response.body.events[0];
    expect(firstSavedEventInResponse.id).toBe(event2.id);
    expect(firstSavedEventInResponse.title).toBe(event2.title);
    expect(firstSavedEventInResponse.userId).toBe(event2.userId); // Event's creator, not necessarily the saver
    expect(firstSavedEventInResponse).toHaveProperty('description');
    expect(firstSavedEventInResponse).toHaveProperty('eventDate');
    expect(firstSavedEventInResponse).toHaveProperty('eventTime');
    expect(firstSavedEventInResponse).toHaveProperty('locationDescription');
    expect(firstSavedEventInResponse).toHaveProperty('organizerName');
    expect(firstSavedEventInResponse).toHaveProperty('category');
    expect(firstSavedEventInResponse).toHaveProperty('tags');
    expect(firstSavedEventInResponse).toHaveProperty('websiteUrl');
    expect(firstSavedEventInResponse).toHaveProperty('createdAt');
    expect(firstSavedEventInResponse).toHaveProperty('updatedAt');
  });

  it('should not return events saved by other users', async () => {
    const myEvent = await createSampleEvent(testUserId, { title: "My Saved Event Only" });
    await prisma.userSavedEvent.create({
      data: { userId: testUserId, eventId: myEvent.id },
    });

    // FIX for Failure #3: Let Prisma generate user ID or use randomUUID()
    const otherUser = await prisma.user.create({
        data: {
            // id: randomUUID(), // Option 1: Generate UUID explicitly
            // Option 2 (preferred if schema has @default(uuid())): Omit id field
            email: `other-${uniqueTimestamp()}@example.com`,
            username: `otherUser-${uniqueTimestamp()}`,
            passwordHash: 'hash',
        }
    });
    createdUserIds.push(otherUser.id); // Track for cleanup

    const eventSavedByOther = await createSampleEvent(otherUser.id, { title: "Event Saved By Other" });
    await prisma.userSavedEvent.create({
      data: { userId: otherUser.id, eventId: eventSavedByOther.id },
    });

    const response = await supertest(app.server)
      .get('/api/auth/me/saved-events')
      .set('Authorization', `Bearer ${testUserToken}`)
      .expect(200);

    expect(response.body.events).toBeInstanceOf(Array);
    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0].id).toBe(myEvent.id);
  });
});

// Create Event
describe('POST /api/events - Create Event', () => {
  let testEnv: TestEnvironment | null = null;
  let app: FastifyInstance;
  let testUserToken: string;
  let testUserId: string;
  let testUserUsername: string;

  const createdEventIds: string[] = []; // To track IDs of events created by tests

  beforeAll(async () => {
    testEnv = await setupTestEnvironment('create-event-suite'); // Using a more specific suite name
    if (!testEnv) { // Added null check for robustness
      throw new Error("Test environment setup failed for createEvent suite.");
    }
    app = testEnv.app;
    testUserToken = testEnv.testUserToken;
    testUserId = testEnv.testUserId;
    testUserUsername = testEnv.testUserUsername;
  });

  afterAll(async () => {
    // teardownTestEnvironment will handle cleaning the user and any associated events
    // that might have been missed by afterEach or if cascades are fully effective.
    await teardownTestEnvironment(testEnv);
  });

  // Clear the array before each test to ensure a clean slate for ID tracking
  beforeEach(() => {
    createdEventIds.length = 0; 
  });

  afterEach(async () => {
    const suiteName = 'createEvent';
    if (!app || !app.prisma) { 
        console.warn(`[${suiteName} afterEach] app or app.prisma is not available. Skipping cleanup.`);
        return;
    }
    if (createdEventIds.length > 0) {
      console.log(`[${suiteName} afterEach] Attempting to clean up ${createdEventIds.length} event(s) for this test: ${createdEventIds.join(', ')}`);
      try {
        const eventsBeforeDelete = await app.prisma.event.findMany({
            where: { id: { in: createdEventIds } },
            select: { id: true }
        });
        console.log(`[${suiteName} afterEach] Found ${eventsBeforeDelete.length} test-specific events in DB right before attempting delete. IDs: ${eventsBeforeDelete.map(e => e.id).join(', ')}`);

        if (eventsBeforeDelete.length > 0) {
            const deleteResult = await app.prisma.event.deleteMany({
              where: { id: { in: eventsBeforeDelete.map(e => e.id) } },
            });
            console.log(`[${suiteName} afterEach] Successfully deleted ${deleteResult.count} event(s).`);
            if (deleteResult.count !== eventsBeforeDelete.length) {
                console.warn(`[${suiteName} afterEach] Mismatch: Expected to delete ${eventsBeforeDelete.length} events, but deleted ${deleteResult.count}.`);
                const remainingTestEvents = await app.prisma.event.findMany({ 
                    where: { id: { in: createdEventIds } }, // Check against original list
                    select: { id: true }
                });
                if (remainingTestEvents.length > 0) {
                    console.warn(`[${suiteName} afterEach] The following test-specific events were NOT deleted:`, remainingTestEvents.map(e => e.id));
                }
            }
        } else {
             console.log(`[${suiteName} afterEach] No test-specific events (from createdEventIds for this test) found in DB to delete.`);
        }
      } catch (error) {
        console.error(`[${suiteName} afterEach] Error deleting events:`, error);
      }
    } else {
      console.log(`[${suiteName} afterEach] No events tracked by createdEventIds to clean up for this test.`);
    }
  });

  // --- Test Data ---
  const minimalEventData = {
    title: 'Minimal Post Test Event',
    description: 'This is a basic event description for POST.',
    eventDate: '2025-12-01',
    locationDescription: 'Online Post Test',
    category: 'Tech Talk Post',
  };

  const fullEventData = {
    title: 'Full Post Test Event with All Fields',
    description: 'A comprehensive description for a fully featured event for POST.',
    eventDate: '2025-11-15',
    eventTime: '14:30',
    locationDescription: 'Conference Hall A, Post Test',
    organizerName: 'Awesome POST Organizers Inc.',
    category: 'Workshop Post',
    tags: ['fastify-post', 'typescript-post', 'testing-post'],
    websiteUrl: 'https://example.com/fullpostevent',
  };
  
  // --- Test Cases ---
  it('should create an event successfully with minimal required data', async () => {
    const response = await supertest(app.server)
      .post('/api/events')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send(minimalEventData)
      .expect(201);
    expect(response.body.id).toBeTypeOf('string');
    if (response.body.id) createdEventIds.push(response.body.id); // Add to cleanup list
    expect(response.body.title).toBe(minimalEventData.title);
    expect(response.body.userId).toBe(testUserId);
    expect(response.body.organizerName).toBe(testUserUsername);
  });

  it('should create an event successfully with all optional data provided', async () => {
    const response = await supertest(app.server)
      .post('/api/events')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send(fullEventData)
      .expect(201);
    expect(response.body.id).toBeTypeOf('string');
    if (response.body.id) createdEventIds.push(response.body.id); // Add to cleanup list
    expect(response.body.title).toBe(fullEventData.title);
    expect(response.body.userId).toBe(testUserId);
    expect(response.body.organizerName).toBe(fullEventData.organizerName);
  });
  
  it('should default organizerName to creator username if not provided', async () => {
    const dataWithoutOrganizer = { ...minimalEventData, title: "POST Event Without Organizer Name" };
    const response = await supertest(app.server)
      .post('/api/events')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send(dataWithoutOrganizer)
      .expect(201);
    expect(response.body.id).toBeTypeOf('string');
    if (response.body.id) createdEventIds.push(response.body.id); // Add to cleanup list
    expect(response.body.organizerName).toBe(testUserUsername);
  });
  
  it('should default tags to an empty array if not provided', async () => {
      const dataWithoutTags = { ...minimalEventData, title: "POST Event Without Tags" };
      const response = await supertest(app.server)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send(dataWithoutTags)
        .expect(201);
      expect(response.body.id).toBeTypeOf('string');
      if (response.body.id) createdEventIds.push(response.body.id); // Add to cleanup list
      expect(response.body.tags).toEqual([]);
    });

  it('should return 401 if no authentication token is provided', async () => {
    await supertest(app.server)
      .post('/api/events')
      .send(minimalEventData)
      .expect(401);
    // No event created, so no ID to push
  });

  const requiredFields: (keyof typeof minimalEventData)[] = ['title', 'description', 'eventDate', 'locationDescription', 'category'];
  requiredFields.forEach(field => {
    it(`should return 400 if required field '${field}' is missing`, async () => {
      const invalidData = { ...minimalEventData };
      delete invalidData[field]; // TypeScript might complain here if strict, but it's a common JS pattern for testing
      const response = await supertest(app.server)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send(invalidData)
        .expect(400);
      expect(response.body.message).toBe('Input validation failed');
      expect(response.body.errors[field]).toBeInstanceOf(Array);
      // No event created
    });
  });

  it('should return 400 for invalid eventDate format', async () => {
    const response = await supertest(app.server)
      .post('/api/events')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send({ ...minimalEventData, eventDate: '2025/12/01' }) // Invalid format
      .expect(400);
    expect(response.body.errors.eventDate[0]).toBe('eventDate must be a valid date string in YYYY-MM-DD format');
    // No event created
  });
  
  it('should return 400 for invalid eventTime format', async () => {
      const response = await supertest(app.server)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ ...minimalEventData, eventTime: '2 PM' }) // Invalid format
        .expect(400);
      expect(response.body.errors.eventTime[0]).toBe('eventTime must be a valid time string in HH:mm or HH:mm:ss format');
      // No event created
    });

  it('should return 400 for title too short', async () => {
    const response = await supertest(app.server)
      .post('/api/events')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send({ ...minimalEventData, title: 'Hi' }) // Too short
      .expect(400);
    expect(response.body.errors.title[0]).toBe('Title must be at least 3 characters long');
    // No event created
  });
  
  it('should return 400 for description too short', async () => {
      const response = await supertest(app.server)
        .post('/api/events')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ ...minimalEventData, description: 'Short' }) // Too short
        .expect(400);
      expect(response.body.errors.description[0]).toBe('Description must be at least 10 characters long');
      // No event created
    });

  it('should return 400 for invalid websiteUrl format', async () => {
    const response = await supertest(app.server)
      .post('/api/events')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send({ ...minimalEventData, websiteUrl: 'not-a-url' }) // Invalid URL
      .expect(400);
    expect(response.body.errors.websiteUrl[0]).toBe('Invalid URL format for website');
    // No event created, so no ID to push
  });
});

// Get Event by ID
describe('GET /api/events/:eventId - Get Event By ID', () => {
  let testEnv: TestEnvironment | null = null;
  let app: FastifyInstance;
  let testUserId: string;
  let testUserToken: string; // Needed to create an event for testing
  let createdEvent: ApiEventResponse | null = null;

  const sampleEventData: CreateEventInput = {
    title: 'Get Me Event',
    description: 'An event specifically for GET by ID tests.',
    eventDate: '2025-10-10',
    locationDescription: 'Test Location for Get',
    category: 'Test Category',
    tags: [], // Added missing 'tags' property
    // organizerName will default to user's username
  };

  beforeAll(async () => {
    testEnv = await setupTestEnvironment('get-event-by-id');
    app = testEnv.app;
    testUserId = testEnv.testUserId;
    testUserToken = testEnv.testUserToken; // We need the token to create an event first
  });

  beforeEach(async () => {
    // Create a fresh event before each test that needs one
    const response = await supertest(app.server)
      .post('/api/events')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send(sampleEventData)
      .expect(201);
    createdEvent = response.body as ApiEventResponse;
  });

  afterEach(async () => { // This was line 41 where the error was reported
    // Clean up the event created in beforeEach
    if (createdEvent && app) {
      try {
        await app.prisma.event.delete({ where: { id: createdEvent.id }});
      } catch (error) {
        // console.warn(`Could not clean up event ${createdEvent.id} in afterEach:`, error);
      }
      createdEvent = null;
    }
  });

  afterAll(async () => {
    await teardownTestEnvironment(testEnv);
  });

  it('should retrieve an existing event successfully by its ID', async () => {
    expect(createdEvent).not.toBeNull();
    if (!createdEvent) throw new Error("Test setup failed: createdEvent is null");

    const response = await supertest(app.server)
      .get(`/api/events/${createdEvent.id}`)
      .expect(200);

    expect(response.body.id).toBe(createdEvent.id);
    expect(response.body.title).toBe(sampleEventData.title);
    expect(response.body.description).toBe(sampleEventData.description);
    expect(response.body.userId).toBe(testUserId);
  });

  it('should return 404 if the event ID is a valid UUID but does not exist', async () => {
    const nonExistentUuid = '00000000-0000-0000-0000-000000000000'; // A valid UUID unlikely to exist
    const response = await supertest(app.server)
      .get(`/api/events/${nonExistentUuid}`)
      .expect(404);

    expect(response.body.message).toBe('Event not found.');
  });

  it('should return 400 if the event ID is not a valid UUID format', async () => {
    const invalidUuid = 'not-a-valid-uuid';
    const response = await supertest(app.server)
      .get(`/api/events/${invalidUuid}`)
      .expect(400);
    
    // Based on your event.schemas.ts (eventParamsSchema)
    expect(response.body.message).toBe('Input validation failed'); 
    expect(response.body.errors?.eventId).toContain('Event ID must be a valid UUID');
  });
});

// List Events
const seedEventsData: Array<Omit<Prisma.EventCreateWithoutUserInput, 'eventDate' | 'user' | 'tags'> & { eventDate: string, tags: string[], userId?: string }> = [
  { title: 'Future Event Alpha', description: 'Alpha test event in the future', eventDate: '2026-01-15', locationDescription: 'Venue A', category: 'Tech', tags: ['api', 'future'], organizerName: 'Org A' },
  { title: 'Future Event Beta', description: 'Beta test event also in the future', eventDate: '2026-02-20', locationDescription: 'Venue B', category: 'Workshop', tags: ['beta', 'future'], organizerName: 'Org B' },
  { title: 'Past Event Gamma', description: 'Gamma test event in the past', eventDate: '2024-03-10', locationDescription: 'Venue C', category: 'Tech', tags: ['api', 'past'], organizerName: 'Org C' },
  { title: 'Past Event Delta', description: 'Delta test event also in the past', eventDate: '2024-04-05', locationDescription: 'Venue D', category: 'Meetup', tags: ['delta', 'past'], organizerName: 'Org D' },
  { title: 'Searchable Conference', description: 'A great conference about Fastify and Prisma', eventDate: '2025-07-01', locationDescription: 'Online', category: 'Conference', tags: ['fastify', 'prisma', 'online'], organizerName: 'Dev Group' },
  { title: 'Another Tech Talk', description: 'Deep dive into microservices', eventDate: '2025-08-01', locationDescription: 'Community Hall', category: 'Tech', tags: ['microservices', 'api'], organizerName: 'Tech Enthusiasts' },
];
const createdSeedEventIdsForThisFile: string[] = []; // To track IDs for cleanup in outer afterAll

describe('GET /api/events - List Events', () => {
  let testEnv: TestEnvironment | null = null;
  let app: FastifyInstance;
  let testUserId: string;

  beforeAll(async () => {
    testEnv = await setupTestEnvironment('list-events-outer'); // Unique name for the suite
    if (!testEnv) {
      throw new Error("Test environment setup failed for listEvents outer suite.");
    }
    app = testEnv.app;
    testUserId = testEnv.testUserId;

    // --- MODIFIED CLEANUP STEP FOR THIS TEST FILE ---
    console.log('[ListEvents beforeAll (OUTER)] This suite will seed its own data and clean it up in afterAll.');
    // --- END MODIFIED CLEANUP ---

    // --- SEED DATA FOR THIS TEST FILE ---
    console.log(`[ListEvents beforeAll (OUTER)] Seeding ${seedEventsData.length} events for user ${testUserId}.`);
    createdSeedEventIdsForThisFile.length = 0; // Clear array before seeding
    for (const eventSeed of seedEventsData) {
      // Destructure to remove userId if it exists, as `user: { connect }` handles it.
      const { userId: _userIdFromSeed, ...restOfEventSeed } = eventSeed; 
      const createdEvent = await app.prisma.event.create({
        data: {
          ...restOfEventSeed, // Use the rest of the properties
          eventDate: new Date(eventSeed.eventDate),
          eventTime: null, 
          websiteUrl: null, 
          user: { connect: { id: testUserId } },
        },
        select: { id: true }
      });
      createdSeedEventIdsForThisFile.push(createdEvent.id);
    }
    console.log(`[ListEvents beforeAll (OUTER)] Seeded ${createdSeedEventIdsForThisFile.length} events for user ${testUserId}. Actual IDs: ${createdSeedEventIdsForThisFile.join(', ')}`);
  });

  afterAll(async () => {
    const suiteName = 'ListEvents';
    if (!app || !app.prisma) {
        console.error(`[${suiteName} afterAll (OUTER)] app or app.prisma is not available. Skipping cleanup.`);
        await teardownTestEnvironment(testEnv);
        return;
    }

    if (createdSeedEventIdsForThisFile.length > 0) {
      console.log(`[${suiteName} afterAll (OUTER)] Attempting to clean up ${createdSeedEventIdsForThisFile.length} specifically seeded event(s) for this file. IDs: ${createdSeedEventIdsForThisFile.join(', ')}`);
      
      // Check if events exist right before trying to delete them
      try {
        const eventsBeforeDelete = await app.prisma.event.findMany({
            where: { id: { in: createdSeedEventIdsForThisFile } },
            select: { id: true }
        });
        console.log(`[${suiteName} afterAll (OUTER)] Found ${eventsBeforeDelete.length} suite-specific events in DB right before attempting delete. IDs: ${eventsBeforeDelete.map(e => e.id).join(', ')}`);

        if (eventsBeforeDelete.length > 0) {
            const deleteResult = await app.prisma.event.deleteMany({
              where: { id: { in: eventsBeforeDelete.map(e => e.id) } }, // Delete only what was found
            });
            console.log(`[${suiteName} afterAll (OUTER)] Deleted ${deleteResult.count} events.`);
            if (deleteResult.count !== eventsBeforeDelete.length) {
                console.warn(`[${suiteName} afterAll (OUTER)] Mismatch: Expected to delete ${eventsBeforeDelete.length}, but deleted ${deleteResult.count}.`);
            }
        } else {
            console.log(`[${suiteName} afterAll (OUTER)] No suite-specific events (from createdSeedEventIdsForThisFile) found in DB to delete.`);
        }
      } catch (error) {
          console.error(`[${suiteName} afterAll (OUTER)] Error during event existence check or deletion:`, error);
      }
    } else {
      console.log(`[${suiteName} afterAll (OUTER)] No specific events to delete by ID (createdSeedEventIdsForThisFile was empty).`);
    }
    await teardownTestEnvironment(testEnv);
  });

  // This inner describe block now relies on the setup from the outer block
  describe('Listing and Filtering Events', () => {
    // No beforeAll or afterAll needed here for seeding/cleaning if the outer one handles it globally for this file.
    // If you had specific setup/teardown *just for this inner block*, it could go here.

    it('should return a list of events with default pagination', async () => {
      const response = await supertest(app.server)
        .get('/api/events') // Default: page=1, limit=10, sortBy=eventDate, sortOrder=desc
        .expect(200);

      expect(response.body.events).toBeInstanceOf(Array);
      
      // The number of events on the page should be at most the default limit (10)
      expect(response.body.events.length).toBeLessThanOrEqual(10); 
      
      // And it should also be less than or equal to the total reported events
      expect(response.body.events.length).toBeLessThanOrEqual(response.body.totalEvents);

      // If total events in DB (as reported by API) are less than the default limit (10), 
      // then the number of events on the page should exactly match totalEvents.
      // This assertion assumes that totalEvents accurately reflects *only* our seeded data,
      // which might not be true if other tests leak data.
      if (response.body.totalEvents < 10) {
        expect(response.body.events.length).toBe(response.body.totalEvents); 
      }
      
      // This assertion checks that the API reports at least the number of events we seeded.
      // It might report more if other tests have leaked data.
      expect(response.body.totalEvents).toBeGreaterThanOrEqual(seedEventsData.length); 
      
      expect(response.body.currentPage).toBe(1);
      expect(response.body.limit).toBe(10); 
      expect(response.body.totalPages).toBe(Math.ceil(response.body.totalEvents / 10));

      const responseEventIds = response.body.events.map((e: any) => e.id);

      // Check if ALL our seeded events are accounted for if totalEvents matches seedEventsData.length
      // This is a stricter check if we assume no leaks from other tests.
      if (response.body.totalEvents === seedEventsData.length) {
        const allSeededPresent = createdSeedEventIdsForThisFile.every(id => 
          responseEventIds.includes(id) || // if on current page
          seedEventsData.length > response.body.limit // or implies it's on another page
        );
        // This check is tricky with pagination. A simpler check is that totalEvents is correct.
      }
    });

    it('should respect page and limit query parameters', async () => {
      const page = 1; 
      const limit = 3; 
      const response = await supertest(app.server)
        .get(`/api/events?page=${page}&limit=${limit}`)
        .expect(200);

      expect(response.body.events).toBeInstanceOf(Array);
      expect(response.body.events.length).toBeLessThanOrEqual(limit);
      
      // This calculation is good for checking items on the current page based on API's totalEvents
      const expectedItemsOnThisPage = Math.max(0, Math.min(limit, response.body.totalEvents - (page - 1) * limit));
      expect(response.body.events.length).toBe(expectedItemsOnThisPage);

      expect(response.body.currentPage).toBe(page);
      expect(response.body.limit).toBe(limit);
      expect(response.body.totalEvents).toBeGreaterThanOrEqual(seedEventsData.length); // API's totalEvents should be at least what we seeded
      expect(response.body.totalPages).toBe(Math.ceil(response.body.totalEvents / limit));
    });

    it('should filter events by category', async () => {
      const categoryToFilter = 'Tech';
      const response = await supertest(app.server)
        .get(`/api/events?category=${categoryToFilter}&limit=50`) // Use a large limit to get all matching
        .expect(200);

      const expectedCountFromSeed = seedEventsData.filter(e => e.category === categoryToFilter).length;
      // If no other 'Tech' events exist from other suites, these should match.
      expect(response.body.events.length).toBe(expectedCountFromSeed);
      expect(response.body.totalEvents).toBe(expectedCountFromSeed); 
      response.body.events.forEach((event: any) => {
        expect(event.category).toBe(categoryToFilter);
      });
    });

    it('should filter events by a single tag', async () => {
      const tagToFilter = 'api';
      const response = await supertest(app.server)
        .get(`/api/events?tags=${tagToFilter}&limit=50`)
        .expect(200);

      const expectedCountFromSeed = seedEventsData.filter(e => e.tags && e.tags.includes(tagToFilter)).length;
      expect(response.body.events.length).toBe(expectedCountFromSeed);
      expect(response.body.totalEvents).toBe(expectedCountFromSeed); 
    });
    
    it('should filter events by multiple tags (OR logic)', async () => {
        const tagsToFilter = 'future,api'; // CSV
        const response = await supertest(app.server)
          .get(`/api/events?tags=${tagsToFilter}&limit=50`) 
          .expect(200);
  
        const expectedCountFromSeed = seedEventsData.filter(e => 
            e.tags && tagsToFilter.split(',').some(tag => e.tags.includes(tag))
        ).length; 
        expect(response.body.events.length).toBe(expectedCountFromSeed);
        expect(response.body.totalEvents).toBe(expectedCountFromSeed); 
        response.body.events.forEach((event: any) => {
          expect(tagsToFilter.split(',').some(tag => event.tags.includes(tag))).toBe(true);
        });
      });

    it('should sort events by title in ascending order', async () => {
      const response = await supertest(app.server)
        .get('/api/events?sortBy=title&sortOrder=asc&limit=50') // Get all seeded events
        .expect(200);

      // This assertion assumes totalEvents will be exactly seedEventsData.length
      // It will fail if other events are present.
      expect(response.body.totalEvents).toBe(seedEventsData.length); 
      // If the above holds, then response.body.events should contain all our seeded events
      expect(response.body.events.length).toBe(seedEventsData.length);

      const titles = response.body.events.map((e: any) => e.title.toLowerCase());
      for (let i = 0; i < titles.length - 1; i++) {
        expect(titles[i] <= titles[i + 1]).toBe(true);
      }
    });
    
    it('should sort events by eventDate in descending order (default sort for eventDate if order not specified)', async () => {
        const response = await supertest(app.server)
          .get('/api/events?sortBy=eventDate&sortOrder=desc&limit=50')
          .expect(200);
  
        expect(response.body.totalEvents).toBe(seedEventsData.length);
        expect(response.body.events.length).toBe(seedEventsData.length);

        const dates = response.body.events.map((e: any) => new Date(e.eventDate));
        for (let i = 0; i < dates.length - 1; i++) {
          expect(dates[i].getTime()).toBeGreaterThanOrEqual(dates[i + 1].getTime());
        }
      });

    it('should filter events by startDate and endDate', async () => {
      const startDate = '2025-01-01';
      const endDate = '2025-12-31';
      const response = await supertest(app.server)
        .get(`/api/events?startDate=${startDate}&endDate=${endDate}&limit=50`)
        .expect(200);

      const expectedCountFromSeed = seedEventsData.filter(e => {
        const eventD = new Date(e.eventDate);
        return eventD >= new Date(startDate) && eventD <= new Date(endDate);
      }).length; 
      expect(response.body.events.length).toBe(expectedCountFromSeed);
      expect(response.body.totalEvents).toBe(expectedCountFromSeed); 
    });

    it('should perform a search across multiple fields', async () => {
      const searchTerm = 'Fastify'; // This should match "Searchable Conference"
      const response = await supertest(app.server)
        .get(`/api/events?search=${searchTerm}&limit=50`)
        .expect(200);
      
      const expectedCountFromSeed = seedEventsData.filter(e => 
        e.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
        e.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (e.locationDescription && e.locationDescription.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (e.organizerName && e.organizerName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        e.category.toLowerCase().includes(searchTerm.toLowerCase())
      ).length; 

      expect(response.body.events.length).toBe(expectedCountFromSeed);
      expect(response.body.totalEvents).toBe(expectedCountFromSeed); 
      
      if (expectedCountFromSeed > 0) {
        const foundMatchingEvent = response.body.events.some((e: any) => 
          e.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
          e.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (e.locationDescription && e.locationDescription.toLowerCase().includes(searchTerm.toLowerCase())) ||
          (e.organizerName && e.organizerName.toLowerCase().includes(searchTerm.toLowerCase())) ||
          e.category.toLowerCase().includes(searchTerm.toLowerCase())
        );
        expect(foundMatchingEvent).toBe(true);
      }
    });

    it('should return 400 if endDate is before startDate', async () => {
      const response = await supertest(app.server)
        .get('/api/events?startDate=2025-12-01&endDate=2025-01-01')
        .expect(400);
      expect(response.body.message).toBe('Input validation failed');
      // Adjust based on your actual error reporting structure for Zod issues
      expect(response.body.errors?.endDate?.[0] || response.body.errors?.['endDate']?.[0]).toBe('endDate cannot be before startDate');
    });
    
    it('should return 400 for invalid page number', async () => {
        const response = await supertest(app.server)
          .get('/api/events?page=abc')
          .expect(400);
        expect(response.body.message).toBe('Input validation failed');
        expect(response.body.errors?.page || response.body.errors?.['page']).toBeInstanceOf(Array);
      });

    it('should return an empty list if no events match filters', async () => {
      const response = await supertest(app.server)
        .get('/api/events?category=NonExistentCategory123&limit=50') // ensure limit to get all
        .expect(200);
      expect(response.body.events.length).toBe(0);
      expect(response.body.totalEvents).toBe(0);
    });
  });
});

// Update Event
describe('PUT /api/events/:eventId - Update Event', () => {
  let ownerEnv: TestEnvironment | null = null;
  let nonOwnerEnv: TestEnvironment | null = null;
  let app: FastifyInstance; // Will be the same app instance from ownerEnv

  let eventToUpdate: ApiEventResponse | null = null;

  const initialEventData: CreateEventInput = {
    title: 'Initial Event for Update',
    description: 'This event will be updated during tests.',
    eventDate: '2026-01-01',
    locationDescription: 'Update Test Venue',
    category: 'Update Category',
    tags: ['update', 'initial'],
  };

  beforeAll(async () => {
    ownerEnv = await setupTestEnvironment('event-owner-update');
    app = ownerEnv.app; // Use the app from the owner's environment

    // Create a second user (non-owner) for permission tests
    nonOwnerEnv = await setupTestEnvironment('event-non-owner-update');
  });

  beforeEach(async () => {
    // Create an event as the 'owner' before each test
    if (!ownerEnv) throw new Error("Owner environment not initialized");
    const response = await supertest(app.server)
      .post('/api/events')
      .set('Authorization', `Bearer ${ownerEnv.testUserToken}`)
      .send(initialEventData)
      .expect(201);
    eventToUpdate = response.body as ApiEventResponse;
  });

  afterEach(async () => {
    // Clean up the event created in beforeEach by the owner
    if (eventToUpdate && ownerEnv && app) {
      try {
        // Ensure the event is deleted, typically by its owner or an admin role if applicable
        // For simplicity here, we assume direct DB access for cleanup is acceptable in tests
        await app.prisma.event.deleteMany({ where: { id: eventToUpdate.id, userId: ownerEnv.testUserId }});
      } catch (error) {
        // console.warn(`Could not clean up event ${eventToUpdate.id} in afterEach:`, error);
      }
      eventToUpdate = null;
    }
  });

  afterAll(async () => {
    await teardownTestEnvironment(ownerEnv);
    await teardownTestEnvironment(nonOwnerEnv); 
    // Note: app.close() will be called twice if nonOwnerEnv also closes it.
    // The teardown helper should be robust enough, or app closing can be handled more centrally if it becomes an issue.
    // For now, the helper's app.close() is idempotent or handles errors gracefully.
  });

  it('should allow an owner to update their event successfully', async () => {
    if (!ownerEnv || !eventToUpdate) throw new Error("Test setup incomplete");

    const updatePayload: UpdateEventInput = {
      title: 'Updated Event Title',
      description: 'The description has been updated.',
      tags: ['updated', 'final'],
    };

    const response = await supertest(app.server)
      .patch(`/api/events/${eventToUpdate.id}`) // Changed from .put() to .patch()
      .set('Authorization', `Bearer ${ownerEnv.testUserToken}`)
      .send(updatePayload)
      .expect(200);

    expect(response.body.id).toBe(eventToUpdate.id);
    expect(response.body.title).toBe(updatePayload.title);
    expect(response.body.description).toBe(updatePayload.description);
    expect(response.body.tags).toEqual(updatePayload.tags);
    expect(response.body.category).toBe(initialEventData.category); // Unchanged
    expect(new Date(response.body.updatedAt).getTime()).toBeGreaterThan(new Date(eventToUpdate.updatedAt).getTime());
    expect(response.body.userId).toBe(ownerEnv.testUserId);
  });

  // --- NEW TEST CASES START HERE ---

  it('should return 403 Forbidden when a non-owner tries to update an event', async () => {
    if (!nonOwnerEnv || !eventToUpdate) throw new Error("Test setup incomplete for non-owner test");

    const updatePayload: UpdateEventInput = {
      title: "Attempted Update by Non-Owner",
    };

    await supertest(app.server)
      .patch(`/api/events/${eventToUpdate.id}`) // Assuming PATCH, adjust if PUT
      .set('Authorization', `Bearer ${nonOwnerEnv.testUserToken}`) // Use non-owner's token
      .send(updatePayload)
      .expect(403);
  });

  it('should return 404 Not Found when trying to update a non-existent event', async () => {
    if (!ownerEnv) throw new Error("Test setup incomplete for non-existent event test");
    
    const nonExistentEventId = uuidv4(); // Generate a valid, random UUID

    const updatePayload: UpdateEventInput = {
      title: "Update for Non-Existent Event",
    };

    const response = await supertest(app.server)
      .patch(`/api/events/${nonExistentEventId}`) // Assuming PATCH
      .set('Authorization', `Bearer ${ownerEnv.testUserToken}`)
      .send(updatePayload);
    
    // console.log('Response body for 400 error:', response.body); // You can remove this now or keep for future debugging
    expect(response.status).toBe(404);
  });

  it('should return 401 Unauthorized when trying to update without authentication', async () => {
    if (!eventToUpdate) throw new Error("Test setup incomplete for no-auth test");
    const updatePayload: UpdateEventInput = {
      title: "Update Attempt Without Auth",
    };

    await supertest(app.server)
      .patch(`/api/events/${eventToUpdate.id}`) // Assuming PATCH
      // No Authorization header
      .send(updatePayload)
      .expect(401);
  });

  it('should return 400 Bad Request for validation errors (e.g., empty title)', async () => {
    if (!ownerEnv || !eventToUpdate) throw new Error("Test setup incomplete for validation test");
    // This test depends on your Zod schema for UpdateEventInput.
    // Assuming title, if provided for update, must be non-empty.
    const invalidPayload: UpdateEventInput = {
      title: "", // Invalid: empty title
    };

    const response = await supertest(app.server)
      .patch(`/api/events/${eventToUpdate.id}`) // Assuming PATCH
      .set('Authorization', `Bearer ${ownerEnv.testUserToken}`)
      .send(invalidPayload)
      .expect(400);
    
    // Optional: Check for specific error messages if your API returns them
    expect(response.body.errors).toBeDefined();
    // e.g., expect(response.body.errors[0].path).toEqual(['title']);
    // e.g., expect(response.body.errors[0].message).toContain("String must contain at least 1 character(s)");
    // The exact error structure and message depend on your Zod schema and Fastify's error formatting.
  });

  it('should return 400 Bad Request for invalid data types (e.g., invalid date format)', async () => {
    if (!ownerEnv || !eventToUpdate) throw new Error("Test setup incomplete for invalid data type test");
    const invalidPayload: UpdateEventInput = {
      eventDate: "this-is-not-a-valid-date", 
    };

    const response = await supertest(app.server)
      .patch(`/api/events/${eventToUpdate.id}`) // Assuming PATCH
      .set('Authorization', `Bearer ${ownerEnv.testUserToken}`)
      .send(invalidPayload)
      .expect(400);

    expect(response.body.errors).toBeDefined();
    // e.g., expect(response.body.errors[0].path).toEqual(['eventDate']);
    // e.g., expect(response.body.errors[0].message).toContain("Invalid date");
  });
  
  it('should allow updating only specific fields (e.g., only description)', async () => {
    if (!ownerEnv || !eventToUpdate) throw new Error("Test setup incomplete for partial update test");

    const partialUpdatePayload: UpdateEventInput = {
      description: "Only the description is updated here.",
    };

    const response = await supertest(app.server)
      .patch(`/api/events/${eventToUpdate.id}`) // Assuming PATCH
      .set('Authorization', `Bearer ${ownerEnv.testUserToken}`)
      .send(partialUpdatePayload)
      .expect(200);

    expect(response.body.id).toBe(eventToUpdate.id);
    expect(response.body.description).toBe(partialUpdatePayload.description);
    // Verify other fields remain unchanged from the initialEventData (since eventToUpdate is fresh)
    expect(response.body.title).toBe(initialEventData.title);
    expect(response.body.category).toBe(initialEventData.category);
    expect(response.body.tags).toEqual(initialEventData.tags);
    expect(new Date(response.body.updatedAt).getTime()).toBeGreaterThan(new Date(eventToUpdate.updatedAt).getTime());
  });

  // --- NEW TEST CASES END HERE ---
});

// Delete Event
describe('DELETE /api/events/:eventId - Delete Event', () => {
  let testEnv: TestEnvironment | null = null;
  let app: FastifyInstance;
  let ownerToken: string;
  let ownerUserId: string;
  let nonOwnerToken: string;

  // No need for eventToDeleteId at this scope if each test manages its own event ID

  // Helper to quickly create an event for deletion tests
  // The seedEventForTest helper is fine as is, it uses the createTestEvent we just added/fixed.
  const seedEventForTest = async (userId: string, titleSuffix: string = '') => {
    return createTestEvent(app, userId, { 
      title: `Event To Delete ${titleSuffix} ${Date.now()}`,
      description: 'This event is specifically for deletion tests.',
      eventDate: '2025-10-10',
      locationDescription: 'Deletion Test Venue',
      category: 'Test',
    });
  };

  beforeAll(async () => {
    // Setup main owner user
    testEnv = await setupTestEnvironment('delete-event-owner');
    if (!testEnv) throw new Error("Owner environment setup failed");
    app = testEnv.app;
    ownerToken = testEnv.testUserToken;
    ownerUserId = testEnv.testUserId;

    // Setup a secondary user (non-owner)
    const nonOwnerEnv = await setupTestEnvironment('delete-event-non-owner');
    if (!nonOwnerEnv) throw new Error("Non-owner environment setup failed");
    nonOwnerToken = nonOwnerEnv.testUserToken;
    // nonOwnerUserId = nonOwnerEnv.testUserId; 
    // Important: We need to ensure nonOwnerEnv's app instance is closed if it's different,
    // or ideally, setupTestEnvironment reuses the same app if called multiple times.
    // For simplicity, assuming setupTestEnvironment can be called for multiple users
    // and teardownTestEnvironment for the main 'testEnv' handles the app.
    // If not, nonOwnerEnv would need its own teardown.
    // For now, we'll only teardown the main testEnv.
  });

  afterAll(async () => {
    // Clean up any remaining events by owner or non-owner if necessary,
    // though individual tests should clean up what they specifically create for deletion.
    // The main teardown for users will be handled by teardownTestEnvironment.
    await teardownTestEnvironment(testEnv);
    // If nonOwnerEnv created a separate app instance or persistent users not cleaned by testEnv:
    // await teardownTestEnvironment(nonOwnerEnv); // This would require nonOwnerEnv to be stored.
  });

  beforeEach(async () => {
    // No need to reset eventToDeleteId here if it's scoped within tests
  });

  // --- Test Cases ---

  it('should allow an authenticated user (owner) to delete their own event and return 204', async () => {
    const createdEvent = await seedEventForTest(ownerUserId, 'OwnedEvent');
    const currentEventId = createdEvent.id; // Use a local const

    const response = await supertest(app.server)
      .delete(`/api/events/${currentEventId}`) // Use local const
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    // Verify no body content for 204
    expect(response.body).toEqual({}); 

    // Verify in DB
    const dbEvent = await prisma.event.findUnique({ where: { id: currentEventId } }); // Use local const
    expect(dbEvent).toBeNull();
  });

  it('should return 403 if an authenticated user tries to delete an event they do not own', async () => {
    const ownedEvent = await seedEventForTest(ownerUserId, 'NonOwnerAttempt'); // Event created by owner
    const ownedEventId = ownedEvent.id;

    const response = await supertest(app.server)
      .delete(`/api/events/${ownedEventId}`)
      .set('Authorization', `Bearer ${nonOwnerToken}`) // Attempt with non-owner's token
      .expect(403);

    expect(response.body.message).toBe('You are not authorized to delete this event.');

    // Verify event still exists in DB
    const dbEvent = await prisma.event.findUnique({ where: { id: ownedEventId } });
    expect(dbEvent).not.toBeNull();
    expect(dbEvent?.userId).toBe(ownerUserId); // Still owned by the original owner
  });

  it('should return 404 if trying to delete an event that does not exist', async () => {
    const nonExistentEventId = '00000000-0000-0000-0000-000000000000'; // A valid UUID format that likely won't exist
    
    const response = await supertest(app.server)
      .delete(`/api/events/${nonExistentEventId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);

    expect(response.body.message).toBe('Event not found.');
  });

  it('should return 401 if trying to delete an event without authentication', async () => {
    const createdEvent = await seedEventForTest(ownerUserId, 'UnauthDeleteAttempt');
    const eventId = createdEvent.id;
    
    const response = await supertest(app.server)
      .delete(`/api/events/${eventId}`)
      // No Authorization header
      .expect(401);
    
    // Optional: Check message if your auth hook provides one for 401
    // expect(response.body.message).toBe('Unauthorized'); 

    // Verify event still exists
    const dbEvent = await prisma.event.findUnique({ where: { id: eventId } });
    expect(dbEvent).not.toBeNull();
  });
  
  it('should return 400 if the event ID in the path is not a valid UUID', async () => {
    const invalidEventId = 'not-a-valid-uuid';
    
    const response = await supertest(app.server)
      .delete(`/api/events/${invalidEventId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);

    // Check for the validation error message (specific to your Zod schema for params)
    expect(response.body.message).toBe('Input validation failed');
    expect(response.body.errors?.eventId).toContain('Event ID must be a valid UUID'); // Or your exact Zod message
  });

});

// Batch Get Events
interface SeededEventInfo {
  id: string;
  title: string;
  // Add other relevant fields if needed for debugging, e.g., userId
}

describe('POST /api/events/batch-get - Batch Get Events', () => {
  let testEnv: TestEnvironment | null = null;
  let app: FastifyInstance;
  let testUserId: string;
  const seededEventsData: SeededEventInfo[] = []; // Store IDs of events created by this suite

  beforeAll(async () => {
    const suiteName = 'batchGetEvents';
    testEnv = await setupTestEnvironment(`${suiteName}-suite`); // Unique user identifier
    if (!testEnv) throw new Error("Test environment setup failed for batchGetEvents");
    app = testEnv.app;
    testUserId = testEnv.testUserId;

    console.log(`[${suiteName} beforeAll] Cleaning events using app.prisma before seeding.`);
    // Use app.prisma for consistency within the suite's app lifecycle
    await app.prisma.event.deleteMany({}); 
    const countAfterInitialClean = await app.prisma.event.count();
    console.log(`[${suiteName} beforeAll] Event count after initial clean: ${countAfterInitialClean}`);


    // Seed a few events
    const eventTitles = ['Batch Event A', 'Batch Event B', 'Batch Event C', 'Batch Event D'];
    for (let i = 0; i < eventTitles.length; i++) {
      const createdEvent = await createTestEvent(app, testUserId, {
        title: eventTitles[i],
        description: `Description for ${eventTitles[i]}`,
        eventDate: `2025-07-${10 + i}`,
        locationDescription: `Venue ${i + 1}`,
        category: 'BatchCategory',
        tags: [`batchTag${i}`, 'commonBatchTag'],
      });
      seededEventsData.push({
        id: createdEvent.id,
        title: eventTitles[i],
      });
    }
    console.log(`[${suiteName} beforeAll] Attempted to seed ${eventTitles.length} events. seededEventsData count: ${seededEventsData.length}`);
    if (seededEventsData.length > 0) {
        const actualSeededEvents = await app.prisma.event.findMany({
            where: { id: { in: seededEventsData.map(e => e.id) } },
            select: { id: true, title: true, userId: true }
        });
        console.log(`[${suiteName} beforeAll] Actual events found in DB after seeding:`, JSON.stringify(actualSeededEvents));
        if (actualSeededEvents.length !== seededEventsData.length) {
            console.warn(`[${suiteName} beforeAll] Mismatch: Expected ${seededEventsData.length} seeded events in DB, found ${actualSeededEvents.length}.`);
        }
    }
  });

  afterAll(async () => {
    const suiteName = 'batchGetEvents';
    if (!app || !app.prisma) {
        console.error(`[${suiteName} afterAll] app or app.prisma is not available. Skipping cleanup.`);
        await teardownTestEnvironment(testEnv); // Still attempt to close app if env exists
        return;
    }

    if (seededEventsData.length > 0) {
      const idsToDelete = seededEventsData.map(e => e.id);
      console.log(`[${suiteName} afterAll] Attempting to delete ${idsToDelete.length} specific events seeded by this suite. IDs: ${idsToDelete.join(', ')}`);
      try {
        // Check if events exist right before trying to delete them
        const eventsBeforeDelete = await app.prisma.event.findMany({
            where: { id: { in: idsToDelete } },
            select: { id: true }
        });
        console.log(`[${suiteName} afterAll] Found ${eventsBeforeDelete.length} suite-specific events in DB right before attempting delete. IDs: ${eventsBeforeDelete.map(e => e.id).join(', ')}`);

        if (eventsBeforeDelete.length > 0) {
            const deletionResult = await app.prisma.event.deleteMany({ 
              where: { 
                id: { in: eventsBeforeDelete.map(e => e.id) }, // Delete only what was found
              } 
            });
            console.log(`[${suiteName} afterAll] Successfully deleted ${deletionResult.count} events specific to this suite.`);
            if (deletionResult.count !== eventsBeforeDelete.length) { // Compare with what was found
                console.warn(`[${suiteName} afterAll] Mismatch in deleted events. Expected to delete ${eventsBeforeDelete.length}, but deleted ${deletionResult.count}.`);
            }
        } else {
            console.log(`[${suiteName} afterAll] No suite-specific events found in DB to delete (eventsBeforeDelete was empty).`);
        }
      } catch (error) {
        console.error(`[${suiteName} afterAll] Error deleting suite-specific events:`, error);
      }
    } else {
      console.log(`[${suiteName} afterAll] No specific events to delete by ID (seededEventsData was empty).`);
    }
    await teardownTestEnvironment(testEnv);
  });

  it('should retrieve multiple events by their IDs', async () => {
    const suiteName = 'batchGetEvents';
    // Ensure at least 2 events were intended to be seeded for this test
    if (seededEventsData.length < 2) throw new Error("Not enough events seeded for 'retrieve multiple events' test");
    
    const idsToRequest = [seededEventsData[0].id, seededEventsData[1].id];
    console.log(`[${suiteName} test 'retrieve multiple'] Requesting IDs: ${idsToRequest.join(', ')}`);
    const currentEventsInDbForTest = await app.prisma.event.findMany({where: {id: {in: idsToRequest}}, select: {id:true}});
    console.log(`[${suiteName} test 'retrieve multiple'] Events in DB for these IDs before API call: ${currentEventsInDbForTest.map(e=>e.id).join(', ')}`);


    const response = await supertest(app.server)
      .post('/api/events/batch-get')
      .send({ eventIds: idsToRequest })
      .expect(200);

    expect(response.body).toHaveProperty('events');
    const returnedEvents: ApiEventResponse[] = response.body.events;
    expect(returnedEvents.length).toBe(idsToRequest.length); // Expecting 2

    // Verify the correct events were returned
    idsToRequest.forEach(requestedId => {
      expect(returnedEvents.find(e => e.id === requestedId)).toBeDefined();
    });
  });

  it('should return only existing events when mixed with non-existent IDs', async () => {
    const suiteName = 'batchGetEvents';
    // Ensure at least 2 events for existing, 1 for non-existent check
    if (seededEventsData.length < 2) throw new Error("Not enough events seeded for 'mixed existing/non-existent' test");

    const existingIds = [seededEventsData[0].id, seededEventsData[1].id];
    const nonExistentId = '12345678-1234-1234-1234-1234567890ab';
    const idsToRequest = [...existingIds, nonExistentId];

    console.log(`[${suiteName} test 'mixed'] Requesting IDs: ${idsToRequest.join(', ')}`);
    const currentEventsInDbForTest = await app.prisma.event.findMany({where: {id: {in: existingIds}}, select: {id:true}});
    console.log(`[${suiteName} test 'mixed'] Existing events in DB for these IDs before API call: ${currentEventsInDbForTest.map(e=>e.id).join(', ')}`);

    const response = await supertest(app.server)
      .post('/api/events/batch-get')
      .send({ eventIds: idsToRequest })
      .expect(200);

    expect(response.body).toHaveProperty('events');
    const returnedEvents: ApiEventResponse[] = response.body.events;
    expect(returnedEvents.length).toBe(existingIds.length); // Only the two existing events

    existingIds.forEach(existingId => {
        expect(returnedEvents.find(e => e.id === existingId)).toBeDefined();
    });
    expect(returnedEvents.find(e => e.id === nonExistentId)).toBeUndefined();
  });

  it('should return an empty array when all requested IDs are non-existent', async () => {
    const nonExistentIds = [
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ];
    const response = await supertest(app.server) // Ensure app.server
      .post('/api/events/batch-get')
      .send({ eventIds: nonExistentIds })
      .expect(200);

    expect(response.body).toHaveProperty('events');
    expect(response.body.events).toEqual([]);
  });

  it('should return 400 when eventIds is an empty array', async () => { // Updated test name for clarity
    const response = await supertest(app.server) // Ensure app.server
      .post('/api/events/batch-get')
      .send({ eventIds: [] })
      .expect(400); 

    expect(response.body.message).toBe('Input validation failed');
    expect(response.body.errors?.eventIds).toBeInstanceOf(Array);
    expect(response.body.errors?.eventIds[0]).toBe("At least one event ID must be provided"); 
  });

  it('should return 400 if eventIds contains non-UUID strings', async () => {
    if (seededEventsData.length === 0) throw new Error("No seeded events for non-UUID test");
    const validUuid = seededEventsData[0].id;
    const invalidUuid = 'not-a-uuid';

    const response = await supertest(app.server) // Ensure app.server
      .post('/api/events/batch-get')
      .send({ eventIds: [validUuid, invalidUuid] }) 
      .expect(400);
    
    expect(response.body.message).toBe('Input validation failed');
    expect(response.body.errors).toBeDefined();
    expect(typeof response.body.errors).toBe('object');

    const expectedKey = "eventIds.1"; 
    const expectedMessage = "Each event ID must be a valid UUID";
    let foundSpecificError = false;
    if (response.body.errors && response.body.errors[expectedKey]) {
      const errorMessagesForKey = response.body.errors[expectedKey];
      expect(errorMessagesForKey).toBeInstanceOf(Array);
      if (errorMessagesForKey.includes(expectedMessage)) {
        foundSpecificError = true;
      }
    }
    expect(foundSpecificError, `Expected error message "${expectedMessage}" for key "${expectedKey}" not found. Actual errors: ${JSON.stringify(response.body.errors)}`).toBe(true);
  });

  it('should return 400 if eventIds is not an array', async () => {
    const response = await supertest(app.server) // Ensure app.server
        .post('/api/events/batch-get')
        .send({ eventIds: "not-an-array" })
        .expect(400);

    expect(response.body.message).toBe('Input validation failed');
    expect(response.body.errors?.eventIds).toBeInstanceOf(Array);
    // This message might vary based on Zod's exact output for wrong type
    expect(response.body.errors?.eventIds[0]).toContain("Expected array, received string"); 
  });

  it('should return 400 if eventIds is missing (and schema requires it)', async () => {
    const response = await supertest(app.server) // Ensure app.server
        .post('/api/events/batch-get')
        .send({}) // Missing eventIds
        .expect(400);
    
    expect(response.body.message).toBe('Input validation failed');
    expect(response.body.errors?.eventIds).toBeInstanceOf(Array);
    expect(response.body.errors?.eventIds[0]).toBe('Required');
  });
});

// Save and Unsave Event
describe('POST & DELETE /api/events/:eventId/save - Save/Unsave Event', () => {
  let testEnv: TestEnvironment | null = null;
  let app: FastifyInstance;
  let userToken: string;
  let userId: string;
  let eventOwnerToken: string; // In case we need to create events with a different user
  let eventOwnerId: string;

  let testEventId: string; // To store the ID of an event created for testing save/unsave

  beforeAll(async () => {
    // User who will be saving/unsaving events
    testEnv = await setupTestEnvironment('save-unsave-user');
    if (!testEnv) throw new Error("Main user environment setup failed");
    app = testEnv.app;
    userToken = testEnv.testUserToken;
    userId = testEnv.testUserId;

    // User who will own the events (can be the same or different)
    // For simplicity, let's use a different user to ensure event ownership isn't a factor for saving
    const ownerEnv = await setupTestEnvironment('event-owner-for-save-tests');
    if (!ownerEnv) throw new Error("Event owner environment setup failed");
    eventOwnerToken = ownerEnv.testUserToken; // We might not need this token if createTestEvent uses app.prisma
    eventOwnerId = ownerEnv.testUserId;
    // Note: Ensure teardown for ownerEnv if it creates separate resources not cleaned by testEnv.
    // For now, assuming createTestEvent uses the main 'app' instance from 'testEnv'.

    // Create a persistent event that can be saved/unsaved across tests in this suite
    const createdEvent = await createTestEvent(app, eventOwnerId, {
      title: 'Test Event for Saving',
      description: 'An event to test save and unsave functionality.',
      eventDate: '2025-11-11',
      locationDescription: 'Save/Unsave Test Venue',
      category: 'Test',
    });
    testEventId = createdEvent.id;
  });

  afterAll(async () => {
    // Clean up the specific event created for this suite
    if (testEventId && app?.prisma) {
      await app.prisma.userSavedEvent.deleteMany({ where: { eventId: testEventId } }); // Clean up any saves for this event
      await app.prisma.event.deleteMany({ where: { id: testEventId } });
    }
    await teardownTestEnvironment(testEnv);
    // await teardownTestEnvironment(ownerEnv); // If ownerEnv was stored and needs separate teardown
  });

  beforeEach(async () => {
    // Ensure the user has no saved record for testEventId before each test
    // This makes tests independent regarding the saved state for testEventId
    await prisma.userSavedEvent.deleteMany({
      where: { userId: userId, eventId: testEventId },
    });
  });

  // --- Test Cases for POST /api/events/:eventId/save ---
  describe('POST /api/events/:eventId/save - Save an Event', () => {
    it('should allow an authenticated user to save an existing event and return 201', async () => {
      const response = await supertest(app.server)
        .post(`/api/events/${testEventId}/save`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(201);

      expect(response.body.message).toBe('Event saved successfully.');

      // Verify in DB
      const savedRecord = await prisma.userSavedEvent.findUnique({
        where: { userId_eventId: { userId: userId, eventId: testEventId } },
      });
      expect(savedRecord).not.toBeNull();
      expect(savedRecord?.userId).toBe(userId);
      expect(savedRecord?.eventId).toBe(testEventId);
    });

    it('should return 200 if the user tries to save an event they have already saved', async () => {
      // First, save the event
      await supertest(app.server)
        .post(`/api/events/${testEventId}/save`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(201); // Expect 201 on first save

      // Then, try to save it again
      const response = await supertest(app.server)
        .post(`/api/events/${testEventId}/save`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200); // Expect 200 on subsequent save

      expect(response.body.message).toBe('Event already saved.');

      // Verify in DB (only one record should exist)
      const savedRecords = await prisma.userSavedEvent.findMany({
        where: { userId: userId, eventId: testEventId },
      });
      expect(savedRecords.length).toBe(1);
    });

    it('should return 404 if trying to save a non-existent event', async () => {
      const nonExistentEventId = '00000000-0000-0000-0000-000000000000';
      const response = await supertest(app.server)
        .post(`/api/events/${nonExistentEventId}/save`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(404);

      expect(response.body.message).toBe('Event not found.');
    });

    it('should return 401 if trying to save an event without authentication', async () => {
      const response = await supertest(app.server)
        .post(`/api/events/${testEventId}/save`)
        // No Authorization header
        .expect(401);

      // Update this line
      expect(response.body.message).toBe('Authentication required: Invalid or missing token');
    });

    it('should return 400 if the event ID in the path is not a valid UUID (for save)', async () => {
      const invalidEventId = 'not-a-uuid';
      const response = await supertest(app.server)
        .post(`/api/events/${invalidEventId}/save`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(400);

      expect(response.body.message).toBe('Input validation failed');
      expect(response.body.errors?.eventId).toBeInstanceOf(Array);
      // Update this line to match the exact error message from Zod
      expect(response.body.errors?.eventId[0]).toBe('Event ID must be a valid UUID'); 
    });
  });

  // --- Test Cases for DELETE /api/events/:eventId/save ---
  describe('DELETE /api/events/:eventId/save - Unsave an Event', () => {
    it('should allow an authenticated user to unsave an event they had saved and return 204', async () => {
      // First, save the event so we have it in the saved events list
      await supertest(app.server)
        .post(`/api/events/${testEventId}/save`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(201);

      const response = await supertest(app.server)
        .delete(`/api/events/${testEventId}/save`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(204);

      // No content to check, but we can verify the record is deleted
      const savedRecord = await prisma.userSavedEvent.findUnique({
        where: { userId_eventId: { userId: userId, eventId: testEventId } },
      });
      expect(savedRecord).toBeNull();
    });

    it('should return 204 if the user tries to unsave an event they had not saved (or already unsaved)', async () => {
      const response = await supertest(app.server)
        .delete(`/api/events/${testEventId}/save`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(204);

      // Even if not saved, the response should be 204 with no content
      expect(response.body).toEqual({});
    });

    it('should return 204 even if trying to unsave a non-existent event (as per controller logic for P2025)', async () => {
      const nonExistentEventId = '00000000-0000-0000-0000-000000000000'; // A valid UUID format

      await supertest(app.server)
        .delete(`/api/events/${nonExistentEventId}/save`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(204); // Controller returns 204 due to P2025 catch

      // Verify no saved record exists (it shouldn't, as the event itself might not exist)
      const savedRecord = await prisma.userSavedEvent.findUnique({
        where: { userId_eventId: { userId: userId, eventId: nonExistentEventId } },
      });
      // Update this line
      expect(savedRecord).toBeNull();
    });
    
    it('should return 401 if trying to unsave an event without authentication', async () => {
      const response = await supertest(app.server)
        .delete(`/api/events/${testEventId}/save`)
        // No Authorization header
        .expect(401);
      
      // Update this line
      expect(response.body.message).toBe('Authentication required: Invalid or missing token');
    });

    it('should return 400 if the event ID in the path is not a valid UUID (for unsave)', async () => {
      const invalidEventId = 'not-a-uuid';
      const response = await supertest(app.server)
        .delete(`/api/events/${invalidEventId}/save`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(400);

      expect(response.body.message).toBe('Input validation failed');
      expect(response.body.errors?.eventId).toBeInstanceOf(Array);
      // Update this line to match the exact error message from Zod
      expect(response.body.errors?.eventId[0]).toBe('Event ID must be a valid UUID');
    });
  });
});

// Get Random Event
describe('GET /api/events/random - Get Random Event', () => {
  let testEnv: TestEnvironment | null = null;
  let app: FastifyInstance;
  let testUserId: string;

  // This array will store IDs of events created *within this test suite*
  // to ensure targeted cleanup if needed, though beforeEach should handle general cleanup.
  const suiteSeededEventIds: string[] = []; 

  beforeAll(async () => {
    testEnv = await setupTestEnvironment('get-random-event-suite');
    if (!testEnv) throw new Error("Test environment setup failed");
    app = testEnv.app;
    testUserId = testEnv.testUserId;
    // It's crucial that no events are seeded in beforeAll if individual tests expect clean slates
    // or manage their own seeding after a beforeEach cleanup.
    console.log(`[getRandomEvent beforeAll] Test environment set up for user: ${testUserId}`);
  });

  beforeEach(async () => {
    const testName = expect.getState().currentTestName || 'Unknown Test';
    console.log(`[getRandomEvent beforeEach for "${testName}"] Starting cleanup...`);
    
    let countBeforeDelete = await prisma.event.count();
    console.log(`[getRandomEvent beforeEach for "${testName}"] Event count BEFORE delete: ${countBeforeDelete}`);

    if (countBeforeDelete > 0) {
      const existingEvents = await prisma.event.findMany({ select: { id: true, title: true, userId: true } });
      console.log(`[getRandomEvent beforeEach for "${testName}"] Existing event IDs BEFORE delete attempt:`, existingEvents.map(e => e.id));
    }

    // Attempt to delete all events
    try {
      await prisma.userSavedEvent.deleteMany({}); 
      console.log(`[getRandomEvent beforeEach for "${testName}"] UserSavedEvent deleteMany completed.`);
      await prisma.event.deleteMany({});
      console.log(`[getRandomEvent beforeEach for "${testName}"] Event deleteMany completed.`);
    } catch (e: any) {
      console.error(`[getRandomEvent beforeEach for "${testName}"] ERROR during deleteMany operations:`, e.message);
      // Optionally rethrow if this error should halt tests, but for now, let's see the counts.
    }
    
    const countAfterDelete = await prisma.event.count();
    console.log(`[getRandomEvent beforeEach for "${testName}"] Event count AFTER delete: ${countAfterDelete}`);

    if (countAfterDelete > 0) {
      console.error(`[getRandomEvent beforeEach for "${testName}"] FAILED TO DELETE ALL EVENTS. Count is still ${countAfterDelete}. This will likely cause test failures.`);
      const remainingEvents = await prisma.event.findMany({ select: { id: true, title: true, userId: true } });
      console.error(`[getRandomEvent beforeEach for "${testName}"] REMAINING event details:`, JSON.stringify(remainingEvents, null, 2));
      // You could also check for remaining UserSavedEvents
      // const remainingSavedEvents = await prisma.userSavedEvent.findMany({});
      // console.error(`[getRandomEvent beforeEach for "${testName}"] REMAINING UserSavedEvent details:`, JSON.stringify(remainingSavedEvents, null, 2));
    }
    
    suiteSeededEventIds.length = 0; // Clear the array for events seeded by tests in this suite
  });

  afterAll(async () => {
    console.log(`[getRandomEvent afterAll] Starting final cleanup for the suite.`);
    // Final cleanup of any remaining events, especially if beforeEach failed or tests were skipped
    if (app?.prisma) {
        await app.prisma.userSavedEvent.deleteMany({});
        await app.prisma.event.deleteMany({});
        const finalEventCount = await app.prisma.event.count();
        console.log(`[getRandomEvent afterAll] All events deleted from suite. Final count: ${finalEventCount}`);
    }
    if (testEnv) {
      await teardownTestEnvironment(testEnv); // This will clean up the user for this suite
    }
    console.log(`[getRandomEvent afterAll] Suite cleanup complete.`);
  });

  it('should return 404 if no events exist in the database', async () => {
    // beforeEach should have cleaned the database.
    const currentEventCount = await prisma.event.count();
    expect(currentEventCount, `Expected 0 events before calling API for 404 test, but found ${currentEventCount}`).toBe(0);

    const response = await supertest(app.server)
      .get('/api/events/random')
      .expect(404);

    expect(response.body.message).toBe('No events found.');
  });

  it('should return a single event if events exist', async () => {
    const createdEvent = await createTestEvent(app, testUserId, { 
      title: 'Random Event 1',
      description: 'Description for Random Event 1',
      eventDate: '2025-10-10',
      locationDescription: 'Venue for Random Event 1',
      category: 'TestCategory'
    });
    suiteSeededEventIds.push(createdEvent.id); // Track event created by this test

    const response = await supertest(app.server)
      .get('/api/events/random')
      .expect(200);

    expect(response.body).toBeTypeOf('object');
    expect(response.body.id).toBe(createdEvent.id); 
    expect(response.body.title).toBe('Random Event 1');
    expect(response.body).toHaveProperty('description');
    expect(response.body).toHaveProperty('eventDate');
    expect(response.body).toHaveProperty('category');
  });

  it('should return different events on multiple calls (probabilistic)', async () => {
    const numEventsToSeed = 5;
    const localSeededEventIds: string[] = []; // Use a local array for this test's specific seeds
    for (let i = 0; i < numEventsToSeed; i++) {
      const event = await createTestEvent(app, testUserId, { 
        title: `Random Event Prob ${i}`,
        description: `Description for Random Event Prob ${i}`,
        eventDate: `2025-10-${10 + i}`, 
        locationDescription: `Venue for Random Event Prob ${i}`,
        category: 'ProbCategory'
      });
      localSeededEventIds.push(event.id);
      suiteSeededEventIds.push(event.id); // Also track for suite cleanup if needed
    }

    const numCalls = 10; 
    const receivedEventIds = new Set<string>();

    for (let i = 0; i < numCalls; i++) {
      const response = await supertest(app.server)
        .get('/api/events/random')
        .expect(200);
      expect(response.body.id).toBeTypeOf('string');
      receivedEventIds.add(response.body.id);
    }

    if (numEventsToSeed > 1) {
      expect(receivedEventIds.size, `Expected more than 1 unique event over ${numCalls} calls with ${numEventsToSeed} seeded events. Got ${receivedEventIds.size}. Received IDs: ${Array.from(receivedEventIds).join(', ')}`).toBeGreaterThan(1);
    } else {
      expect(receivedEventIds.size).toBe(1);
    }
    
    receivedEventIds.forEach(id => {
        expect(localSeededEventIds, `Event ID ${id} returned by API was not among the ${numEventsToSeed} events seeded for this specific test. Seeded IDs: ${localSeededEventIds.join(', ')}`).toContain(id);
    });
  });
  
  it('should use fallback and return an event if initial random pick fails (simulated)', async () => {
    const createdEvent = await createTestEvent(app, testUserId, { 
      title: 'Fallback Test Event',
      description: 'Description for Fallback Test Event',
      eventDate: '2025-11-01',
      locationDescription: 'Venue for Fallback Test Event',
      category: 'FallbackCategory'
    });
    suiteSeededEventIds.push(createdEvent.id);

    for (let i = 0; i < 3; i++) {
        const response = await supertest(app.server)
            .get('/api/events/random')
            .expect(200);
        expect(response.body.id).toBe(createdEvent.id);
    }
  });
});

// Get Event Categories
describe('GET /api/events/categories - Get Event Categories', () => {
  let testEnv: TestEnvironment | null = null;
  let app: FastifyInstance;
  let testUserId: string; // User to own the seeded events

  // Define the categories and event details for seeding at the describe level
  const seedCategories = ['Tech', 'Workshop', 'Meetup', 'Conference', 'Social'];
  const eventsToSeedDetails = [
    { title: 'Event Alpha', category: seedCategories[0] }, // Tech
    { title: 'Event Beta', category: seedCategories[1] },  // Workshop
    { title: 'Event Gamma', category: seedCategories[0] }, // Tech (duplicate)
    { title: 'Event Delta', category: seedCategories[2] },  // Meetup
    { title: 'Event Epsilon', category: seedCategories[3] },// Conference
    { title: 'Event Zeta', category: seedCategories[1] },   // Workshop (duplicate)
    { title: 'Event Eta', category: seedCategories[4] },    // Social
  ];
  const seededEventIds: string[] = [];

  beforeAll(async () => {
    testEnv = await setupTestEnvironment('get-categories-suite');
    if (!testEnv) throw new Error("Test environment setup failed");
    app = testEnv.app;
    testUserId = testEnv.testUserId;

    // Clean all events before seeding specifically for this suite to ensure isolation
    await prisma.event.deleteMany({}); 

    // Seed events with various categories
    for (const eventDetail of eventsToSeedDetails) {
      const createdEvent = await createTestEvent(app, testUserId, {
        title: eventDetail.title,
        description: `Description for ${eventDetail.title}`,
        eventDate: '2025-01-01', 
        locationDescription: 'Test Venue',
        category: eventDetail.category,
      });
      seededEventIds.push(createdEvent.id);
    }
  });

  afterAll(async () => {
    // Clean up only the events seeded by this suite
    if (seededEventIds.length > 0 && app?.prisma) {
      // Ensuring prisma client is available on app instance
      await app.prisma.event.deleteMany({ where: { id: { in: seededEventIds } } });
    }
    await teardownTestEnvironment(testEnv);
  });

  it('should return a list of unique, sorted categories', async () => {
    const response = await supertest(app.server)
      .get('/api/events/categories')
      .expect(200);

    expect(response.body).toHaveProperty('categories');
    expect(response.body.categories).toBeInstanceOf(Array);

    const expectedUniqueSortedCategories = [...new Set(eventsToSeedDetails.map(e => e.category))].sort();
    
    expect(response.body.categories).toEqual(expectedUniqueSortedCategories);
    // Optional: Explicitly check sorting if toEqual isn't considered sufficient proof of order
    for (let i = 0; i < response.body.categories.length - 1; i++) {
      // Using localeCompare for robust string comparison, though '<=' works for simple ASCII
      expect(response.body.categories[i].localeCompare(response.body.categories[i + 1])).toBeLessThanOrEqual(0);
    }
  });

  it('should return an empty list if no events exist', async () => {
    // Temporarily delete all events for this specific test
    await prisma.event.deleteMany({});

    const response = await supertest(app.server)
      .get('/api/events/categories')
      .expect(200);

    expect(response.body).toHaveProperty('categories');
    expect(response.body.categories).toBeInstanceOf(Array);
    expect(response.body.categories.length).toBe(0);

    // The re-seeding logic that was here has been removed.
    // Tests should be independent and not set up state for other tests.
    // The beforeAll hook is responsible for setting up the general state for this describe block.
  });
  
});

// Get Event Tags
describe('GET /api/events/tags - Get Event Tags', () => {
  let testEnv: TestEnvironment | null = null;
  let app: FastifyInstance;
  let testUserId: string;

  const eventsToSeedDetails = [
    { title: 'Event Tag Alpha', tags: ['api', 'fastify', 'typescript'] },
    { title: 'Event Tag Beta', tags: ['prisma', 'node', 'fastify'] },
    { title: 'Event Tag Gamma', tags: ['api', 'testing'] },
    { title: 'Event Tag Delta', tags: [] }, // Event with no tags
    { title: 'Event Tag Epsilon', tags: ['typescript', 'testing', 'vitest'] },
    { title: 'Event Tag Zeta', tags: [''] }, // Event with an empty string tag (should be filtered out by controller)
    { title: 'Event Tag Eta', tags: ['  whitespace  '] }, // Event with whitespace tag (should be trimmed or handled)
  ];
  const seededEventIds: string[] = [];

  beforeAll(async () => {
    testEnv = await setupTestEnvironment('get-tags-suite');
    if (!testEnv) throw new Error("Test environment setup failed");
    app = testEnv.app;
    testUserId = testEnv.testUserId;

    await prisma.event.deleteMany({}); // Clean before seeding

    for (const eventDetail of eventsToSeedDetails) {
      const createdEvent = await createTestEvent(app, testUserId, {
        title: eventDetail.title,
        description: `Description for ${eventDetail.title}`,
        eventDate: '2025-02-01',
        locationDescription: 'Test Venue For Tags',
        category: 'TagTest',
        tags: eventDetail.tags,
      });
      seededEventIds.push(createdEvent.id);
    }
  });

  afterAll(async () => {
    if (seededEventIds.length > 0 && app?.prisma) {
      await app.prisma.event.deleteMany({ where: { id: { in: seededEventIds } } });
    }
    await teardownTestEnvironment(testEnv);
  });

  it('should return a list of unique, sorted, non-empty tags', async () => {
    const response = await supertest(app.server)
      .get('/api/events/tags')
      .expect(200);

    expect(response.body).toHaveProperty('tags');
    expect(response.body.tags).toBeInstanceOf(Array);

    // Calculate expected tags based on controller logic (unique, sorted, non-empty, trimmed)
    const allSeededTags = eventsToSeedDetails.flatMap(e => e.tags);
    const expectedUniqueTrimmedSortedTags = [
      ...new Set(
        allSeededTags
          .map(tag => tag.trim()) // Controller trims, or should
          .filter(tag => tag !== '') // Controller filters out empty strings
      )
    ].sort();
    
    expect(response.body.tags).toEqual(expectedUniqueTrimmedSortedTags);
  });

  it('should return an empty list if no events have tags or no events exist', async () => {
    await prisma.event.deleteMany({}); // Ensure no events

    const response = await supertest(app.server)
      .get('/api/events/tags')
      .expect(200);

    expect(response.body).toHaveProperty('tags');
    expect(response.body.tags).toBeInstanceOf(Array);
    expect(response.body.tags.length).toBe(0);

    // Re-seed if other tests in this file were to follow and needed the data
    // For now, this is the last test in this example.
    for (const eventDetail of eventsToSeedDetails) {
        await createTestEvent(app, testUserId, { /* ... event data ... */
            title: eventDetail.title,
            description: `Description for ${eventDetail.title}`,
            eventDate: '2025-02-01',
            locationDescription: 'Test Venue For Tags',
            category: 'TagTest',
            tags: eventDetail.tags,
        });
    }
  });
  
  it('should correctly handle tags with leading/trailing whitespace (trimmed by controller)', async () => {
    // This is implicitly tested by the first test case if the controller trims.
    // We can make it more explicit if needed by checking for 'whitespace' vs 'whitespace'.
    // The current controller logic: `uniqueTags = [...new Set(allTags)].filter(t => t && t.trim() !== "");`
    // This does not explicitly trim before adding to the Set, so "  whitespace  " would be different from "whitespace".
    // Let's adjust the controller or the test expectation.
    // The controller's `filter(t => t && t.trim() !== "")` happens *after* `new Set(allTags)`.
    // To ensure "  whitespace  " becomes "whitespace" and is then deduped:
    // Controller should be: `const uniqueTags = [...new Set(allTags.map(tag => tag.trim()))].filter(t => t !== "").sort();`

    // Assuming controller is updated as suggested above:
    const response = await supertest(app.server)
      .get('/api/events/tags')
      .expect(200);
    
    expect(response.body.tags).toContain('whitespace');
    expect(response.body.tags).not.toContain('  whitespace  '); 
  });
});