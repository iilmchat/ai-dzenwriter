import { z } from 'zod';
import { VERSION_ORIGINS, type VersionOrigin } from './enums';
import { versionClaimSchema, versionCheckSchema } from './checks';
import { versionSummarySchema } from './articles';

export { versionSummarySchema };
export type VersionSummary = z.infer<typeof versionSummarySchema>;

// Полное содержимое версии: его показывает редактор и из него делается откат.
export const versionDetailSchema = z.object({
  number: z.number().int(),
  origin: z.enum(VERSION_ORIGINS),
  title: z.string(),
  articleMarkdown: z.string(),
  seoTitle: z.string(),
  tags: z.array(z.string()),
  description: z.string(),
  imagePrompt: z.string(),
  advertisingLabel: z.boolean(),
  disclaimerText: z.string().nullable(),
  claims: z.array(versionClaimSchema),
  checks: z.array(versionCheckSchema),
  styleVersion: z.number().int(),
  promptVersion: z.string(),
  generationRunId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
});
export type VersionDetail = z.infer<typeof versionDetailSchema>;

export const versionListResponseSchema = z.object({
  items: z.array(versionSummarySchema),
});
export type VersionListResponse = z.infer<typeof versionListResponseSchema>;

// Тело ручного сохранения версии. expectedVersion — оптимистичная блокировка:
// пока автор правил текст, материал могли изменить.
export const saveVersionInputSchema = z.object({
  expectedVersion: z.number().int().min(1),
  title: z.string().trim().min(1, 'Заголовок не может быть пустым').max(300),
  articleMarkdown: z.string(),
  seoTitle: z.string().trim().max(300),
  tags: z.array(z.string().trim().min(1)).max(20),
  description: z.string().trim().max(1000),
  imagePrompt: z.string().trim().max(1000),
  advertisingLabel: z.boolean(),
  disclaimerText: z.string().trim().max(2000).nullable(),
  // Утверждения с их привязкой к фактам: автор может перепривязать утверждение.
  claims: z.array(
    z.object({
      text: z.string().min(1),
      type: z.enum(['fact', 'hypothesis', 'opinion']),
      factIds: z.array(z.string()),
    }),
  ),
});
export type SaveVersionInput = z.infer<typeof saveVersionInputSchema>;

export const saveVersionResponseSchema = z.object({
  version: versionDetailSchema,
  article: z.object({
    id: z.uuid(),
    version: z.number().int(),
    currentVersionNumber: z.number().int().nullable(),
  }),
});
export type SaveVersionResponse = z.infer<typeof saveVersionResponseSchema>;

// Пробный прогон проверок: текст проверяется, но версия не создаётся.
// Редактор так показывает проверки по ходу правки.
export const checkVersionInputSchema = saveVersionInputSchema.omit({ expectedVersion: true });
export type CheckVersionInput = z.infer<typeof checkVersionInputSchema>;

export const checkVersionResponseSchema = z.object({
  checks: z.array(versionCheckSchema),
  claims: z.array(versionClaimSchema),
});
export type CheckVersionResponse = z.infer<typeof checkVersionResponseSchema>;

export const VERSION_ORIGIN_LABELS: Record<VersionOrigin, string> = {
  generated: 'генерация',
  manual: 'ручная правка',
  rollback: 'откат',
};

// Сравнение версий идёт по абзацам: этого достаточно, чтобы увидеть, что изменилось.
export type DiffKind = 'same' | 'added' | 'removed' | 'changed';

export interface DiffPair {
  readonly kind: DiffKind;
  // Абзац старой версии и абзац новой: null, если абзаца нет с этой стороны.
  readonly left: string | null;
  readonly right: string | null;
}

export function diffParagraphs(left: string, right: string): DiffPair[] {
  const leftParts = splitParagraphs(left);
  const rightParts = splitParagraphs(right);
  const pairs: DiffPair[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  // Общие абзацы идут по порядку: сравниваем их как есть, остальные считаем правкой.
  while (leftIndex < leftParts.length || rightIndex < rightParts.length) {
    const leftPart = leftParts[leftIndex];
    const rightPart = rightParts[rightIndex];
    if (leftPart !== undefined && rightPart !== undefined && leftPart === rightPart) {
      pairs.push({ kind: 'same', left: leftPart, right: rightPart });
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    const nextCommon = findCommon(leftParts, rightParts, leftIndex, rightIndex);
    if (nextCommon !== null) {
      pairs.push(
        ...collect(
          leftParts.slice(leftIndex, nextCommon.left),
          rightParts.slice(rightIndex, nextCommon.right),
        ),
      );
      leftIndex = nextCommon.left;
      rightIndex = nextCommon.right;
      continue;
    }
    // Дальше совпадений нет: слева удалённые, справа добавленные.
    const removed = leftParts.slice(leftIndex);
    const added = rightParts.slice(rightIndex);
    pairs.push(...pairChanges(removed, added));
    break;
  }

  return pairs;
}

// Абзацы статьи: пустая строка разделяет, решётка в начале — заголовок, но он тоже абзац.
function splitParagraphs(markdown: string): string[] {
  return markdown
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

// Ближайший общий абзац после указанных позиций.
function findCommon(
  left: readonly string[],
  right: readonly string[],
  fromLeft: number,
  fromRight: number,
): { readonly left: number; readonly right: number } | null {
  for (let leftIndex = fromLeft; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = fromRight; rightIndex < right.length; rightIndex += 1) {
      if (left[leftIndex] === right[rightIndex]) {
        return { left: leftIndex, right: rightIndex };
      }
    }
  }
  return null;
}

// Удалённые и добавленные абзацы: если их поровну, считаем их изменёнными.
function collect(removed: readonly string[], added: readonly string[]): DiffPair[] {
  return pairChanges(removed, added);
}

function pairChanges(removed: readonly string[], added: readonly string[]): DiffPair[] {
  const pairs: DiffPair[] = [];
  const count = Math.min(removed.length, added.length);
  for (let index = 0; index < count; index += 1) {
    pairs.push({ kind: 'changed', left: removed[index] ?? null, right: added[index] ?? null });
  }
  for (const part of removed.slice(count)) {
    pairs.push({ kind: 'removed', left: part, right: null });
  }
  for (const part of added.slice(count)) {
    pairs.push({ kind: 'added', left: null, right: part });
  }
  return pairs;
}
