import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload, SessionUser } from '../../../lib/types';

/**
 * Passport JWT strategy. Validates the access token and attaches a
 * SessionUser-shaped object to request.user.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'change-me-access-secret'),
    });
  }

  async validate(payload: JwtPayload): Promise<SessionUser> {
    return {
      id: payload.sub,
      email: payload.email,
      firstName: '',
      lastName: '',
      role: payload.role,
      schoolId: payload.schoolId ?? null,
    };
  }
}
