import {
  type ArticleFormat,
  type ChecklistItem,
  type Claim,
  type ExportFile,
  type FactType,
  type Tone,
  type VersionCheck,
} from '@dzenwriter/shared';

export interface ExportFact {
  readonly label: string;
  readonly type: FactType;
  readonly sourceName: string | null;
  readonly sourceUrl: string | null;
  readonly sourcePublishedAt: string | null;
}

export interface ExportVersion {
  readonly number: number;
  readonly title: string;
  readonly articleMarkdown: string;
  readonly seoTitle: string;
  readonly tags: readonly string[];
  readonly description: string;
  readonly imagePrompt: string;
  readonly advertisingLabel: boolean;
  readonly disclaimerText: string | null;
  readonly styleVersion: number;
  readonly promptVersion: string;
  readonly checks: readonly VersionCheck[];
  readonly claims: readonly Claim[];
}

export interface ExportArticle {
  readonly id: string;
  readonly topic: string;
  readonly keywords: readonly string[];
  readonly styleId: string;
  readonly styleName: string;
  readonly format: ArticleFormat;
  readonly tone: Tone;
  readonly productName: string | null;
  readonly author: string;
  readonly version: ExportVersion;
  readonly facts: readonly ExportFact[];
}

// Публичный текст собирает код, а не модель: тот же формат, что в спецификации Dzen Writer.
export function buildPublicText(article: ExportArticle): string {
  const version = article.version;
  return [
    `# ${version.title}`,
    '',
    version.articleMarkdown.trim(),
    '',
    '---',
    `SEO_TITLE: ${version.seoTitle}`,
    `TAGS: ${version.tags.join(', ')}`,
    `DESCRIPTION: ${version.description}`,
    `IMAGE_PROMPT: ${version.imagePrompt}`,
    '',
  ].join('\n');
}

// Метаданные в JSON: всё, что редактор Дзена просит заполнить отдельно от текста.
// Тексты фактов сюда не попадают: в заметках опыта могут быть персональные данные.
export function buildMetadata(article: ExportArticle): Record<string, unknown> {
  const version = article.version;
  return {
    topic: article.topic,
    keywords: [...article.keywords],
    style: { id: article.styleId, name: article.styleName },
    format: article.format,
    tone: article.tone,
    product: article.productName,
    author: article.author,
    version: {
      number: version.number,
      style_version: version.styleVersion,
      prompt_version: version.promptVersion,
    },
    title: version.title,
    seo_title: version.seoTitle,
    tags: [...version.tags],
    description: version.description,
    image_prompt: version.imagePrompt,
    advertising_label: version.advertisingLabel,
    disclaimer: version.disclaimerText,
    facts: article.facts.map((fact) => ({
      label: fact.label,
      type: fact.type,
      source_name: fact.sourceName,
      source_url: fact.sourceUrl,
      source_published_at: fact.sourcePublishedAt,
    })),
    claims: version.claims.map((claim) => ({
      text: claim.text,
      type: claim.type,
      fact_ids: [...claim.factIds],
    })),
  };
}

// Чек-лист публикации из 06-legal-and-safety, раздел 7. Часть пунктов система
// проверяет сама: остаётся только human-in-the-loop там, где нужна голова редактора.
export function buildChecklist(article: ExportArticle): ChecklistItem[] {
  const version = article.version;
  const blocking = version.checks.filter(
    (check) => check.severity === 'block' && check.decision !== 'confirmed',
  );
  const has = (id: string): boolean => blocking.some((check) => check.id === id);

  const promises = blocking
    .filter((check) => check.id === 'superlatives_need_fact' || check.id === 'guarantees_forbidden')
    .map((check) => check.message);

  const aboutProduct = article.productName !== null;
  const missingSources = article.facts.filter(
    (fact) =>
      fact.type === 'news_source' && (fact.sourceUrl === null || fact.sourcePublishedAt === null),
  );

  return [
    {
      id: 'title_matches_content',
      title: 'Заголовок соответствует содержанию, без ложных обещаний',
      done: promises.length === 0,
      comment:
        promises.length === 0
          ? null
          : `В заголовке или тексте есть обещания без факта: ${promises.join('; ')}`,
    },
    {
      id: 'text_standalone',
      title: 'Текст самодостаточен: внешние ссылки не нужны для понимания',
      done: null,
      comment: 'Проверяет автор',
    },
    {
      id: 'ad_disclosure',
      title: 'Маркировка рекламы и партнёрских материалов поставлена, если нужна',
      done: !aboutProduct || version.advertisingLabel,
      comment:
        !aboutProduct || version.advertisingLabel
          ? null
          : `Материал о продукте «${article.productName}», а маркировки нет`,
    },
    {
      id: 'sources_and_dates',
      title: 'Источники и даты указаны',
      done: missingSources.length === 0,
      comment:
        missingSources.length === 0
          ? null
          : `Без источника или даты: ${missingSources.map((fact) => fact.label).join(', ')}`,
    },
    {
      id: 'disclaimer',
      title: 'Дисклеймер есть, если тема чувствительная',
      done: !has('disclaimer_required'),
      comment: has('disclaimer_required') ? 'Тема чувствительная, а оговорки в тексте нет' : null,
    },
    {
      id: 'cover_rights',
      title: 'Обложка не нарушает права на изображения',
      done: null,
      comment: 'Проверяет автор',
    },
  ];
}

export function buildChecklistText(items: readonly ChecklistItem[]): string {
  const lines = ['# Чек-лист перед публикацией', ''];
  for (const item of items) {
    const mark = item.done === null ? '[ ]' : item.done ? '[x]' : '[ ]';
    lines.push(`${mark} ${item.title}`);
    if (item.comment !== null) {
      lines.push(`    ${item.comment}`);
    }
  }
  lines.push('');
  lines.push('Правила Дзена меняются: сверяйте чек-лист с актуальной справкой платформы.');
  lines.push('');
  return lines.join('\n');
}

// Состав пакета фиксирован: формат закрыт тестом.
export function buildExportFiles(article: ExportArticle): ExportFile[] {
  const metadata = buildMetadata(article);
  return [
    { name: 'article.md', content: buildPublicText(article) },
    { name: 'metadata.json', content: `${JSON.stringify(metadata, null, 2)}\n` },
    { name: 'image_prompt.txt', content: `${article.version.imagePrompt}\n` },
    { name: 'checklist.md', content: buildChecklistText(buildChecklist(article)) },
  ];
}

// Понятное имя файла пакета: из темы, без пробелов.
export function exportFileName(article: ExportArticle): string {
  const slug = article.topic
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60);
  return `${slug || 'material'}-v${article.version.number}.zip`;
}

// Имя файла для заголовка: HTTP-заголовки не принимают кириллицу,
// поэтому понятное имя уходит в filename*, а запасное — из идентификатора.
export function exportAsciiFileName(article: ExportArticle): string {
  return `dzenwriter-${article.id.slice(0, 8)}-v${article.version.number}.zip`;
}
