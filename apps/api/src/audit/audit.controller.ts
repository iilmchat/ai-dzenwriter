import { Controller, Get, Query } from '@nestjs/common';
import { auditQuerySchema, type AuditListResponse, type AuditQuery } from '@dzenwriter/shared';
import { Roles } from '../auth/auth.decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  // Журнал видит только администратор: там действия всех сотрудников.
  @Get()
  @Roles('admin')
  list(
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery,
  ): Promise<AuditListResponse> {
    return this.audit.list(query);
  }
}
