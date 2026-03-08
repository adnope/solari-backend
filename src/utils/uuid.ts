import { v7 } from "@std/uuid";

export function newUUIDv7(): string {
  return v7.generate();
}
