import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { SessionUser } from '../../lib/types';

/**
 * Param decorator that extracts the authenticated user (request.user)
 * attached by the JWT strategy.
 *
 * @example getMe(@CurrentUser() user: SessionUser) { ... }
 * @example getMe(@CurrentUser('id') userId: string) { ... }
 */
export const CurrentUser = createParamDecorator(
  (data: keyof SessionUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as SessionUser | undefined;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
