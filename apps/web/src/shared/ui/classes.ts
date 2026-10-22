// Общие классы интерфейса: цвета и роли Material 3 из ai-brand, без HEX в компонентах.
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export const BUTTON_PRIMARY = `inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 font-medium text-on-primary disabled:opacity-50 ${FOCUS_RING}`;

export const BUTTON_SECONDARY = `inline-flex items-center justify-center rounded-full border border-outline-variant px-5 py-2.5 font-medium disabled:opacity-50 ${FOCUS_RING}`;

export const INPUT_CLASS = `w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-base ${FOCUS_RING}`;

export const LABEL_CLASS = 'flex flex-col gap-1 text-sm font-medium';

export const PANEL_CLASS = 'rounded-2xl border border-outline-variant bg-surface-container p-6';
