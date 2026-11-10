import type {
  ArticleFormat,
  ArticleStatus,
  FactPolicy,
  FactStatus,
  FactType,
  Tone,
  UserRole,
} from './enums';
import type { AuditAction, AuditEntity } from './audit';
import type { ReviewRubric } from './articles';

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

export const FACT_STATUS_LABELS: Record<FactStatus, string> = {
  draft: 'Черновик',
  approved: 'Одобрен',
  rejected: 'Отклонён',
  superseded: 'Заменён',
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

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  'auth.login': 'Вход',
  'auth.logout': 'Выход',
  'auth.denied': 'Отказ во входе',
  'auth.login_conflict': 'Конфликт логина GitHub',
  'user.role_change': 'Смена роли',
  'user.disable': 'Отключение пользователя',
  'user.enable': 'Включение пользователя',
  'user.membership_lost': 'Выведен из организации',
  'product.create': 'Создание продукта',
  'product.update': 'Правка продукта',
  'fact.create': 'Создание факта',
  'fact.update': 'Правка факта',
  'fact.supersede': 'Замена факта',
  'fact.approve': 'Одобрение факта',
  'fact.reject': 'Отклонение факта',
  'fact.correct': 'Предложение правки факта',
  'consent.confirm': 'Подтверждение согласия',
  'consent.withdraw': 'Отзыв согласия',
  'article.create': 'Создание материала',
  'article.update': 'Правка материала',
  'article.transition': 'Переход по статусу',
  'article.fact_attach': 'Привязка факта',
  'article.fact_detach': 'Отвязка факта',
  'article.generation_confirm': 'Подтверждение генерации',
  'article.brief_generate': 'Сгенерирован бриф статьи',
  'article.package_download': 'Скачивание пакета для Дзена',
  'version.create': 'Новая версия текста',
  'version.rollback': 'Откат текста',
  'check.confirm': 'Подтверждение проверки',
  'review.comment_create': 'Комментарий к фрагменту',
  'review.comment_resolve': 'Комментарий решён',
  'generation.start': 'Запуск генерации',
  'generation.succeeded': 'Генерация завершена',
  'generation.cancelled': 'Генерация отменена',
  'generation.failed': 'Сбой генерации',
  'generation.needs_input': 'Генерация ждёт ответа',
  'generation.fragment': 'Перегенерация фрагмента',
  'generation.title_options': 'Варианты заголовка',
  'metric.create': 'Ручной ввод метрик',
  'metric.import': 'Импорт метрик',
};

export const AUDIT_ENTITY_LABELS: Record<AuditEntity, string> = {
  user: 'Пользователь',
  session: 'Сессия',
  product: 'Продукт',
  fact: 'Факт',
  article: 'Материал',
  metric_import: 'Импорт метрик',
};

// Рубрика редактора из раздела 7.4 дизайна: пять критериев ручной оценки.
export const REVIEW_RUBRIC_LABELS: Record<keyof ReviewRubric, string> = {
  accuracy: 'Точность',
  style: 'Стиль',
  readability: 'Читаемость',
  hooks: 'Крючки',
  cliches: 'Штампы',
};
