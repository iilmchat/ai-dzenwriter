import type { VersionCheck } from '@dzenwriter/shared';
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

export interface ArticlePreviewProps {
  readonly title: string;
  readonly markdown: string;
  // Проверки текущего текста: их фрагменты подчёркиваются в предпросмотре.
  readonly checks: readonly VersionCheck[];
  // На странице ревью текст показываем целиком, а не в прокручиваемом окне редактора.
  readonly full?: boolean;
}

interface HastNode {
  readonly type: string;
  readonly value?: string;
  children?: HastNode[];
  readonly properties?: Record<string, unknown>;
  readonly tagName?: string;
}

interface Flag {
  readonly text: string;
  readonly severity: string;
}

// Подчёркивание непроверенных фрагментов: блокирующие — волной, остальные — точкой.
const FLAG_CLASS: Record<string, string> = {
  block: 'dz-flag dz-flag--block',
  warn: 'dz-flag dz-flag--warn',
  info: 'dz-flag dz-flag--info',
};

// Предпросмотр в духе Дзена: текст 17/28 px, колонка 680 px.
export function ArticlePreview({ title, markdown, checks, full = false }: ArticlePreviewProps) {
  const flags = useMemo(
    () =>
      checks
        .filter((check) => check.excerpt !== undefined && check.excerpt.length > 0)
        .map((check) => ({ text: check.excerpt as string, severity: check.severity })),
    [checks],
  );

  return (
    <div className={`dz-preview${full ? ' dz-preview--full' : ''}`}>
      <div className="dz-preview__body">
        <p className="dz-preview__title">{title}</p>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          // Сначала очистка, потом подчёркивание: санитайзер не трогает наши отметки.
          rehypePlugins={[rehypeSanitize, () => rehypeFlags(flags)]}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    </div>
  );
}

// Плагин rehype: оборачивает фрагменты проверок в отмеченные элементы.
function rehypeFlags(flags: readonly Flag[]) {
  return (tree: HastNode): void => {
    if (flags.length === 0) {
      return;
    }
    wrapText(tree, flags);
  };
}

function wrapText(node: HastNode, flags: readonly Flag[]): void {
  const children = node.children;
  if (!children) {
    return;
  }
  const next: HastNode[] = [];
  for (const child of children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      next.push(...splitByFlags(child.value, flags));
      continue;
    }
    wrapText(child, flags);
    next.push(child);
  }
  node.children = next;
}

function splitByFlags(text: string, flags: readonly Flag[]): HastNode[] {
  let best: { readonly index: number; readonly flag: Flag } | null = null;
  for (const flag of flags) {
    const index = text.indexOf(flag.text);
    if (index < 0) {
      continue;
    }
    if (best === null || index < best.index) {
      best = { index, flag };
    }
  }
  if (best === null) {
    return [{ type: 'text', value: text }];
  }

  const before = text.slice(0, best.index);
  const hit = best.flag.text;
  const after = text.slice(best.index + hit.length);
  const nodes: HastNode[] = [];
  if (before.length > 0) {
    nodes.push({ type: 'text', value: before });
  }
  nodes.push({
    type: 'element',
    tagName: 'span',
    properties: { className: FLAG_CLASS[best.flag.severity] ?? FLAG_CLASS.info },
    children: [{ type: 'text', value: hit }],
  });
  if (after.length > 0) {
    nodes.push(...splitByFlags(after, flags));
  }
  return nodes;
}
