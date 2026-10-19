import { Scrypt } from "lucia";

const scrypt = new Scrypt();

export async function hashPassword(password: string) {
  return await scrypt.hash(password);
}

export async function verifyPassword(storedHash: string, password: string) {
  return await scrypt.verify(storedHash, password);
}
