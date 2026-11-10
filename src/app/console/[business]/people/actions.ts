'use server';

import { addMember, changeMemberRole, removeMember, setMemberPermissions } from '@/core/people/memberships';
import type { BusinessRole } from '@/core/rbac/roles';
import type { ActionResult } from '@/ui/action-form';
import { act, text } from '../../../_lib/actions';
import { requireBusinessContext } from '../../../_lib/session';

export async function addMemberAction(slug: string, _previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return act(async () => {
    const ctx = await requireBusinessContext(slug);
    await addMember(ctx, { name: text(formData, 'name'), email: text(formData, 'email'), role: text(formData, 'role') });
    return 'Added.';
  });
}

export async function changeMemberRoleAction(slug: string, membershipId: string, role: BusinessRole): Promise<ActionResult> {
  return act(async () => {
    await changeMemberRole(await requireBusinessContext(slug), membershipId, role);
  });
}

export async function removeMemberAction(slug: string, membershipId: string): Promise<ActionResult> {
  return act(async () => {
    await removeMember(await requireBusinessContext(slug), membershipId);
  });
}

export async function setMemberPermissionsAction(slug: string, membershipId: string, _previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return act(async () => {
    const keys = formData.getAll('permission').filter((v): v is string => typeof v === 'string');
    await setMemberPermissions(await requireBusinessContext(slug), membershipId, keys);
    return 'Saved.';
  });
}
