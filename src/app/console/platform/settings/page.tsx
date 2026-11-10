import type { Metadata } from 'next';
import { authorize } from '@/core/rbac/permissions';
import { getRetentionDays } from '@/core/settings/platform';
import { ActionForm } from '@/ui/action-form';
import { Card, Field, PageHeader, inputClass } from '@/ui/layout';
import { guarded, requirePlatformContext } from '@/server/session';
import { saveRetentionAction } from './actions';

export const metadata: Metadata = { title: 'Platform settings' };

export default async function PlatformSettingsPage() {
  const ctx = await requirePlatformContext();
  await guarded(async () => authorize(ctx, 'platform.settings.read'));
  const days = await getRetentionDays();
  const canWrite = ctx.permissions.has('platform.settings.write');
  return (
    <>
      <PageHeader
        title="Platform settings"
        description="Settings that apply to the whole platform. Only a super admin can change them."
      />
      <Card
        title="Retention window"
        description="How long a record must stay archived before a super admin may permanently delete it."
        className="max-w-xl"
      >
        {canWrite ? (
          <ActionForm action={saveRetentionAction} submitLabel="Save" resetOnSuccess={false}>
            <Field label="Days" htmlFor="days" help="Between 1 and 3650. The default is 30.">
              <input
                id="days"
                name="days"
                type="number"
                min={1}
                max={3650}
                required
                defaultValue={days}
                className={`${inputClass} max-w-32`}
              />
            </Field>
          </ActionForm>
        ) : (
          <p className="text-sm text-zinc-800">
            <span className="text-xl font-semibold tabular-nums">{days}</span> days
          </p>
        )}
      </Card>
    </>
  );
}
