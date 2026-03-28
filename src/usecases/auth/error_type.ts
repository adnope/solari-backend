export type AuthErrorType =
  | "MISSING_USERNAME"
  | "INVALID_USERNAME"
  | "MISSING_EMAIL"
  | "INVALID_EMAIL"
  | "MISSING_IDENTIFIER"
  | "MISSING_PASSWORD"
  | "WEAK_PASSWORD"
  | "USERNAME_TAKEN"
  | "EMAIL_TAKEN"
  | "IDENTIFIER_ALREADY_IN_USE"
  | "INVALID_CREDENTIALS"
  | "MISSING_SESSION_ID"
  | "SESSION_NOT_FOUND"
  | "MISSING_USER_ID"
  | "USER_NOT_FOUND"
  | "LINKED_THIRD_PARTY_ACCOUNT"
  | "INTERNAL_ERROR";

export class AuthError extends Error {
  readonly type: AuthErrorType;
  readonly statusCode: number;

  constructor(type: AuthErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "AuthError";
    this.type = type;
    this.statusCode = statusCode;
  }
}
