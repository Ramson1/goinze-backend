import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '../../lib/types';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Role-based access control guard. Reads the @Roles() metadata and allows
 * the request when the authenticated user's role is included. Routes without
 * @Roles() are allowed through (authentication is still enforced by JwtAuthGuard).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as { role?: Role } | undefined;
    if (!user || !user.role) {
      return false;
    }

    // SUPER_ADMIN has unrestricted access to all routes
    if (user.role === 'SUPER_ADMIN') {
      return true;
    }

    return requiredRoles.includes(user.role);
  }
}
