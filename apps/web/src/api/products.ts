import {
  productSchema,
  type CreateProductInput,
  type Product,
  type UpdateProductInput,
} from '@dzenwriter/shared';
import { apiRequest } from './client';

export function createProduct(input: CreateProductInput): Promise<Product> {
  return apiRequest('/api/v1/products', { method: 'POST', body: input, schema: productSchema });
}

export function updateProduct(id: string, input: UpdateProductInput): Promise<Product> {
  return apiRequest(`/api/v1/products/${id}`, {
    method: 'PATCH',
    body: input,
    schema: productSchema,
  });
}
