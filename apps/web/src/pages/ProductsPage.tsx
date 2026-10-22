import type { Product } from '@dzenwriter/shared';
import { useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import { fetchProducts } from '../api/catalog';
import { updateProduct } from '../api/products';
import { ProductForm } from '../features/products/ProductForm';
import { useSession } from '../session/SessionContext';
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FOCUS_RING, PANEL_CLASS } from '../shared/ui/classes';
import { Notice } from '../shared/ui/Notice';

type ProductsState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly items: readonly Product[] }
  | { readonly phase: 'error'; readonly message: string };

interface Feedback {
  readonly tone: 'neutral' | 'error';
  readonly text: string;
}

// Справочник виден всем, менять его может только администратор. Продукт не удаляется — его архивируют.
export function ProductsPage() {
  const { state: session } = useSession();
  const isAdmin = session.phase === 'authenticated' && session.user.role === 'admin';
  const [products, setProducts] = useState<ProductsState>({ phase: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | undefined>(undefined);
  const [feedback, setFeedback] = useState<Feedback | undefined>(undefined);

  useEffect(() => {
    let active = true;
    fetchProducts().then(
      (response) => {
        if (active) {
          setProducts({ phase: 'ready', items: response.items });
        }
      },
      (cause: unknown) => {
        if (active) {
          setProducts({ phase: 'error', message: errorMessage(cause) });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [reloadKey]);

  function reload(message: string) {
    setFeedback({ tone: 'neutral', text: message });
    setReloadKey((value) => value + 1);
  }

  async function toggleArchive(product: Product) {
    setBusyId(product.id);
    try {
      await updateProduct(product.id, { archived: !product.archived });
      reload(
        product.archived
          ? `Продукт «${product.name}» возвращён в работу`
          : `Продукт «${product.name}» перенесён в архив`,
      );
    } catch (cause) {
      setFeedback({ tone: 'error', text: errorMessage(cause) });
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Продукты</h1>
          <p className="mt-2 max-w-3xl text-on-surface-variant">
            Продукты, о которых пишем. Архивный продукт не выбирают для новых материалов и фактов, а
            старые ссылки сохраняются.
          </p>
        </div>
        {isAdmin ? (
          <button
            type="button"
            className={`${BUTTON_PRIMARY} ${FOCUS_RING}`}
            aria-expanded={creating}
            aria-controls="create-product"
            onClick={() => setCreating((value) => !value)}
          >
            {creating ? 'Закрыть форму' : 'Новый продукт'}
          </button>
        ) : null}
      </header>

      {!isAdmin ? (
        <Notice>Справочник ведёт администратор. Здесь видно, какие продукты доступны.</Notice>
      ) : null}
      {feedback ? <Notice tone={feedback.tone}>{feedback.text}</Notice> : null}

      {isAdmin && creating ? (
        <section id="create-product" aria-labelledby="create-product-title" className={PANEL_CLASS}>
          <h2 id="create-product-title" className="font-display text-lg font-bold">
            Новый продукт
          </h2>
          <div className="mt-4">
            <ProductForm
              onSaved={(product) => {
                setCreating(false);
                reload(`Продукт «${product.name}» добавлен`);
              }}
              onCancel={() => setCreating(false)}
            />
          </div>
        </section>
      ) : null}

      {products.phase === 'loading' ? <Notice>Загружаем продукты…</Notice> : null}
      {products.phase === 'error' ? <Notice tone="error">{products.message}</Notice> : null}
      {products.phase === 'ready' && products.items.length === 0 ? (
        <Notice>Продуктов пока нет.</Notice>
      ) : null}

      {products.phase === 'ready' ? (
        <ul className="flex flex-col gap-4">
          {products.items.map((product) => (
            <li key={product.id} className={PANEL_CLASS}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="font-display text-lg font-bold">
                    {product.name}
                    {product.archived ? ' (в архиве)' : ''}
                  </h3>
                  <p className="text-on-surface-variant">{product.oneLiner}</p>
                  <p className="text-xs text-on-surface-variant">Идентификатор: {product.slug}</p>
                </div>
                {isAdmin ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={BUTTON_SECONDARY}
                      aria-expanded={editingId === product.id}
                      onClick={() =>
                        setEditingId(editingId === product.id ? undefined : product.id)
                      }
                    >
                      Изменить
                    </button>
                    <button
                      type="button"
                      className={BUTTON_SECONDARY}
                      disabled={busyId === product.id}
                      onClick={() => void toggleArchive(product)}
                    >
                      {product.archived ? 'Вернуть из архива' : 'В архив'}
                    </button>
                  </div>
                ) : null}
              </div>
              {isAdmin && editingId === product.id ? (
                <div className="mt-4">
                  <ProductForm
                    initial={product}
                    onSaved={() => {
                      setEditingId(undefined);
                      reload(`Продукт «${product.name}» сохранён`);
                    }}
                    onCancel={() => setEditingId(undefined)}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
