import { z } from 'zod';

export const SEARCH_RESULT_TYPES = ['article', 'fact', 'product'] as const;
export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number];

export const searchResultItemSchema = z.object({
  type: z.enum(SEARCH_RESULT_TYPES),
  id: z.uuid(),
  title: z.string(),
  subtitle: z.string(),
  url: z.string(),
});
export type SearchResultItem = z.infer<typeof searchResultItemSchema>;

export const searchResponseSchema = z.object({
  items: z.array(searchResultItemSchema),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
