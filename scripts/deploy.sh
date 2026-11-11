#!/usr/bin/env bash
# Первичный деплой и обновление DzenWriter на сервере.
# Скрипт идемпотентен: повторный запуск загружает образы из GHCR, применяет
# миграции и перезапускает стек. Резервные копии не делает — они живут в отдельном
# systemd-таймере компании.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

readonly HEALTH_TIMEOUT_SECONDS=60
readonly HEALTH_INTERVAL_SECONDS=2

log() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] ОШИБКА: %s\n' "$*" >&2
  exit 1
}

# Значение из .env. Переменная окружения имеет приоритет — как у docker compose.
# CR отредактированного в Windows файла и обрамляющие кавычки отбрасываем.
env_value() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" .env 2>/dev/null | tail -n 1 | cut -d= -f2-)" || true
  value="${value%$'\r'}"
  value="${value%\"}"
  value="${value#\"}"
  printf '%s' "${value}"
}

if [[ ! -f .env ]]; then
  fail "не найден .env в ${ROOT_DIR}: скопируйте .env.example и заполните значения"
fi
if [[ ! -r .env ]]; then
  fail ".env существует, но недоступен для чтения"
fi

command -v docker >/dev/null 2>&1 || fail "Docker не установлен или не найден в PATH"
docker compose version >/dev/null 2>&1 ||
  fail "Docker Compose не установлен: нужен плагин 'docker compose'"
command -v curl >/dev/null 2>&1 ||
  fail "curl не установлен: он нужен для проверки /health и /ready"

WEB_PORT="${WEB_PORT:-$(env_value WEB_PORT)}"
WEB_PORT="${WEB_PORT:-8080}"
if [[ ! "${WEB_PORT}" =~ ^[0-9]+$ ]]; then
  fail "WEB_PORT должен быть числом, получено: ${WEB_PORT}"
fi

# Пароль по умолчанию из docker-compose.yml недопустим в продакшене.
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(env_value POSTGRES_PASSWORD)}"
if [[ -z "${POSTGRES_PASSWORD}" || "${POSTGRES_PASSWORD}" == "dzenwriter" ]]; then
  fail "POSTGRES_PASSWORD не задан или равен небезопасному значению по умолчанию 'dzenwriter'"
fi

if git rev-parse --git-dir >/dev/null 2>&1; then
  commit="$(git rev-parse --short HEAD)"
  branch="$(git rev-parse --abbrev-ref HEAD)"
  log "Версия: ${branch}@${commit}"
else
  log "Версия: git-репозиторий не найден, хеш коммита неизвестен"
fi

log "1/4 Загрузка образов из GHCR (docker compose pull)"
docker compose pull

log "2/4 Применение миграций (docker compose run --rm migrate)"
if ! docker compose run --rm migrate; then
  fail "миграции завершились с ошибкой"
fi

log "3/4 Запуск API и Web (docker compose up -d --wait)"
if ! docker compose up -d --wait; then
  log "Стек не поднялся. Логи API:"
  docker compose logs api || true
  fail "docker compose up завершился с ошибкой"
fi

log "4/4 Проверка здоровья (до ${HEALTH_TIMEOUT_SECONDS} с)"
deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
healthy=0
while (( SECONDS < deadline )); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${WEB_PORT}/health" >/dev/null 2>&1 &&
    curl -fsS --max-time 3 "http://127.0.0.1:${WEB_PORT}/ready" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep "${HEALTH_INTERVAL_SECONDS}"
done

if (( healthy == 0 )); then
  log "API не прошёл проверку за ${HEALTH_TIMEOUT_SECONDS} с. Логи API:"
  docker compose logs api || true
  docker compose ps || true
  fail "здоровье стека не подтверждено"
fi

log "Деплой успешен."
log "Приложение: http://127.0.0.1:${WEB_PORT}"
