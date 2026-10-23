import type { ArticleItem, UserRole } from '@dzenwriter/shared';

export interface NextStep {
  readonly group: string;
  readonly action: string;
  readonly order: number;
}

// Следующее действие для автора или ревьюера. Одна функция для доски и «Моих задач»,
// чтобы подсказки не расходились.
export function nextStepFor(
  article: ArticleItem,
  user: { readonly id: string; readonly role: UserRole },
): NextStep | null {
  if (article.owner.id === user.id) {
    switch (article.status) {
      case 'idea':
        return {
          group: 'Подготовить',
          action: 'Собрать факты и перейти к черновику',
          order: 3,
        };
      case 'researching':
        return {
          group: 'Подготовить',
          action: 'Привязать факты и перейти к черновику',
          order: 3,
        };
      case 'drafting':
        return {
          group: 'Доработать',
          action: 'Дописать текст и отправить на ревью',
          order: 2,
        };
      case 'in_review':
        return {
          group: 'Ждёт ревью',
          action: 'Решение принимает ревьюер',
          order: 5,
        };
      case 'approved':
      case 'scheduled':
        return {
          group: 'Опубликовать',
          action: 'Скачать пакет и отметить публикацию',
          order: 4,
        };
      case 'published':
      case 'archived':
        return null;
    }
  }

  // Ревьюер и администратор видят общую очередь: назначение происходит только после решения.
  if (article.status === 'in_review' && (user.role === 'reviewer' || user.role === 'admin')) {
    return {
      group: 'На ревью',
      action: 'Прочитать текст и принять решение',
      order: 1,
    };
  }

  return null;
}
