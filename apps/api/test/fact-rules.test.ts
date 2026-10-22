import { describe, expect, it } from 'vitest';
import {
  approvalProblems,
  factActions,
  type FactActor,
  type FactRuleFields,
} from '../src/facts/fact-rules';

const AUTHOR_ID = 'author-id';
const AUTHOR: FactActor = { id: AUTHOR_ID, role: 'author' };
const REVIEWER: FactActor = { id: 'reviewer-id', role: 'reviewer' };
const ADMIN: FactActor = { id: 'admin-id', role: 'admin' };

function fact(overrides: Partial<FactRuleFields> = {}): FactRuleFields {
  return {
    type: 'company_fact',
    status: 'draft',
    text: 'Команда тестирует промпты',
    sourceUrl: null,
    sourcePublishedAt: null,
    productId: null,
    mentionsClient: false,
    clientPermission: false,
    consentConfirmed: false,
    anonymized: false,
    createdBy: { id: AUTHOR_ID },
    hasPendingCorrection: false,
    ...overrides,
  };
}

describe('одобрение фактов', () => {
  it('ревьюер одобряет чужой черновик, автор своего — нет', () => {
    expect(factActions(fact(), REVIEWER).approve).toMatchObject({ allowed: true });

    const own = factActions(fact(), AUTHOR).approve;
    expect(own).toMatchObject({ allowed: false, forbidden: true });
    expect(own.reason).toMatch(/ревьюер/);
  });

  it('ревьюер не одобряет собственный факт, даже с ролью ревьюера', () => {
    const mine = fact({ createdBy: { id: REVIEWER.id } });
    expect(factActions(mine, REVIEWER).approve).toMatchObject({ allowed: false, forbidden: true });
  });

  it('новость без ссылки и даты называет, чего не хватает', () => {
    const bare = fact({ type: 'news_source' });
    expect(approvalProblems(bare)).toEqual([
      'нет ссылки на источник',
      'нет даты публикации источника',
    ]);
    expect(factActions(bare, REVIEWER).approve.reason).toBe(
      'Нельзя одобрить: нет ссылки на источник, нет даты публикации источника',
    );
  });

  it('заметка опыта одобряется только с согласием и обезличиванием', () => {
    const note = fact({ type: 'experience_note', text: 'Заметка' });
    expect(approvalProblems(note)).toEqual([
      'нет отметки «согласие получено»',
      'нет отметки «текст обезличен»',
    ]);
    const ready = fact({
      type: 'experience_note',
      text: 'Заметка',
      consentConfirmed: true,
      anonymized: true,
    });
    expect(factActions(ready, REVIEWER).approve.allowed).toBe(true);
  });

  it('клиент в тексте без разрешения блокирует одобрение', () => {
    const named = fact({ mentionsClient: true, clientPermission: false });
    expect(approvalProblems(named)).toEqual(['в тексте назван клиент, а разрешения нет']);
  });
});

describe('правка и исправление', () => {
  it('одобренный факт не редактируется, исправление — новый факт', () => {
    const approved = fact({ status: 'approved' });
    const edit = factActions(approved, AUTHOR).edit;
    expect(edit).toMatchObject({ allowed: false, forbidden: false });
    expect(edit.reason).toMatch(/исправить его можно только новым фактом/);
    expect(factActions(approved, AUTHOR).correct.allowed).toBe(true);
  });

  it('чужой автор не меняет факт, администратор меняет', () => {
    expect(factActions(fact(), { id: 'other', role: 'author' }).edit.forbidden).toBe(true);
    expect(factActions(fact(), ADMIN).edit.allowed).toBe(true);
  });

  it('исправить можно одно исправление за раз', () => {
    const approved = fact({ status: 'approved', hasPendingCorrection: true });
    expect(factActions(approved, AUTHOR).correct).toMatchObject({
      allowed: false,
      reason: 'Исправление уже на проверке',
    });
    expect(factActions(fact(), AUTHOR).correct.allowed).toBe(false);
  });
});

describe('согласие на личный опыт', () => {
  it('согласие подтверждают только у заметок опыта', () => {
    expect(factActions(fact(), REVIEWER).confirmConsent).toMatchObject({ allowed: false });
    const note = fact({ type: 'experience_note' });
    expect(factActions(note, REVIEWER).confirmConsent.allowed).toBe(true);
    expect(factActions(note, AUTHOR).confirmConsent.forbidden).toBe(true);
  });

  it('отзыв может автор заметки, ревьюер или администратор, но не посторонний автор', () => {
    const note = fact({ type: 'experience_note', consentConfirmed: true, anonymized: true });
    expect(factActions(note, AUTHOR).withdrawConsent.allowed).toBe(true);
    expect(factActions(note, REVIEWER).withdrawConsent.allowed).toBe(true);
    expect(factActions(note, { id: 'other', role: 'author' }).withdrawConsent).toMatchObject({
      allowed: false,
      forbidden: true,
    });
  });

  it('повторный отзыв невозможен: текст уже удалён', () => {
    const withdrawn = fact({ type: 'experience_note', status: 'rejected', text: '' });
    expect(factActions(withdrawn, AUTHOR).withdrawConsent.reason).toBe(
      'Согласие уже отозвано, текст удалён',
    );
  });
});
