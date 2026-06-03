import { randomBytes } from "node:crypto";

function byteToHex(byte: number): string {
  return byte.toString(16).padStart(2, "0");
}

export function createUuidV7(): string {
  const timestampMs = BigInt(Date.now());

  if (timestampMs > 0xffffffffffffn) {
    throw new Error("Current timestamp exceeds UUIDv7 48-bit timestamp range.");
  }

  const bytes = new Uint8Array(16);
  bytes[0] = Number((timestampMs >> 40n) & 0xffn);
  bytes[1] = Number((timestampMs >> 32n) & 0xffn);
  bytes[2] = Number((timestampMs >> 24n) & 0xffn);
  bytes[3] = Number((timestampMs >> 16n) & 0xffn);
  bytes[4] = Number((timestampMs >> 8n) & 0xffn);
  bytes[5] = Number(timestampMs & 0xffn);

  const randA = randomBytes(2);
  const randB = randomBytes(8);

  bytes[6] = 0x70 | (randA[0]! >> 4);
  bytes[7] = ((randA[0]! & 0x0f) << 4) | (randA[1]! >> 4);
  bytes[8] = 0x80 | (randB[0]! & 0x3f);
  bytes.set(randB.subarray(1), 9);

  const hex = Array.from(bytes, byteToHex).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
