import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'emitters'; accountId: string }
  | { name: 'invoices'; accountId: string }
  | { name: 'invoice'; accountId: string; invoiceId: string }
  | { name: 'members'; accountId: string }
  | { name: 'admin' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [first, accountId, section, invoiceId] = parts;
  if (first === 'admin' && parts.length === 1) return { name: 'admin' };
  if (first === 'a' && accountId) {
    if (section === 'emitters' && parts.length === 3) return { name: 'emitters', accountId };
    if (section === 'invoices' && parts.length === 3) return { name: 'invoices', accountId };
    if (section === 'invoices' && invoiceId && parts.length === 4) {
      return { name: 'invoice', accountId, invoiceId };
    }
    if (section === 'members' && parts.length === 3) return { name: 'members', accountId };
  }
  return { name: 'home' };
}

export function routeHref(route: Route): string {
  const e = encodeURIComponent;
  switch (route.name) {
    case 'home':
      return '#/';
    case 'admin':
      return '#/admin';
    case 'invoice':
      return `#/a/${e(route.accountId)}/invoices/${e(route.invoiceId)}`;
    default:
      return `#/a/${e(route.accountId)}/${route.name}`;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
