import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@remarkround/db';
import type { Request, Response } from 'express';

/** Тело любой ошибки API (docs/API.md): код для программ, сообщение для людей, requestId — чтобы найти строку в логах. */
export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string | string[];
  requestId?: string;
}

const CODE_BY_STATUS: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  410: 'gone',
  413: 'too_large',
  422: 'unprocessable',
  429: 'too_many_requests',
  500: 'internal',
  503: 'unavailable',
};

/**
 * Единый контракт ошибок (аудит: no-error-contract-filter). До него всё непредусмотренное — безымянный 500 без следа,
 * а ошибки Prisma текли наружу с SQL-подробностями. Здесь: HttpException — как есть плюс code и requestId;
 * известные ошибки Prisma — 409/404 с человеческим текстом; остальное — 500 «внутренняя ошибка» и стек в логах.
 */
@Catch()
export class HttpExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string }>();
    const res = http.getResponse<Response>();
    const requestId = typeof req.id === 'string' ? req.id : undefined;
    const body = this.toBody(exception, requestId);
    if (body.statusCode >= 500) {
      const err = exception as Error;
      this.log.error({ msg: `${req.method} ${req.url} → ${body.statusCode}`, requestId, err: { name: err?.name, message: err?.message, stack: err?.stack } });
    }
    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown, requestId?: string): ErrorBody {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message = typeof payload === 'string' ? payload : ((payload as { message?: string | string[] }).message ?? exception.message);
      // 503 из /health несёт своё тело ({ ok, db, … }) — сохраняем его поля
      const extra = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
      return { ...extra, statusCode: status, code: CODE_BY_STATUS[status] ?? `http_${status}`, message, requestId };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') return { statusCode: 409, code: 'conflict', message: 'Такая запись уже есть', requestId };
      if (exception.code === 'P2025') return { statusCode: 404, code: 'not_found', message: 'Не найдено', requestId };
      if (exception.code === 'P2003') return { statusCode: 409, code: 'conflict', message: 'Запись связана с другими данными', requestId };
    }
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return { statusCode: HttpStatus.UNPROCESSABLE_ENTITY, code: 'unprocessable', message: 'Неверные данные запроса', requestId };
    }
    return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, code: 'internal', message: 'Внутренняя ошибка — сообщите requestId в поддержку', requestId };
  }
}
