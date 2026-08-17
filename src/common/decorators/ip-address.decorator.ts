import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Param decorator that extracts the client IP address from the request.
 * Checks X-Forwarded-For header first (for proxied requests), then falls
 * back to req.ip or req.socket.remoteAddress.
 *
 * @example doSomething(@IpAddress() ip: string) { ... }
 */
export const IpAddress = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const forwarded = request.headers?.['x-forwarded-for'];
    if (forwarded) {
      // X-Forwarded-For can contain multiple IPs: client, proxy1, proxy2
      const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
      return first?.trim() ?? '';
    }
    return request.ip ?? request.socket?.remoteAddress ?? '';
  },
);
