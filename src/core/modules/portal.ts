/** Finding the page for a path inside a module's portal. */
import type { PortalDef, RouteDef } from './contract';

/**
 * Matches path segments against a portal's routes. "orders/:id" matches ["orders", "42"]
 * and captures { id: "42" }. Returns null when nothing matches.
 */
export function matchRoute(portal: PortalDef, segments: string[]): { route: RouteDef; params: Record<string, string> } | null {
  for (const route of portal.routes) {
    const parts = route.path === '' ? [] : route.path.split('/');
    if (parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const matches = parts.every((part, index) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(segments[index]);
        return true;
      }
      return part === segments[index];
    });
    if (matches) return { route, params };
  }
  return null;
}
