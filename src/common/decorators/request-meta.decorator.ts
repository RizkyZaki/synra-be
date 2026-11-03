import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

/** IP dan user-agent untuk dicatat di audit log. */
export const ReqMeta = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return {
    ipAddress: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
  };
});
