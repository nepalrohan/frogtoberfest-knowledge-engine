import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppConfigService } from '../../config/configuration';

/* Guard verifying application administrator authorization via header key or Bearer token */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly configService: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<
      Request & { user?: { id: string; role: string } }
    >();

    const adminApiKey = this.configService.adminApiKey;
    if (!adminApiKey) {
      throw new UnauthorizedException('Admin API key is not configured');
    }

    /* Check x-admin-key header */
    const headerKey = request.headers['x-admin-key'];
    if (headerKey && typeof headerKey === 'string' && headerKey === adminApiKey) {
      request.user = { id: 'admin-user', role: 'ADMIN' };
      return true;
    }

    /* Check Authorization header: Bearer <key> or ApiKey <key> */
    const authHeader = request.headers['authorization'];
    if (authHeader && typeof authHeader === 'string') {
      const [scheme, token] = authHeader.split(' ');
      if (
        (scheme?.toLowerCase() === 'bearer' || scheme?.toLowerCase() === 'apikey') &&
        token === adminApiKey
      ) {
        request.user = { id: 'admin-user', role: 'ADMIN' };
        return true;
      }
    }

    throw new UnauthorizedException(
      'Administrator authorization required: invalid or missing admin credentials',
    );
  }
}
