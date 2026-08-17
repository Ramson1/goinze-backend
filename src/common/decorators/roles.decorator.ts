import { SetMetadata } from '@nestjs/common';
import type { Role } from '../../../../lib/types';

export const ROLES_KEY = 'roles';

/**
 * Mark a route (or controller) as requiring one or more roles.
 * Used together with RolesGuard.
 *
 * @example @Roles('SCHOOL_ADMIN', 'ACCOUNTANT')
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
