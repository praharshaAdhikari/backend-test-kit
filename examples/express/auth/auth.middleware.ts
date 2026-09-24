import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';

/** The signed-in user, as the authentication middleware puts it on the request. */
export interface RequestUser {
  id: number;
  roles: string[];
}

/** A request after authentication. (Your app may already type this; use its type instead.) */
export type AuthedRequest = Request & { user?: RequestUser };

/** Lets the request through only for a signed-in user with one of these roles. */
export function requireRole(...roles: string[]): RequestHandler {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Sign in first' });
      return;
    }
    if (!roles.some(role => req.user?.roles.includes(role))) {
      res.status(403).json({ error: `Needs one of these roles: ${roles.join(', ')}` });
      return;
    }
    next();
  };
}

/**
 * Checks the body against a zod schema. A bad body is answered with 400 and every problem; a good
 * one replaces req.body with the parsed value (unknown fields dropped, types as the schema says).
 */
export function validateBody(schema: ZodType): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation failed',
        issues: result.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }))
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
