import { z } from 'zod';

// Комментарий ревьюера к фрагменту конкретной версии. Офсеты — по Markdown-тексту.
export const createReviewCommentSchema = z
  .object({
    versionNumber: z.number().int().min(1, 'Некорректная версия'),
    comment: z
      .string()
      .trim()
      .min(1, 'Комментарий не может быть пустым')
      .max(5000, 'Комментарий длиннее 5000 знаков'),
    selectedText: z
      .string()
      .trim()
      .min(1, 'Выделите фрагмент текста')
      .max(10_000, 'Фрагмент длиннее 10 000 знаков'),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().nonnegative(),
  })
  .refine((input) => input.endOffset >= input.startOffset, {
    error: 'Конец фрагмента раньше начала',
  });
export type CreateReviewCommentInput = z.infer<typeof createReviewCommentSchema>;

export const reviewCommentSchema = z.object({
  id: z.uuid(),
  reviewerName: z.string(),
  comment: z.string(),
  selectedText: z.string(),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  isResolved: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type ReviewComment = z.infer<typeof reviewCommentSchema>;

export const reviewCommentsResponseSchema = z.object({
  items: z.array(reviewCommentSchema),
});
export type ReviewCommentsResponse = z.infer<typeof reviewCommentsResponseSchema>;
