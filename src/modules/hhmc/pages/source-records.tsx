import type { SourceRecord } from '../services/source';

const TYPE_LABELS: Record<string, string> = {
  contact: 'Contact',
  lead: 'Lead',
  work_request: 'Work request',
  work_order: 'Work order',
  estimate: 'Estimate',
  invoice: 'Invoice',
  payment: 'Payment',
};

/** Every column Movegistics exported for this record, folded away under each row's id. */
export function SourceRecords({ records }: { records: SourceRecord[] }) {
  if (!records.length) return null;
  return (
    <section aria-label="From Movegistics" className="rounded-lg border border-zinc-200 bg-white">
      <h2 className="px-4 pt-3 text-sm font-semibold text-zinc-900">From Movegistics</h2>
      <p className="px-4 pb-2 text-xs text-zinc-500">Everything the Movegistics export held for this record, as exported (blank columns left out).</p>
      {records.map((r) => (
        <details key={`${r.type}:${r.sourceId}`} className="group border-t border-zinc-200">
          <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-medium text-zinc-700 select-none hover:text-zinc-900 [&::-webkit-details-marker]:hidden">
            <span className="mr-1.5 inline-block text-zinc-400 transition-transform group-open:rotate-90">›</span>
            {`${TYPE_LABELS[r.type] ?? r.type} ${r.sourceId}`}
          </summary>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 px-4 pb-4 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
            {Object.entries(r.data).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-zinc-500">{k}</dt>
                <dd className="break-words text-zinc-900">{v}</dd>
              </div>
            ))}
          </dl>
        </details>
      ))}
    </section>
  );
}
