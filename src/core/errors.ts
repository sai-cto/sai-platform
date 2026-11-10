/** Errors the core throws. Route code turns them into "not found" / "forbidden" pages. */

/** Nobody is logged in. */
export class UnauthenticatedError extends Error {
  constructor(message = 'You need to sign in.') {
    super(message);
    this.name = 'UnauthenticatedError';
  }
}

/** Logged in, but this role may not do this. */
export class ForbiddenError extends Error {
  constructor(
    public readonly action: string,
    message?: string,
  ) {
    super(message ?? `You do not have permission to do this (${action}).`);
    this.name = 'ForbiddenError';
  }
}

/**
 * The thing does not exist, OR it belongs to a business the caller cannot see.
 * The two cases are deliberately indistinguishable so nothing leaks across businesses.
 */
export class NotFoundError extends Error {
  constructor(message = 'Not found.') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** The request was understood but the data is not acceptable. Safe to show to the user. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
