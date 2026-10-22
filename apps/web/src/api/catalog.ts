import {
  formatListResponseSchema,
  productListResponseSchema,
  styleListResponseSchema,
} from '@dzenwriter/shared';
import { apiRequest } from './client';

export function fetchStyles() {
  return apiRequest('/api/v1/styles', { schema: styleListResponseSchema });
}

export function fetchFormats() {
  return apiRequest('/api/v1/formats', { schema: formatListResponseSchema });
}

export function fetchProducts() {
  return apiRequest('/api/v1/products', { schema: productListResponseSchema });
}
