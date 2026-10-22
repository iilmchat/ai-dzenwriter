import { z } from 'zod';

export const PRODUCT_NAME_MAX_LENGTH = 120;
export const PRODUCT_ONE_LINER_MAX_LENGTH = 300;

export const productSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  oneLiner: z.string(),
  archived: z.boolean(),
});
export type Product = z.infer<typeof productSchema>;

export const productListResponseSchema = z.object({ items: z.array(productSchema) });

const productSlugSchema = z
  .string()
  .trim()
  .min(2, 'Идентификатор продукта короче 2 знаков')
  .max(80, 'Идентификатор продукта длиннее 80 знаков')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Идентификатор: латиница в нижнем регистре, цифры и дефисы');
const productNameSchema = z
  .string()
  .trim()
  .min(1, 'Укажите название продукта')
  .max(PRODUCT_NAME_MAX_LENGTH, `Название длиннее ${PRODUCT_NAME_MAX_LENGTH} знаков`);
const productOneLinerSchema = z
  .string()
  .trim()
  .min(1, 'Опишите продукт одной строкой')
  .max(PRODUCT_ONE_LINER_MAX_LENGTH, `Описание длиннее ${PRODUCT_ONE_LINER_MAX_LENGTH} знаков`);

// Справочник ведёт администратор. Архивирование вместо удаления: материалы и факты сохраняют ссылку.
export const createProductInputSchema = z.object({
  slug: productSlugSchema,
  name: productNameSchema,
  oneLiner: productOneLinerSchema,
});
export type CreateProductInput = z.infer<typeof createProductInputSchema>;

export const updateProductInputSchema = z
  .object({
    slug: productSlugSchema.optional(),
    name: productNameSchema.optional(),
    oneLiner: productOneLinerSchema.optional(),
    archived: z.boolean({ error: 'Признак архива — true или false' }).optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    error: 'Укажите, что изменить',
  });
export type UpdateProductInput = z.infer<typeof updateProductInputSchema>;
