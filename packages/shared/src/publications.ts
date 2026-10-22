import { z } from 'zod';
import { ARTICLE_STATUSES, PUBLICATION_STATUSES } from './enums';

// Материал в публикации: что скачать, что опубликовано и когда запланировано.
export const publicationItemSchema = z.object({
  articleId: z.uuid(),
  topic: z.string(),
  styleName: z.string(),
  status: z.enum(ARTICLE_STATUSES),
  version: z.number().int(),
  currentVersionNumber: z.number().int().nullable(),
  plannedAt: z.iso.datetime().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  externalUrl: z.string().nullable(),
  // Пакет можно скачать только для утверждённого материала.
  canExport: z.boolean(),
});
export type PublicationItem = z.infer<typeof publicationItemSchema>;

export const publicationListResponseSchema = z.object({
  items: z.array(publicationItemSchema),
});
export type PublicationListResponse = z.infer<typeof publicationListResponseSchema>;

// Пункт чек-листа публикации: часть пунктов система проверяет сама.
export const checklistItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  // null — пункт проверяет человек, true — выполнен, false — не выполнен.
  done: z.boolean().nullable(),
  comment: z.string().nullable(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

// Имя файла в пакете и его содержимое. Формат закрыт тестом.
export const exportFileSchema = z.object({
  name: z.string(),
  content: z.string(),
});
export type ExportFile = z.infer<typeof exportFileSchema>;

export const PUBLICATION_CHECKLIST_IDS = [
  'title_matches_content',
  'text_standalone',
  'ad_disclosure',
  'sources_and_dates',
  'disclaimer',
  'cover_rights',
] as const;
export type PublicationChecklistId = (typeof PUBLICATION_CHECKLIST_IDS)[number];

export const PUBLICATION_STATUSES_LIST = PUBLICATION_STATUSES;
