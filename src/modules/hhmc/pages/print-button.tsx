'use client';

/** "Print or save as PDF": the browser's own print dialog (no PDF library, DECISIONS P5-5). */
export function PrintButton({ label = 'Print or save as PDF' }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-50 print:hidden">
      {label}
    </button>
  );
}
