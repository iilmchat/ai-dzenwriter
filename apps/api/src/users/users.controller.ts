import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import {
  type UpdateUserInput,
  type UserItem,
  type UserListResponse,
  updateUserInputSchema,
} from '@dzenwriter/shared';
import { AuthUser, Roles } from '../auth/auth.decorators';
import type { SessionUser } from '../auth/auth.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { UserRow } from '../identity/identity.repository';
import { UsersService } from './users.service';

// Управление пользователями доступно только администратору.
@Controller('users')
@Roles('admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(): Promise<UserListResponse> {
    const rows = await this.users.list();
    return { items: rows.map(toUserItem) };
  }

  @Patch(':id')
  async update(
    @Param(
      'id',
      new ParseUUIDPipe({
        exceptionFactory: () => new BadRequestException('Некорректный идентификатор пользователя'),
      }),
    )
    id: string,
    @Body(new ZodValidationPipe(updateUserInputSchema)) body: UpdateUserInput,
    @AuthUser() actor: SessionUser,
  ): Promise<UserItem> {
    const user = await this.users.update(actor, id, body, new Date());
    return toUserItem(user);
  }
}

function toUserItem(row: UserRow): UserItem {
  return {
    id: row.id,
    login: row.login,
    name: row.name,
    role: row.role,
    disabled: row.disabledAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}
