import argon2 from "argon2";

const passwordHashOptions: argon2.Options & { type: number } = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};

export async function hashPassword(secret: string): Promise<string> {
  return await argon2.hash(secret, passwordHashOptions);
}

export async function verifyPassword(secret: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, secret);
  } catch (error) {
    console.warn("[WARN] Password hash verification failed.", error);
    return false;
  }
}
