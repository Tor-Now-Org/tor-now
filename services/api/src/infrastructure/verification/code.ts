import type { CodeGenerator, CodeHasher } from "../../ports/verification.ts";

/**
 * Codes are numeric so they can be typed on a phone keypad, and drawn from a
 * cryptographic source rather than Math.random — a guessable code is the whole
 * credential under ADR 0004.
 */
export const randomDigitsGenerator: CodeGenerator = {
  generate(length) {
    const digits = new Uint32Array(length);
    crypto.getRandomValues(digits);
    return Array.from(digits, (value) => String(value % 10)).join("");
  },
};

const encoder = new TextEncoder();

const digest = async (phone: string, code: string): Promise<string> => {
  // The phone number salts the hash, so identical codes issued to different
  // numbers do not share a digest, and a stolen table cannot be attacked once
  // for all rows at the same time.
  const bytes = encoder.encode(`${phone}:${code}`);
  const hashed = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashed), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

/**
 * Comparison is length-independent and constant-time over the digest, so the
 * time a rejection takes says nothing about how much of the code was right.
 */
const equalsInConstantTime = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

export const sha256Hasher: CodeHasher = {
  hash: digest,
  async verify(phone, code, hash) {
    return equalsInConstantTime(await digest(phone, code), hash);
  },
};
