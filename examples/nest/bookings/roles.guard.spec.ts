import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles } from './roles.decorator.js';
import { type RequestUser, RolesGuard } from './roles.guard.js';

// A unit test of a guard: canActivate() called directly, with the smallest ExecutionContext that
// works. The decorators are real, on a small controller class, so the guard reads real metadata.
// (bookings-api/bookings.controller.spec.ts checks the same guard over HTTP.)

@Roles('admin')
class ReportsController {
  summary(): void {}

  @Roles('admin', 'front-desk')
  today(): void {}
}

class PublicController {
  health(): void {}
}

/** The smallest ExecutionContext the guard needs, for one route (a method of the controller). */
function contextFor(controller: new () => object, method: string, user?: RequestUser): ExecutionContext {
  const handler = Reflect.get(controller.prototype, method) as () => void;
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user }) })
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());
  const frontDesk: RequestUser = { id: 2, roles: ['front-desk'] };
  const admin: RequestUser = { id: 1, roles: ['admin'] };

  it('lets anyone through a route without @Roles', () => {
    expect(guard.canActivate(contextFor(PublicController, 'health'))).toBe(true);
  });

  it('asks for sign-in when a role is needed and nobody is signed in', () => {
    expect(() => guard.canActivate(contextFor(ReportsController, 'summary'))).toThrow(
      UnauthorizedException
    );
  });

  it('applies the class-level @Roles to every route in it', () => {
    const route = 'summary';

    expect(guard.canActivate(contextFor(ReportsController, route, admin))).toBe(true);
    expect(() => guard.canActivate(contextFor(ReportsController, route, frontDesk))).toThrow(ForbiddenException);
  });

  it('lets a route-level @Roles replace the class-level one', () => {
    const route = 'today';

    expect(guard.canActivate(contextFor(ReportsController, route, frontDesk))).toBe(true);
  });

  it('refuses a user with none of the roles, naming the roles needed', () => {
    const route = 'today';

    expect(() => guard.canActivate(contextFor(ReportsController, route, { id: 3, roles: ['member'] }))).toThrow(
      'Needs one of these roles: admin, front-desk'
    );
  });
});
