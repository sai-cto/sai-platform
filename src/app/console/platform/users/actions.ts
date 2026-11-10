'use server';

import { addMember } from '@/core/people/memberships';
import { createUser, listUsers, setPlatformRole, setUserActive } from '@/core/people/users';
import { NotFoundError, ValidationError } from '@/core/errors';
import { PLATFORM_ROLES, type PlatformRole } from '@/core/rbac/roles';
import type { ActionResult } from '@/ui/action-form';
import { act, text } from '../../../_lib/actions';
import { requireBusinessContext, requirePlatformContext } from '../../../_lib/session';

export async function createUserAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return act(async () => {
    await createUser(await requirePlatformContext(), {
      name: text(formData, 'name'),
      email: text(formData, 'email'),
    });
    return 'User created. Give them a role next.';
  });
}

export async function setPlatformRoleAction(
  userId: string,
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return act(async () => {
    const value = text(formData, 'platformRole');
    if (value !== '' && !PLATFORM_ROLES.includes(value as PlatformRole))
      throw new ValidationError('Unknown role.');
    await setPlatformRole(
      await requirePlatformContext(),
      userId,
      value === '' ? null : (value as PlatformRole),
    );
    return 'Saved. They have been signed out and will get the new role when they sign in.';
  });
}

export async function setUserActiveAction(
  userId: string,
  isActive: boolean,
): Promise<ActionResult> {
  return act(async () => {
    await setUserActive(await requirePlatformContext(), userId, isActive);
  });
}

/** Gives an existing user a role in a business (the tech team's shortcut to People and access). */
export async function addMembershipAction(
  userId: string,
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return act(async () => {
    const platform = await requirePlatformContext();
    const user = (await listUsers(platform)).find((u) => u.id === userId);
    if (!user) throw new NotFoundError();
    const business = await requireBusinessContext(text(formData, 'business'));
    await addMember(business, { name: user.name, email: user.email, role: text(formData, 'role') });
    return 'Added.';
  });
}
