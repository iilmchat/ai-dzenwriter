import {
  userItemSchema,
  userListResponseSchema,
  type UpdateUserInput,
  type UserItem,
  type UserListResponse,
} from '@dzenwriter/shared';
import { apiRequest } from './client';

export function fetchUsers(): Promise<UserListResponse> {
  return apiRequest('/api/v1/users', { schema: userListResponseSchema });
}

export function updateUser(id: string, input: UpdateUserInput): Promise<UserItem> {
  return apiRequest(`/api/v1/users/${id}`, {
    method: 'PATCH',
    body: input,
    schema: userItemSchema,
  });
}
