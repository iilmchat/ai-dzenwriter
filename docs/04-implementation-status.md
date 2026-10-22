# Статус реализации

**Статус:** E1 Foundations выполнен. Дальше: E2 Auth и роли.  
**Дата:** 22.10.2026

## Что работает

| Область                | Что сделано                                                                                                         | Как проверено                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Монорепо               | pnpm 12.11.2, workspaces `apps/*` и `packages/*`, Turborepo, TypeScript 5.9                                         | `pnpm build`, `pnpm typecheck`                                    |
| Качество кода          | ESLint, Prettier, защита от свежих версий пакетов (`minimumReleaseAge`: сутки)                                      | `pnpm lint`, `pnpm format:check`                                  |
| Конфигурация `config/` | Zod-схемы стилей и форматов; проверка при старте API и командой `pnpm config:validate`; ошибки называют файл и поле | `app-config.test.ts`, `pnpm config:validate`                      |
| Переменные окружения   | Zod-схема; понятная ошибка с именем переменной                                                                      | `env.test.ts`                                                     |
| База данных            | 12 таблиц модели данных, CHECK-ограничения, индексы, UUID по умолчанию в БД                                         | `database.test.ts`, 6 проверок                                    |
| Неизменяемость         | Триггеры: версии статей и журнал аудита нельзя изменить или удалить                                                 | тест «запрещает изменять версии статьи», ручная проверка `UPDATE` |
| Демо-данные            | `pnpm db:seed`; идемпотентно (advisory-блокировка), запрещено при `NODE_ENV=production`                             | два запуска подряд: второй пропускает загрузку                    |
| API                    | `GET /health` (живость), `GET /ready` (база), ошибки RFC 9457 с `requestId`, helmet, JSON-логи pino                 | `app.test.ts`, ручная проверка через nginx                        |
| Веб                    | Страница с логотипом IIRuChating (токены ai-brand) и состоянием сервиса по `/ready`                                 | `App.test.tsx`, e2e `smoke.spec.ts`                               |
| Docker                 | Образы `api` и `web` (multi-stage, `pnpm deploy`, непривилегированный nginx); compose: postgres, migrate, api, web  | `docker compose up -d --wait`, `/ready` через nginx               |
| CI                     | GitHub Actions: проверки и тесты, e2e в браузере, сборка и запуск compose                                           | вкладка Actions репозитория                                       |
| Зависимости            | Dependabot для npm, GitHub Actions и Docker                                                                         | `.github/dependabot.yml`                                          |

## Миграции

| Файл                              | Содержание                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `0000_overrated_donald_blake.sql` | Схема: таблицы, CHECK, внешние ключи, индексы, полнотекстовый индекс `russian` по фактам |
| `0001_append_only_guards.sql`     | Триггеры: `article_versions` и `audit_log` нельзя изменять и удалять                     |
| `0002_lazy_overlord.sql`          | UUID по умолчанию выдаёт БД (`gen_random_uuid()`)                                        |

Миграции только вперёд. Уже применённые файлы не правим: исправление — новой миграцией.

## Решения, принятые в E1

- Миграции — отдельный сервис `migrate` в compose и отдельный шаг CI. Это отличие от ai-ticketbuyer, где API мигрирует при старте.
- Порты на хосте задаются переменными `POSTGRES_PORT` и `WEB_PORT`. На машине разработки 5432 и 8080 заняты другими проектами.
- `@dzenwriter/shared` собирается tsup в ESM и CJS: веб (Vite) и API (NestJS, CJS) используют разные системы модулей.
- Тесты NestJS идут через SWC (`unplugin-swc`): esbuild не поддерживает `emitDecoratorMetadata`.
- Интеграционные тесты БД работают в транзакциях с откатом и не оставляют данных.
- Dev-режим API запускается через Nest CLI (`nest start --watch --tsc`). `tsx` на esbuild не выдаёт метаданные декораторов, и внедрение зависимостей ломается: `/ready` отдавал 500. Проверено на dev-сервере.
- Порты задаются в корневом `.env`: `API_PORT`, `WEB_DEV_PORT`, `WEB_PREVIEW_PORT`, `POSTGRES_PORT`, `WEB_PORT`. Dev-сервер веба, предпросмотр, Playwright и API читают одни и те же значения.
- Корневой `.env` веб-конфиг читает через `util.parseEnv` без побочных эффектов. `loadEnv` из Vite пишет переменные в `process.env`, и `NODE_ENV=development` из `.env` выбирал development-JSX в production-сборке (`jsxDEV is not a function` в браузере). Режим сборки задаётся самим Vite, без переопределений.

## Что не сделано (сознательно)

- Аутентификация и роли: E2.
- Шрифты Inter, Manrope и Montserrat грузятся из Google Fonts. Для продакшена нужны локальные `.woff2` (см. `FONTS.md` брендкита), переход — в E2.
- Образ `api` ставит pnpm через `npm install -g`, на медленной сети это долго. Оптимизация: corepack или кэш слоя.
- Движок проверок (E7) ещё не реализован. Ключи `checks` валидируются по списку `STYLE_CHECK_IDS` из `packages/shared`.
- Юридические пункты из [06-legal-and-safety](06-legal-and-safety.md) не закрыты.
- Официальные способы публикации в Дзен не проверены (ADR-0002).

## Что проверено

- `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm config:validate` проходят без ошибок.
- `pnpm test`: shared 5, db 6, api 9, web 3 теста. Все проходят на PostgreSQL 16.
- `pnpm test:e2e`: сценарий «главная страница показывает состояние сервиса» проходит в Chromium.
- `pnpm dev`: API на 4010 отвечает `/health` и `/ready` (200), веб на 5183 отдаёт приложение, а его прокси `/ready` возвращает 200.
- `docker compose up -d --wait`: postgres здоров, migrate завершается с кодом 0, api и web здоровы. Через nginx отвечают `/`, `/health` и `/ready` (200), а `/api/v1/unknown` отдаёт 404 в формате problem+json.
- Бренд-ассеты совпадают с `ai-brand` по коммиту `e143a2bb894ec532f0afcdf9c5e4d48d83612405`.

## Следующий шаг

E2 Auth и роли: вход через GitHub OAuth, членство в организации `iilmchat`, роли author, reviewer и admin, сессии в БД (см. [ADR-0005](adr/0005-github-oauth-org-access.md)).
