import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
} from '@codemirror/view';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface EditorRange {
  readonly from: number;
  readonly to: number;
}

export interface MarkdownEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSave?: (() => void) | undefined;
  readonly onGenerate?: (() => void) | undefined;
  readonly onCommandPalette?: (() => void) | undefined;
  // Выделенный текст и окружение для локальной перегенерации фрагмента.
  readonly onRegenerateFragment?:
    ((selectedText: string, contextBefore: string, contextAfter: string) => void) | undefined;
  // Текущее выделение: по нему панель включает кнопку перегенерации.
  readonly onSelectionChange?: ((range: EditorRange | null) => void) | undefined;
  readonly placeholder?: string;
}

export interface MarkdownEditorHandle {
  // Перевести курсор к фрагменту и подсветить его: так работает переход по проверке.
  focusRange: (range: EditorRange | null) => void;
  // Заменить диапазон новым текстом: так применяется результат перегенерации.
  replaceRange: (range: EditorRange, insert: string) => void;
}

// Сколько знаков окружения видит модель: достаточно для связок, но без целой статьи.
const CONTEXT_CHARS = 400;

// Подсветка активного фрагмента: отдельное поле состояния, а не перерисовка документа.
const setHighlight = StateEffect.define<EditorRange | null>();

const highlightMark = Decoration.mark({ class: 'cm-editor__highlight' });

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setHighlight)) {
        const range = effect.value;
        value =
          range === null
            ? Decoration.none
            : Decoration.set([highlightMark.range(range.from, range.to)]);
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// Выделение и его окружение: границы фрагмента берутся из состояния CodeMirror.
function regenerateSelection(
  instance: EditorView,
  callback:
    ((selectedText: string, contextBefore: string, contextAfter: string) => void) | undefined,
): void {
  if (!callback) {
    return;
  }
  const selection = instance.state.selection.main;
  if (selection.empty) {
    return;
  }
  const doc = instance.state.doc.toString();
  callback(
    doc.slice(selection.from, selection.to),
    doc.slice(Math.max(0, selection.from - CONTEXT_CHARS), selection.from),
    doc.slice(selection.to, Math.min(doc.length, selection.to + CONTEXT_CHARS)),
  );
}

// Редактор Markdown на CodeMirror 6: подсветка синтаксиса, история правок, горячие клавиши.
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      value,
      onChange,
      onSave,
      onGenerate,
      onCommandPalette,
      onRegenerateFragment,
      onSelectionChange,
      placeholder,
    },
    ref,
  ) {
    const host = useRef<HTMLDivElement | null>(null);
    const view = useRef<EditorView | null>(null);
    // Начальное содержимое читается один раз: правки приходят через onChange,
    // а извне документ меняется отдельным эффектом ниже.
    const initialValue = useRef(value);
    const onChangeRef = useRef(onChange);
    const onSaveRef = useRef(onSave);
    const onGenerateRef = useRef(onGenerate);
    const onPaletteRef = useRef(onCommandPalette);
    const onRegenerateRef = useRef(onRegenerateFragment);
    const onSelectionRef = useRef(onSelectionChange);
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
    onGenerateRef.current = onGenerate;
    onPaletteRef.current = onCommandPalette;
    onRegenerateRef.current = onRegenerateFragment;
    onSelectionRef.current = onSelectionChange;

    useEffect(() => {
      const element = host.current;
      if (!element) {
        return;
      }
      const extensions: Extension[] = [
        history(),
        drawSelection(),
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        syntaxHighlighting(defaultHighlightStyle),
        markdown({ base: markdownLanguage }),
        highlightField,
        EditorView.lineWrapping,
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              onSaveRef.current?.();
              return true;
            },
          },
          {
            key: 'Mod-Enter',
            preventDefault: true,
            run: () => {
              onGenerateRef.current?.();
              return true;
            },
          },
          {
            key: 'Mod-k',
            preventDefault: true,
            run: () => {
              onPaletteRef.current?.();
              return true;
            },
          },
          {
            key: 'Mod-Shift-r',
            preventDefault: true,
            run: (instance) => {
              if (instance.state.selection.main.empty) {
                return false;
              }
              regenerateSelection(instance, onRegenerateRef.current);
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
          if (update.selectionSet || update.docChanged) {
            const selection = update.state.selection.main;
            onSelectionRef.current?.(
              selection.empty ? null : { from: selection.from, to: selection.to },
            );
          }
        }),
        EditorState.readOnly.of(false),
      ];
      if (placeholder !== undefined) {
        extensions.push(placeholderExtension(placeholder));
      }

      const instance = new EditorView({
        state: EditorState.create({ doc: initialValue.current, extensions }),
        parent: element,
      });
      view.current = instance;
      return () => {
        instance.destroy();
        view.current = null;
      };
    }, [placeholder]);

    // Документ меняется извне (загрузка версии, откат): заменяем содержимое целиком.
    useEffect(() => {
      const instance = view.current;
      if (!instance) {
        return;
      }
      const current = instance.state.doc.toString();
      if (current === value) {
        return;
      }
      instance.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }, [value]);

    useImperativeHandle(
      ref,
      () => ({
        focusRange(range) {
          const instance = view.current;
          if (!instance) {
            return;
          }
          if (range === null) {
            instance.dispatch({ effects: setHighlight.of(null) });
            return;
          }
          const length = instance.state.doc.length;
          const from = Math.min(Math.max(range.from, 0), length);
          const to = Math.min(Math.max(range.to, from), length);
          instance.dispatch({
            effects: setHighlight.of({ from, to }),
            selection: { anchor: from, head: to },
            scrollIntoView: true,
          });
          instance.focus();
        },
        replaceRange(range, insert) {
          const instance = view.current;
          if (!instance) {
            return;
          }
          const length = instance.state.doc.length;
          const from = Math.min(Math.max(range.from, 0), length);
          const to = Math.min(Math.max(range.to, from), length);
          instance.dispatch({ changes: { from, to, insert } });
          instance.focus();
        },
      }),
      [],
    );

    return (
      <div
        ref={host}
        className="h-full overflow-auto rounded-xl border border-outline-variant bg-surface-container-lowest"
        data-testid="markdown-editor"
      />
    );
  },
);
