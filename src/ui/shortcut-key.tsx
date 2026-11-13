'use client';

import { useSyncExternalStore } from 'react';

const noop = () => () => {};
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The search shortcut as this computer writes it: ⌘K on a Mac, Ctrl K elsewhere (server: Ctrl K). */
export function SearchShortcut() {
  return useSyncExternalStore(noop, () => (isMac() ? '⌘K' : 'Ctrl K'), () => 'Ctrl K');
}
