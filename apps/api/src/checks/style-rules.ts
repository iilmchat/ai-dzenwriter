import type { VersionCheck } from '@dzenwriter/shared';
import { check, type CheckContext } from './check-context';
import { isKnownName, stemOf } from './text-analysis';

// Проверки, которые настраиваются стилем: уровень берётся из style.checks,
// нет ключа — проверка выключена.
export function runStyleChecks(context: CheckContext): VersionCheck[] {
  const { style } = context.input;
  const results: VersionCheck[] = [];

  const severityOf = (id: string): VersionCheck['severity'] | undefined => style.checks[id];

  const numbers = severityOf('numbers_must_map_to_facts');
  if (numbers !== undefined) {
    results.push(...checkNumbers(context, numbers));
  }

  const names = severityOf('names_must_map_to_facts');
  if (names !== undefined) {
    results.push(...checkNames(context, names));
  }

  const claims = severityOf('claims_need_fact_ids');
  if (claims !== undefined) {
    results.push(...checkClaims(context, claims));
  }

  const superlatives = severityOf('superlatives_need_fact');
  if (superlatives !== undefined) {
    results.push(...checkSuperlatives(context, superlatives));
  }

  const guarantees = severityOf('guarantees_forbidden');
  if (guarantees !== undefined) {
    results.push(...checkGuarantees(context, guarantees));
  }

  const firstPerson = severityOf('first_person_expected');
  if (firstPerson !== undefined) {
    results.push(...checkFirstPerson(context, firstPerson));
  }

  const personalNames = severityOf('personal_names_forbidden');
  if (personalNames !== undefined) {
    results.push(...checkPersonalNames(context, personalNames));
  }

  const clientNames = severityOf('client_names_need_permission');
  if (clientNames !== undefined) {
    results.push(...checkClientNames(context, clientNames));
  }

  const disclosure = severityOf('ad_disclosure_required');
  if (disclosure !== undefined) {
    results.push(...checkAdDisclosure(context, disclosure));
  }

  const limitations = severityOf('limitations_section_required');
  if (limitations !== undefined) {
    results.push(...checkLimitations(context, limitations));
  }

  const sourceDate = severityOf('source_date_required');
  if (sourceDate !== undefined) {
    results.push(...checkSourceDate(context, sourceDate));
  }

  return results;
}

// Каждое число, процент, сумма и дата в тексте должны быть в фактах.
function checkNumbers(context: CheckContext, severity: VersionCheck['severity']): VersionCheck[] {
  const results: VersionCheck[] = [];
  for (const number of context.numbers) {
    const known = number.forms.some((form) => context.factNumberForms.has(form));
    if (known) {
      continue;
    }
    results.push(
      check('numbers_must_map_to_facts', severity, `«${number.raw}» не найдено в фактах`, {
        start: number.start,
        end: number.end,
        excerpt: number.raw,
      }),
    );
  }
  return results;
}

// Имена, продукты и организации должны быть в фактах или в теме.
function checkNames(context: CheckContext, severity: VersionCheck['severity']): VersionCheck[] {
  const results: VersionCheck[] = [];
  for (const name of context.names) {
    if (isKnownName(name.text, context.nameCorpus)) {
      continue;
    }
    results.push(
      check('names_must_map_to_facts', severity, `«${name.text}» не найдено в фактах или теме`, {
        start: name.start,
        end: name.end,
        excerpt: name.text,
      }),
    );
  }
  return results;
}

// Утверждение о факте должно ссылаться на факт, и такой метки должен быть в списке.
function checkClaims(context: CheckContext, severity: VersionCheck['severity']): VersionCheck[] {
  const results: VersionCheck[] = [];
  for (const claim of context.input.claims) {
    if (claim.type !== 'fact') {
      if (claim.fact_ids.length > 0) {
        results.push(
          check(
            'claims_need_fact_ids',
            severity,
            `Утверждение «${truncate(claim.text)}» — ${claim.type}, но в нём указаны fact_ids`,
          ),
        );
      }
      continue;
    }
    if (claim.fact_ids.length === 0) {
      results.push(
        check(
          'claims_need_fact_ids',
          severity,
          `Утверждение о факте «${truncate(claim.text)}» без fact_ids`,
        ),
      );
      continue;
    }
    const unknown = claim.fact_ids.filter((id) => !context.factLabels.has(id));
    if (unknown.length > 0) {
      results.push(
        check(
          'claims_need_fact_ids',
          severity,
          `Утверждение «${truncate(claim.text)}» ссылается на неизвестные метки: ${unknown.join(', ')}`,
        ),
      );
    }
  }
  return results;
}

// Превосходная степень требует подтверждающего факта. Сравнение идёт по основе:
// «лучшее» в тексте подтверждается фактом со словом «лучшим».
function checkSuperlatives(
  context: CheckContext,
  severity: VersionCheck['severity'],
): VersionCheck[] {
  const results: VersionCheck[] = [];
  const factCorpus = context.facts
    .map((fact) => fact.text)
    .join(' \n ')
    .toLowerCase();
  const text = context.input.articleMarkdown;
  const lower = text.toLowerCase();

  const seen = new Set<string>();
  for (const word of context.input.config.superlative_words) {
    const isPhrase = word.includes(' ');
    const stem = isPhrase ? word.toLowerCase() : stemOf(word);
    if (seen.has(stem)) {
      continue;
    }
    seen.add(stem);

    const index = isPhrase ? lower.indexOf(stem) : findByStem(lower, stem);
    if (index < 0) {
      continue;
    }
    if (factCorpus.includes(stem)) {
      continue;
    }
    results.push(
      check(
        'superlatives_need_fact',
        severity,
        `«${word}» — превосходная степень без подтверждающего факта`,
        { start: index, end: index + stem.length, excerpt: word },
      ),
    );
  }
  return results;
}

// Первое вхождение основы как отдельного слова.
function findByStem(lowerText: string, stem: string): number {
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${stem}\\p{L}*([^\\p{L}\\p{N}]|$)`, 'iu');
  const match = pattern.exec(lowerText);
  if (!match) {
    return -1;
  }
  return (match.index ?? 0) + (match[1]?.length ?? 0);
}

// Запрещённые обещания: гарантии, которые нельзя делать без факта.
function checkGuarantees(
  context: CheckContext,
  severity: VersionCheck['severity'],
): VersionCheck[] {
  const results: VersionCheck[] = [];
  const lower = context.input.articleMarkdown.toLowerCase();
  for (const phrase of context.input.config.forbidden_guarantees) {
    const needle = phrase.toLowerCase();
    const index = lower.indexOf(needle);
    if (index < 0) {
      continue;
    }
    results.push(
      check(
        'guarantees_forbidden',
        severity,
        `«${phrase}» — обещание, которое нельзя делать без факта`,
        { start: index, end: index + phrase.length, excerpt: phrase },
      ),
    );
  }
  return results;
}

// В личном опыте текст идёт от первого лица.
const FIRST_PERSON = ['я', 'мне', 'меня', 'мной', 'мой', 'моя', 'моё', 'мои'];

function checkFirstPerson(
  context: CheckContext,
  severity: VersionCheck['severity'],
): VersionCheck[] {
  const lower = context.input.articleMarkdown.toLowerCase();
  const found = FIRST_PERSON.some((word) => hasWord(lower, word));
  if (found) {
    return [];
  }
  return [
    check(
      'first_person_expected',
      severity,
      'В тексте нет первого лица: личный опыт пишется от «я»',
    ),
  ];
}

// В личном опыте людей и компании не называют: только тема и продукт.
function checkPersonalNames(
  context: CheckContext,
  severity: VersionCheck['severity'],
): VersionCheck[] {
  const results: VersionCheck[] = [];
  for (const name of context.names) {
    if (isKnownName(name.text, context.topicCorpus)) {
      continue;
    }
    results.push(
      check(
        'personal_names_forbidden',
        severity,
        `«${name.text}» — в личном опыте имена и компании не называют`,
        { start: name.start, end: name.end, excerpt: name.text },
      ),
    );
  }
  return results;
}

// Клиент назван в тексте, а разрешения на это нет.
function checkClientNames(
  context: CheckContext,
  severity: VersionCheck['severity'],
): VersionCheck[] {
  const results: VersionCheck[] = [];
  const lower = context.input.articleMarkdown.toLowerCase();

  for (const fact of context.facts) {
    if (!fact.mentionsClient || fact.clientPermission) {
      continue;
    }
    for (const name of detectFactNames(fact.text, context)) {
      const index = lower.indexOf(name.toLowerCase());
      if (index < 0) {
        continue;
      }
      results.push(
        check(
          'client_names_need_permission',
          severity,
          `Клиент «${name}» назван в тексте, а разрешения нет (факт ${fact.label})`,
          { start: index, end: index + name.length, excerpt: name },
        ),
      );
    }
  }
  return results;
}

// Текст о продукте без маркировки рекламы.
function checkAdDisclosure(
  context: CheckContext,
  severity: VersionCheck['severity'],
): VersionCheck[] {
  if (context.input.productName === null || context.input.advertisingLabel) {
    return [];
  }
  return [
    check(
      'ad_disclosure_required',
      severity,
      `В тексте о продукте «${context.input.productName}» нет маркировки рекламы`,
    ),
  ];
}

// В тексте о продукте должен быть раздел об ограничениях.
const LIMITATION_MARKERS = [
  'ограничен',
  'ограничения',
  'не поддержив',
  'не работает',
  'минус',
  'чего не',
];

function checkLimitations(
  context: CheckContext,
  severity: VersionCheck['severity'],
): VersionCheck[] {
  if (context.input.productName === null) {
    return [];
  }
  const lower = context.input.articleMarkdown.toLowerCase();
  const found = LIMITATION_MARKERS.some((marker) => lower.includes(marker));
  if (found) {
    return [];
  }
  return [
    check(
      'limitations_section_required',
      severity,
      'В тексте о продукте нет раздела об ограничениях',
    ),
  ];
}

// У источника новости должна быть дата публикации. Смотрим на все привязанные
// факты: неодобренный источник тоже должен быть дополнен.
function checkSourceDate(
  context: CheckContext,
  severity: VersionCheck['severity'],
): VersionCheck[] {
  const results: VersionCheck[] = [];
  for (const fact of context.linkedFacts) {
    if (fact.type !== 'news_source' || fact.sourcePublishedAt !== null) {
      continue;
    }
    results.push(
      check('source_date_required', severity, `У источника ${fact.label} нет даты публикации`),
    );
  }
  return results;
}

// Имена внутри текста факта: по ним понимаем, кого назвали.
function detectFactNames(text: string, context: CheckContext): string[] {
  const stop = new Set(context.input.config.name_stop_words.map((word) => word.toLowerCase()));
  const names: string[] = [];
  for (const match of text.matchAll(/[\p{Lu}][\p{L}\p{N}'’]*/gu)) {
    const word = match[0];
    if (word.length < 2 || stop.has(word.toLowerCase())) {
      continue;
    }
    if (!names.includes(word)) {
      names.push(word);
    }
  }
  return names;
}

// Слово есть в тексте как отдельное слово, а не как часть другого.
function hasWord(lowerText: string, word: string): boolean {
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${word}([^\\p{L}\\p{N}]|$)`, 'iu');
  return pattern.test(lowerText);
}

function truncate(text: string, limit = 60): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}
