import type { FormatCard, Product, StyleCard } from '@dzenwriter/shared';
import { useEffect, useState } from 'react';
import { fetchFormats, fetchProducts, fetchStyles } from '../../api/catalog';

export interface CatalogState {
  readonly styles: readonly StyleCard[];
  readonly formats: readonly FormatCard[];
  readonly products: readonly Product[];
  readonly loaded: boolean;
  readonly failed: boolean;
}

// Справочники для форм и фильтров: стили, форматы и продукты загружаются один раз.
export function useCatalog(): CatalogState {
  const [state, setState] = useState<CatalogState>({
    styles: [],
    formats: [],
    products: [],
    loaded: false,
    failed: false,
  });

  useEffect(() => {
    let active = true;
    Promise.all([fetchStyles(), fetchFormats(), fetchProducts()]).then(
      ([styles, formats, products]) => {
        if (active) {
          setState({
            styles: styles.items,
            formats: formats.items,
            products: products.items.filter((product) => !product.archived),
            loaded: true,
            failed: false,
          });
        }
      },
      () => {
        if (active) {
          setState({ styles: [], formats: [], products: [], loaded: true, failed: true });
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return state;
}
