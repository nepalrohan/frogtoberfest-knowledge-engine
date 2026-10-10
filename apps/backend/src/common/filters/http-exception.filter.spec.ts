import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockResponse: Record<string, unknown>;
  let mockRequest: Record<string, unknown>;
  let mockHost: Record<string, unknown>;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    mockResponse = {
      status: mockStatus,
    };
    mockRequest = {
      method: 'POST',
      url: '/api/v1/auth/login',
      originalUrl: '/api/v1/auth/login',
      ip: '127.0.0.1',
      headers: { 'x-branch-id': 'br-123' },
      user: { id: 'usr-1', role: 'USER' },
    };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    };
  });

  it('should catch user-relevant 400 BadRequestException and respond with formatted payload', () => {
    const exception = new BadRequestException('Validation failed: email is required');

    filter.catch(exception, mockHost as any);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed: email is required',
        method: 'POST',
        path: '/api/v1/auth/login',
      }),
    );
  });

  it('should catch 403 ForbiddenException and respond with formatted payload', () => {
    const exception = new ForbiddenException('Branch access denied');

    filter.catch(exception, mockHost as any);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Branch access denied',
      }),
    );
  });

  it('should forward a domain code and structured details from the exception body', () => {
    const exception = new ConflictException({
      message: 'Insufficient stock',
      code: 'ORDER_INSUFFICIENT_STOCK',
      details: { shortages: [{ productId: 'p1', required: 2, availableNow: 0 }] },
    });

    filter.catch(exception, mockHost as any);

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        message: 'Insufficient stock',
        code: 'ORDER_INSUFFICIENT_STOCK',
        details: { shortages: [{ productId: 'p1', required: 2, availableNow: 0 }] },
      }),
    );
  });

  it('should handle unhandled Error as 500 InternalServerError', () => {
    const exception = new Error('Database connection failed');

    filter.catch(exception, mockHost as any);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Database connection failed',
      }),
    );
  });
});
