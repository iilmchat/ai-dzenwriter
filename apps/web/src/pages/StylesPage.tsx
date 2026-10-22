import {
  ARTICLE_FORMAT_LABELS,
  FACT_POLICY_LABELS,
  FACT_TYPE_LABELS,
  type FormatCard,
  type StyleCard,
} from '@dzenwriter/shared';
import { useCatalog } from '../features/catalog/useCatalog';
import { PANEL_CLASS } from '../shared/ui/classes';
import { Notice } from '../shared/ui/Notice';

const PERSON_LABELS: Record<StyleCard['voice']['person'], string> = {
  first: 'от первого лица',
  we: 'от лица команды',
  third: 'третье лицо',
};

const REGISTER_LABELS: Record<string, string> = {
  analytical: 'аналитический',
  conversational: 'разговорный',
  descriptive: 'описательный',
  'friendly-descriptive': 'дружелюбный, описательный',
};

// Карточки только для чтения: стили меняются в репозитории через PR.
export function StylesPage() {
  const catalog = useCatalog();

  if (!catalog.loaded) {
    return <Notice>Загружаем стили и форматы…</Notice>;
  }
  if (catalog.failed) {
    return <Notice tone="error">Не удалось загрузить стили и форматы.</Notice>;
  }

  return (
    <div className="flex flex-col gap-10">
      <header>
        <h1 className="font-display text-3xl font-bold">Стили и форматы</h1>
        <p className="mt-2 text-on-surface-variant">
          Голос, политика фактов и требования на входе. Формат задаёт каркас и объём, стиль — голос
          и факты.
        </p>
      </header>

      <section aria-labelledby="styles-title" className="flex flex-col gap-4">
        <h2 id="styles-title" className="font-display text-xl font-bold">
          Стили
        </h2>
        <ul className="grid gap-4 md:grid-cols-2">
          {catalog.styles.map((style) => (
            <StyleCardView key={style.id} style={style} formats={catalog.formats} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="formats-title" className="flex flex-col gap-4">
        <h2 id="formats-title" className="font-display text-xl font-bold">
          Форматы
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">Форматы материалов</caption>
            <thead>
              <tr className="border-b border-outline-variant text-on-surface-variant">
                <th scope="col" className="px-3 py-2 font-medium">
                  Формат
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Объём, знаков
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Блоки или пункты
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Структура
                </th>
              </tr>
            </thead>
            <tbody>
              {catalog.formats.map((format) => (
                <FormatRow key={format.id} format={format} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StyleCardView({
  style,
  formats,
}: {
  readonly style: StyleCard;
  readonly formats: readonly FormatCard[];
}) {
  const allowed = style.allowedFormats
    .map((id) => formats.find((format) => format.id === id)?.name ?? ARTICLE_FORMAT_LABELS[id])
    .join(', ');
  const blocking = style.checks.filter((check) => check.severity === 'block').length;
  const warnings = style.checks.length - blocking;
  const requirements = [
    `${style.inputs.requiredFactTypes.map((type) => FACT_TYPE_LABELS[type]).join(', ')}, не меньше ${style.inputs.minFacts}`,
    style.inputs.minNoteChars !== null
      ? `заметки от ${style.inputs.minNoteChars} знаков`
      : undefined,
    style.inputs.requiresProduct ? 'продукт' : undefined,
    style.inputs.requiresConsent ? 'согласие автора' : undefined,
    style.inputs.requiresAnonymization ? 'обезличивание' : undefined,
  ].filter((item): item is string => item !== undefined);

  return (
    <li className={PANEL_CLASS}>
      <h3 className="font-display text-xl font-bold">{style.name}</h3>
      <p className="mt-2 text-on-surface-variant">{style.summary}</p>
      <div className="mt-4 flex flex-col gap-2 text-sm">
        <p>
          <strong>Голос:</strong> {PERSON_LABELS[style.voice.person]},{' '}
          {REGISTER_LABELS[style.voice.register] ?? style.voice.register}
          {style.voice.readerAddress === 'you' ? ', обращение на «вы»' : ''}
        </p>
        <p>
          <strong>Политика фактов:</strong> {FACT_POLICY_LABELS[style.factPolicy]}
        </p>
        <p>
          <strong>Нужно на входе:</strong> {requirements.join('; ')}
        </p>
        <p>
          <strong>Форматы:</strong> {allowed}
        </p>
        <p>
          <strong>Проверки:</strong> блокирующих {blocking}, предупреждений {warnings}
        </p>
        <p className="text-on-surface-variant">
          <strong className="text-on-surface">Оговорка:</strong> {style.disclaimer.text}{' '}
          {style.disclaimer.always
            ? '(добавляется всегда)'
            : '(для медицинских, юридических и финансовых тем)'}
        </p>
      </div>
    </li>
  );
}

function FormatRow({ format }: { readonly format: FormatCard }) {
  const blocksOrItems = format.blocks
    ? `${format.blocks.min}–${format.blocks.max} блоков`
    : format.items
      ? `${format.items.min}–${format.items.max} пунктов`
      : '—';
  return (
    <tr className="border-b border-outline-variant align-top">
      <th scope="row" className="px-3 py-3 font-medium">
        {format.name}
      </th>
      <td className="px-3 py-3">
        {format.length.min}–{format.length.max}
      </td>
      <td className="px-3 py-3">{blocksOrItems}</td>
      <td className="px-3 py-3 text-on-surface-variant">{format.structure}</td>
    </tr>
  );
}
