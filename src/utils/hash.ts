import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10; // Or a value from environment variables for more flexibility

/**
 * Hashes a plain-text password.
 * @param password The plain-text password to hash.
 * @returns A promise that resolves to the hashed password.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  const hashedPassword = await bcrypt.hash(password, salt);
  return hashedPassword;
}

/**
 * Compares a plain-text password with a stored hash.
 * @param password The plain-text password to compare.
 * @param hash The stored password hash to compare against.
 * @returns A promise that resolves to true if the passwords match, false otherwise.
 */
export async function comparePasswords(password: string, hash: string): Promise<boolean> {
  const isMatch = await bcrypt.compare(password, hash);
  return isMatch;
}