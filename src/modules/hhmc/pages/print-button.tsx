'use client';

/** "Print or save as PDF": the browser's own print dialog (no PDF library, DECISIONS P5-5). */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-md border border-zinc-300 px-3 py-2 text-sm print:hidden">
      Print or save as PDF
    </button>
  );
}
