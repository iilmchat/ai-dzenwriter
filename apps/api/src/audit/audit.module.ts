import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { DrizzleAuditRepository } from './drizzle-audit.repository';
import { AUDIT_REPOSITORY } from './audit.repository';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AuditController],
  providers: [
    AuditService,
    {
      provide: AUDIT_REPOSITORY,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => new DrizzleAuditRepository(database.db),
    },
  ],
})
export class AuditModule {}
