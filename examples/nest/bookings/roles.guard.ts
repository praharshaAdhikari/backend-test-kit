import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator.js';

/** The signed-in user, as the authentication guard (JWT) puts it on the request. */
export interface RequestUser {
  id: number;
  roles: string[];
}

/**
 * Lets a request through when the route has no @Roles(), or the user has one of its roles.
 * Authentication (who the user is) happens before this, in its own guard with its own tests.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<{ user?: RequestUser }>().user;
    if (!user) {
      throw new UnauthorizedException('Sign in first');
    }
    if (!required.some(role => user.roles.includes(role))) {
      throw new ForbiddenException(`Needs one of these roles: ${required.join(', ')}`);
    }
    return true;
  }
}
