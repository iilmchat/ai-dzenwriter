import type { ArticleFormat, ArticleStatus, FactPolicy, FactType, Tone, UserRole } from './enums';

// Подписи для интерфейса и сообщений API. Значения перечислений в коде остаются латиницей.
export const ARTICLE_STATUS_LABELS: Record<ArticleStatus, string> = {
  idea: 'Идея',
  researching: 'Факты',
  drafting: 'Черновик',
  in_review: 'Ревью',
  approved: 'Утверждено',
  scheduled: 'Запланировано',
  published: 'Опубликовано',
  archived: 'В архиве',
};

export const ARTICLE_FORMAT_LABELS: Record<ArticleFormat, string> = {
  news: 'Новость',
  article: 'Статья',
  longread: 'Лонгрид',
  roundup: 'Подборка',
  case: 'Кейс',
};

export const FACT_TYPE_LABELS: Record<FactType, string> = {
  news_source: 'источник новости',
  company_fact: 'факт о компании',
  product_fact: 'факт о продукте',
  experience_note: 'заметка опыта',
};

export const FACT_POLICY_LABELS: Record<FactPolicy, string> = {
  sourced: 'Каждое число и имя со ссылкой на источник',
  approved_only: 'Только одобренные факты',
  experience_only: 'Только заметки опыта с согласием',
};

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  author: 'Автор',
  reviewer: 'Ревьюер',
  admin: 'Администратор',
};

export const TONE_LABELS: Record<Tone, string> = {
  neutral: 'Нейтральный',
  'expert-conversational': 'Экспертный, в разговоре',
  engaging: 'Вовлекающий',
};
