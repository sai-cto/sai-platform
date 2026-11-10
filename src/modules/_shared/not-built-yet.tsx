import { Badge } from '@/ui/badge';
import { Card } from '@/ui/layout';

export type ScaffoldInfo = { name: string; description: string; plannedScope: string[] };

/**
 * The staff portal of a module that has been registered but not built yet. It shows what
 * the module is for and what is planned, as written in its manifest.
 */
export function notBuiltYetPage(info: ScaffoldInfo) {
  return function NotBuiltYet() {
    return <NotBuiltYetCard info={info} />;
  };
}

function NotBuiltYetCard({ info }: { info: ScaffoldInfo }) {
  const planned = info.plannedScope;
  return (
    <div className="mx-auto max-w-2xl py-6">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-base font-semibold text-zinc-900">
            {info.name}
          </h1>
          <Badge>Not built yet</Badge>
        </div>
        <p className="mt-2 text-sm text-zinc-700">{info.description}</p>

        <h2 className="mt-5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          Planned scope
        </h2>
        {planned.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-800">
            {planned.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-zinc-600">Not planned yet.</p>
        )}

        <p className="mt-5 border-t border-zinc-100 pt-4 text-xs text-zinc-500">
          This business is registered on the platform, so its people, customers, payments, activity
          log and test mode already work in the other tabs. Its own staff portal will appear here
          once it is built.
        </p>
      </Card>
    </div>
  );
}
