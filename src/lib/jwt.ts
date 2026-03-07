import "@std/dotenv/load";
import jwt from "jsonwebtoken";

export type AccessTokenPayload = {
  sub: string; // user id
  sid: string; // session id
  type: "access";
};

const JWT_SECRET = Deno.env.get("JWT_SECRET");
if (!JWT_SECRET) {
  throw new Error("Missing JWT_SECRET in environment.");
}

const ACCESS_TOKEN_EXPIRES_IN = Deno.env.get("ACCESS_TOKEN_EXPIRES_IN") ??
  "15m";

export function createAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, JWT_SECRET, {
    algorithms: ["HS256"],
  });

  if (
    typeof decoded !== "object" ||
    decoded === null ||
    decoded.type !== "access" ||
    typeof decoded.sub !== "string" ||
    typeof decoded.sid !== "string"
  ) {
    throw new Error("Invalid access token payload.");
  }

  return {
    sub: decoded.sub,
    sid: decoded.sid,
    type: "access",
  };
}
