import jwt from "jsonwebtoken";

const JWT_SECRET = process.env["JWT_SECRET"] as string;
const ACCESS_TOKEN_EXPIRES_IN = process.env["ACCESS_TOKEN_EXPIRES_IN"] ?? "30m";

if (!JWT_SECRET) {
  throw new Error("FATAL: Missing JWT_SECRET in environment variables.");
}

export type AccessTokenPayload = {
  sub: string;
  sid: string;
  type: "access";
};

export function createAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: ACCESS_TOKEN_EXPIRES_IN as any,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, JWT_SECRET, {
    algorithms: ["HS256"],
  });

  if (
    typeof decoded !== "object" ||
    decoded === null ||
    decoded["type"] !== "access" ||
    typeof decoded.sub !== "string" ||
    typeof decoded["sid"] !== "string"
  ) {
    throw new Error("Invalid access token payload.");
  }

  return {
    sub: decoded.sub,
    sid: decoded["sid"],
    type: "access",
  };
}
