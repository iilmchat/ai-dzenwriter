import type { AuditRecord } from '../../src/audit/audit.record';
import type {
  PublicationRow,
  PublicationsRepository,
} from '../../src/publications/publications.repository';

// Список публикаций в памяти: тесты задают материалы напрямую.
// Записи аудита отдаём наружу хуком, чтобы проверять их в тесте журнала.
export class InMemoryPublicationsRepository implements PublicationsRepository {
  readonly rows: PublicationRow[] = [];
  readonly audit: AuditRecord[] = [];

  constructor(private readonly sink?: (record: AuditRecord) => void) {}

  add(row: PublicationRow): void {
    this.rows.push(row);
  }

  async listForPublication(): Promise<PublicationRow[]> {
    return [...this.rows];
  }

  async insertAudit(record: AuditRecord): Promise<void> {
    this.audit.push(record);
    this.sink?.(record);
  }
}
