export class AppError<const T extends string> extends Error {
  readonly type: T;
  readonly statusCode: number;

  constructor(type: T, message: string, statusCode: number) {
    super(message);
    this.name = "AppError";
    this.type = type;
    this.statusCode = statusCode;
  }
}
