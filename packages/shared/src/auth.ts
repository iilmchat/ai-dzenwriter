import { z } from 'zod';
import { USER_ROLES } from './enums';

// Ответ GET /api/v1/me: пользователь текущей сессии.
export const currentUserSchema = z.object({
  id: z.uuid(),
  login: z.string().min(1),
  name: z.string().nullable(),
  role: z.enum(USER_ROLES),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

// Пользователь в списке администратора.
export const userItemSchema = currentUserSchema.extend({
  disabled: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type UserItem = z.infer<typeof userItemSchema>;

export const userListResponseSchema = z.object({
  items: z.array(userItemSchema),
});
export type UserListResponse = z.infer<typeof userListResponseSchema>;

// Тело PATCH /api/v1/users/{id}: нужна роль или признак отключения.
export const updateUserInputSchema = z
  .object({
    role: z.enum(USER_ROLES, { error: 'Роль должна быть author, reviewer или admin' }).optional(),
    disabled: z.boolean({ error: 'Поле disabled должно быть true или false' }).optional(),
  })
  .refine((input) => input.role !== undefined || input.disabled !== undefined, {
    error: 'Укажите роль или признак отключения',
  });
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;
