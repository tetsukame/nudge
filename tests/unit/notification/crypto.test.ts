import { describe, it, expect, beforeEach } from 'vitest';
import {
  encryptSmtpPassword,
  decryptSmtpPassword,
} from '../../../src/notification/crypto.js';

describe('SMTP password crypto', () => {
  beforeEach(() => {
    process.env.IRON_SESSION_PASSWORD = 'test-password-32-chars-minimum-aaaa';
  });

  it('encrypt/decrypt round-trip', () => {
    const plain = 'my-secret-smtp-password!';
    const encoded = encryptSmtpPassword(plain);
    const decoded = decryptSmtpPassword(encoded);
    expect(decoded).toBe(plain);
  });

  it('produces different ciphertexts for the same input (random IV)', () => {
    const plain = 'same-password';
    const enc1 = encryptSmtpPassword(plain);
    const enc2 = encryptSmtpPassword(plain);
    expect(enc1).not.toBe(enc2);
  });

  it('throws on tampered ciphertext (flipped char in middle part)', () => {
    const plain = 'valid-password';
    const encoded = encryptSmtpPassword(plain);
    const parts = encoded.split('.');
    // Flip a character in the enc (middle) part
    const enc = parts[1];
    const tampered =
      enc[0] === 'A' ? enc.replace('A', 'B') : enc.replace(enc[0], 'A');
    const tamperedEncoded = [parts[0], tampered, parts[2]].join('.');
    expect(() => decryptSmtpPassword(tamperedEncoded)).toThrow();
  });
});
