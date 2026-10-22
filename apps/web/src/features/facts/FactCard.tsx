import {
  FACT_STATUS_LABELS,
  FACT_TYPE_LABELS,
  type FactItem,
  type Product,
} from '@dzenwriter/shared';
import { useState } from 'react';
import { errorMessage } from '../../api/client';
import { approveFact, confirmConsent, rejectFact, withdrawConsent } from '../../api/facts';
import { capitalize, formatDate, formatDateTime } from '../../lib/format';
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from '../../shared/ui/classes';
import { FactForm } from './FactForm';

interface FactCardProps {
  readonly fact: FactItem;
  readonly products: readonly Product[];
  readonly onChanged: (message: string) => void;
  readonly onError: (message: string) => void;
}

type OpenPanel = 'none' | 'edit' | 'correction' | 'consent' | 'withdraw';

// Кнопки показываем только для доступных действий. Причину недоступного действия — одной строкой.
export function FactCard({ fact, products, onChanged, onError }: FactCardProps) {
  const [open, setOpen] = useState<OpenPanel>('none');
  const [anonymized, setAnonymized] = useState(fact.anonymized);
  const [busy, setBusy] = useState(false);
  const { actions } = fact;
  const note = hint(fact);

  async function run(action: () => Promise<FactItem>, done: string) {
    setBusy(true);
    try {
      await action();
      setOpen('none');
      onChanged(done);
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-outline-variant bg-surface p-5">
      <header className="flex flex-wrap items-center gap-2 text-xs font-medium">
        <span className="rounded-full bg-secondary-container px-2.5 py-1 text-on-secondary-container">
          {capitalize(FACT_TYPE_LABELS[fact.type])}
        </span>
        <span className="rounded-full border border-outline-variant px-2.5 py-1">
          {FACT_STATUS_LABELS[fact.status]}
        </span>
        {fact.supersedesId ? (
          <span className="rounded-full border border-outline-variant px-2.5 py-1">
            Исправление
          </span>
        ) : null}
        {fact.hasPendingCorrection ? (
          <span className="rounded-full border border-outline-variant px-2.5 py-1">
            Исправление на проверке
          </span>
        ) : null}
        {fact.productName ? (
          <span className="rounded-full border border-outline-variant px-2.5 py-1">
            {fact.productName}
          </span>
        ) : null}
        <span className="ml-auto text-on-surface-variant">версия {fact.version}</span>
      </header>

      <p className="whitespace-pre-line leading-relaxed">
        {fact.text || 'Текст удалён после отзыва согласия.'}
      </p>

      <ul className="flex flex-col gap-1 text-sm text-on-surface-variant">
        <li>Создал: {fact.createdBy.name ?? fact.createdBy.login}</li>
        {fact.sourceName || fact.sourceUrl || fact.sourcePublishedAt ? (
          <li>
            Источник: {fact.sourceName ?? 'без названия'}
            {fact.sourcePublishedAt ? `, ${formatDate(fact.sourcePublishedAt)}` : ''}
            {fact.sourceUrl ? (
              <>
                {' · '}
                <a
                  href={fact.sourceUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                  className="underline"
                >
                  ссылка
                </a>
              </>
            ) : null}
          </li>
        ) : null}
        {fact.approvedBy && fact.approvedAt ? (
          <li>
            Одобрил: {fact.approvedBy.login}, {formatDateTime(fact.approvedAt)}
          </li>
        ) : null}
        {fact.mentionsClient ? (
          <li>Клиент назван: {fact.clientPermission ? 'разрешение есть' : 'разрешения нет'}</li>
        ) : null}
        {fact.type === 'experience_note' ? (
          <li>
            Согласие:{' '}
            {fact.consentConfirmed && fact.consentConfirmedAt
              ? `подтверждено, ${fact.consentConfirmedBy ?? 'без имени'}, ${formatDateTime(fact.consentConfirmedAt)}`
              : 'не подтверждено'}
            ; текст обезличен: {fact.anonymized ? 'да' : 'нет'}
          </li>
        ) : null}
      </ul>

      <div className="flex flex-wrap gap-2">
        {actions.edit.allowed ? (
          <button
            type="button"
            className={BUTTON_SECONDARY}
            disabled={busy}
            onClick={() => setOpen('edit')}
          >
            Изменить
          </button>
        ) : null}
        {actions.approve.allowed ? (
          <button
            type="button"
            className={BUTTON_PRIMARY}
            disabled={busy}
            onClick={() => void run(() => approveFact(fact.id, fact.version), 'Факт одобрен')}
          >
            Одобрить
          </button>
        ) : null}
        {actions.reject.allowed ? (
          <button
            type="button"
            className={BUTTON_SECONDARY}
            disabled={busy}
            onClick={() => void run(() => rejectFact(fact.id, fact.version), 'Факт отклонён')}
          >
            Отклонить
          </button>
        ) : null}
        {actions.confirmConsent.allowed ? (
          <button
            type="button"
            className={BUTTON_SECONDARY}
            disabled={busy}
            onClick={() => setOpen('consent')}
          >
            Подтвердить согласие
          </button>
        ) : null}
        {actions.withdrawConsent.allowed ? (
          <button
            type="button"
            className={BUTTON_SECONDARY}
            disabled={busy}
            onClick={() => setOpen('withdraw')}
          >
            Отозвать согласие
          </button>
        ) : null}
        {actions.correct.allowed ? (
          <button
            type="button"
            className={BUTTON_SECONDARY}
            disabled={busy}
            onClick={() => setOpen('correction')}
          >
            Исправить
          </button>
        ) : null}
      </div>

      {note ? <p className="text-sm text-on-surface-variant">{note}</p> : null}

      {open === 'edit' ? (
        <FactForm
          mode="edit"
          products={products}
          initial={fact}
          onSaved={() => {
            setOpen('none');
            onChanged('Правка сохранена');
          }}
          onCancel={() => setOpen('none')}
        />
      ) : null}

      {open === 'correction' ? (
        <FactForm
          mode="correction"
          products={products}
          initial={fact}
          onSaved={() => {
            setOpen('none');
            onChanged('Исправление создано: оно ждёт одобрения ревьюера');
          }}
          onCancel={() => setOpen('none')}
        />
      ) : null}

      {open === 'consent' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => confirmConsent(fact.id, fact.version, anonymized),
              'Согласие подтверждено',
            );
          }}
          className="flex flex-col gap-3 rounded-xl bg-surface-container p-4"
        >
          <p className="text-sm">
            Подтвердите, что автор опыта дал согласие на публикацию и что имена в тексте заменены
            ролями.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={anonymized}
              onChange={(event) => setAnonymized(event.target.checked)}
            />
            Текст обезличен
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={BUTTON_PRIMARY} disabled={busy || !anonymized}>
              Подтвердить
            </button>
            <button type="button" className={BUTTON_SECONDARY} onClick={() => setOpen('none')}>
              Отмена
            </button>
          </div>
        </form>
      ) : null}

      {open === 'withdraw' ? (
        <div
          role="group"
          aria-label="Отзыв согласия"
          className="flex flex-col gap-3 rounded-xl bg-error-container p-4 text-on-error-container"
        >
          <p className="text-sm">
            Текст заметки удалится сразу, восстановить его будет нельзя. В журнале останутся
            идентификатор и дата.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={BUTTON_PRIMARY}
              disabled={busy}
              onClick={() =>
                void run(
                  () => withdrawConsent(fact.id, fact.version),
                  'Согласие отозвано, текст удалён',
                )
              }
            >
              Отозвать и удалить текст
            </button>
            <button type="button" className={BUTTON_SECONDARY} onClick={() => setOpen('none')}>
              Отмена
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

// Главная причина, почему дальше нельзя: для черновика — одобрение, для одобренного — исправление.
function hint(fact: FactItem): string | undefined {
  if (fact.status === 'draft' && !fact.actions.approve.allowed) {
    return fact.actions.approve.reason ?? undefined;
  }
  if (fact.status === 'approved' && !fact.actions.correct.allowed) {
    return fact.actions.correct.reason ?? undefined;
  }
  return undefined;
}
