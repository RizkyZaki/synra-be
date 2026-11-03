import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { MSG } from '../constants/messages';

interface ErrorBody {
  statusCode: number;
  message: string;
  errors?: string[];
  path: string;
  timestamp: string;
}

/** Menyeragamkan format error dan memastikan pesan ke pengguna berbahasa Indonesia. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string = MSG.INTERNAL_ERROR;
    let errors: string[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const b = body as { message?: string | string[]; errors?: string[] };
        message = Array.isArray(b.message) ? MSG.VALIDATION_FAILED : (b.message ?? message);
        errors = b.errors ?? (Array.isArray(b.message) ? b.message : undefined);
      }
      message = this.translateBuiltin(status, message);
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      ({ status, message } = this.fromPrisma(exception));
    }

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const payload: ErrorBody = {
      statusCode: status,
      message,
      ...(errors ? { errors } : {}),
      path: req.url,
      timestamp: new Date().toISOString(),
    };
    res.status(status).json(payload);
  }

  /** Mengganti pesan bawaan NestJS/Express yang berbahasa Inggris. */
  private translateBuiltin(status: number, message: string): string {
    if (status === HttpStatus.NOT_FOUND && /^Cannot (GET|POST|PUT|PATCH|DELETE)/.test(message)) {
      return MSG.NOT_FOUND_ROUTE;
    }
    if (status === HttpStatus.UNAUTHORIZED && message === 'Unauthorized') return MSG.AUTH_REQUIRED;
    if (status === HttpStatus.FORBIDDEN && message.startsWith('Forbidden')) return MSG.FORBIDDEN;
    if (status === HttpStatus.TOO_MANY_REQUESTS) return MSG.TOO_MANY_REQUESTS;
    if (status === HttpStatus.PAYLOAD_TOO_LARGE) return 'Ukuran data terlalu besar.';
    if (status === HttpStatus.BAD_REQUEST && /JSON|Unexpected token/i.test(message)) {
      return 'Format JSON tidak valid.';
    }
    return message;
  }

  private fromPrisma(e: Prisma.PrismaClientKnownRequestError) {
    switch (e.code) {
      case 'P2002':
        return { status: HttpStatus.CONFLICT, message: MSG.DUPLICATE };
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, message: MSG.RECORD_NOT_FOUND };
      case 'P2003':
        return { status: HttpStatus.CONFLICT, message: MSG.RELATION_CONFLICT };
      default:
        return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: MSG.INTERNAL_ERROR };
    }
  }
}
