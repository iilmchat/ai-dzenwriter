# DzenWriter

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="design/brand/logo-icon-white.svg">
    <img src="design/brand/logo-icon.svg" width="72" height="72" alt="IIRuChating">
  </picture>
</p>

Внутренний инструмент IIRuChating для планирования, генерации, проверки и отслеживания статей для Яндекс Дзен.

**Статус:** дизайн v0.1 на согласовании. Кода приложения пока нет. Подробнее — [docs/04-implementation-status.md](docs/04-implementation-status.md).

## Что будет уметь

- Редакционный план: доска от идеи до публикации.
- Факт-база: цитаты источников с датами, подтверждённые факты о компании и продуктах, согласия на личный опыт.
- Четыре стиля, настраиваемых в git: новости индустрии, наш опыт, описание продуктов, личный опыт.
- Генерация по стилю и формату с проверками: числа, имена и утверждения сверяются с фактами.
- Редактор с предпросмотром в духе Дзена, версии и сравнение.
- Ревью, при котором автор не утверждает свой материал. Пакет для Дзена и отметка публикации.
- Отслеживание публикаций и метрик (v2).

## Принципы

1. Нет факта — нет утверждения. Проверки блокируют, а не советуют.
2. Человек утверждает. Генерация даёт черновик, публикацию делает человек после ревью.
3. Стили и правила — конфигурация в репозитории; изменения проходят через PR.
4. Каждая версия хранит вход, версию стиля, промпт, модель и результаты проверок.
5. Публикация в Дзен — вручную (ADR-0002). Автоматизацию редактора не делаем.
6. Интерфейс — в брендовом стиле IIRuChating (ai-brand), доступность по WCAG 2.2 AA.

## Стек (план)

- Монорепозиторий: pnpm workspaces и Turborepo.
- Web: React 19, TypeScript, Vite, Tailwind CSS на токенах Material 3.
- API: NestJS, Drizzle ORM, PostgreSQL 16.
- Генерация: OpenAI-совместимый API со структурированным JSON-ответом.
- Качество: Vitest, Playwright, ESLint, Prettier, GitHub Actions.

Обоснование — в [docs/00-design.md](docs/00-design.md) и в [ADR](docs/adr/).

## Структура

```text
config/
  formats.yaml         форматы: каркас, объём, число блоков
  styles/              четыре стиля: голос, политика фактов, проверки, инструкции
prompts/
  dzen_writer.md       базовый системный промпт Dzen Writer
design/
  brand/               ассеты ai-brand, закреплённый коммит (см. design/brand/README.md)
docs/                  дизайн, данные, backlog, статус, UI, право, ADR
prototype/             кликабельный HTML-прототип интерфейса
```

Код приложения (`apps/`, `packages/`) появится на этапе E1 из [backlog](docs/03-mvp-backlog.md).

## Документация

- [Дизайн: видение, архитектура, решения](docs/00-design.md)
- [Стили написания и политика фактов](docs/01-writing-styles.md)
- [Модель данных](docs/02-data-model.md)
- [MVP backlog](docs/03-mvp-backlog.md)
- [Статус реализации](docs/04-implementation-status.md)
- [UI и брендинг](docs/05-ui-brand.md)
- [Право, персональные данные и безопасность](docs/06-legal-and-safety.md)
- [ADR-0001. Стек и монорепозиторий](docs/adr/0001-stack-and-monorepo.md)
- [ADR-0002. Публикация в Дзен вручную](docs/adr/0002-dzen-publishing-manual.md)
- [ADR-0003. Стили как конфигурация](docs/adr/0003-styles-as-config.md)
- [ADR-0004. Структурированный вывод и гейты фактов](docs/adr/0004-structured-output-and-fact-gates.md)
- [ADR-0005. Доступ через GitHub OAuth](docs/adr/0005-github-oauth-org-access.md)

## Прототип

[`prototype/index.html`](prototype/index.html) — демо интерфейса: план, редактор с проверками, факт-база, стили, публикации. Открывается в браузере без сборки. Все материалы и цифры вымышлены.

## Связанные репозитории

- [iilmchat/ai-brand](https://github.com/iilmchat/ai-brand) — брендкит IIRuChating.
- [iilmchat/ai-ticketbuyer](https://github.com/iilmchat/ai-ticketbuyer) — образец организации документации и стека.

## Лицензия

**Proprietary.** © 2026 RuChating (iilmchat). Все права защищены. См. [LICENSE](LICENSE).
