import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AdminAuthGuard } from './admin-auth.guard';
import { AppConfigService } from '../../config/configuration';

describe('AdminAuthGuard', () => {
  let guard: AdminAuthGuard;
  let mockConfigService: Partial<AppConfigService>;

  const createMockContext = (headers: Record<string, string | undefined>): ExecutionContext => {
    const mockRequest: any = { headers };
    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    mockConfigService = {
      adminApiKey: 'secret-test-admin-key-12345',
    };
    guard = new AdminAuthGuard(mockConfigService as AppConfigService);
  });

  it('should allow access and set request.user when valid x-admin-key header is provided', () => {
    const context = createMockContext({
      'x-admin-key': 'secret-test-admin-key-12345',
    });

    const result = guard.canActivate(context);
    expect(result).toBe(true);

    const req = context.switchToHttp().getRequest();
    expect(req.user).toEqual({ id: 'admin-user', role: 'ADMIN' });
  });

  it('should allow access and set request.user when valid Bearer token is provided', () => {
    const context = createMockContext({
      authorization: 'Bearer secret-test-admin-key-12345',
    });

    const result = guard.canActivate(context);
    expect(result).toBe(true);

    const req = context.switchToHttp().getRequest();
    expect(req.user).toEqual({ id: 'admin-user', role: 'ADMIN' });
  });

  it('should allow access with ApiKey scheme authorization header', () => {
    const context = createMockContext({
      authorization: 'ApiKey secret-test-admin-key-12345',
    });

    const result = guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('should throw UnauthorizedException when headers are missing', () => {
    const context = createMockContext({});

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when x-admin-key is incorrect', () => {
    const context = createMockContext({
      'x-admin-key': 'wrong-key',
    });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when Bearer token is incorrect', () => {
    const context = createMockContext({
      authorization: 'Bearer wrong-key',
    });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when adminApiKey is not configured', () => {
    const unconfiguredGuard = new AdminAuthGuard({
      adminApiKey: '',
    } as AppConfigService);
    const context = createMockContext({
      'x-admin-key': 'secret-test-admin-key-12345',
    });

    expect(() => unconfiguredGuard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
