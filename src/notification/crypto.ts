import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
} from 'node:crypto';

const SALT = 'nudge-smtp-v1';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH = 'sha256';

function deriveKey(): Buffer {
  const password = process.env.IRON_SESSION_PASSWORD;
  if (!password) {
    throw new Error('IRON_SESSION_PASSWORD env var is missing');
  }
  return pbkdf2Sync(password, SALT, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_HASH);
}

/**
 * Encrypts a plain-text SMTP password using AES-256-GCM.
 * Returns a base64-encoded string in the format: iv.enc.tag
 */
export function encryptSmtpPassword(plain: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    enc.toString('base64'),
    tag.toString('base64'),
  ].join('.');
}

/**
 * Decrypts an AES-256-GCM encrypted SMTP password.
 * Throws if IRON_SESSION_PASSWORD is missing or ciphertext is tampered.
 */
export function decryptSmtpPassword(encoded: string): string {
  const key = deriveKey();
  const parts = encoded.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid encoded format: expected iv.enc.tag');
  }
  const iv = Buffer.from(parts[0], 'base64');
  const enc = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}
