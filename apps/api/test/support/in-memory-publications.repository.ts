import type {
  PublicationRow,
  PublicationsRepository,
} from '../../src/publications/publications.repository';

// Список публикаций в памяти: тесты задают материалы напрямую.
export class InMemoryPublicationsRepository implements PublicationsRepository {
  readonly rows: PublicationRow[] = [];

  add(row: PublicationRow): void {
    this.rows.push(row);
  }

  async listForPublication(): Promise<PublicationRow[]> {
    return [...this.rows];
  }
}
