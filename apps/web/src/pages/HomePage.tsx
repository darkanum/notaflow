import { api, type Me } from '../api';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { routeHref } from '../router';
import { Alert, Badge, Card, Link, Spinner } from '../ui';

export function HomePage() {
  const me = useAsync(() => api.get<Me>('/api/me'), []);
  if (me.error) {
    return (
      <Layout title="NotaFlow">
        <Alert variant="error">{errorText(me.error)}</Alert>
      </Layout>
    );
  }
  if (!me.data) {
    return (
      <Layout title="NotaFlow">
        <Spinner />
      </Layout>
    );
  }
  const { data } = me;
  return (
    <Layout title={`Olá, ${data.name}`}>
      {data.platformRole === 'admin' && (
        <p>
          <Link href={routeHref({ name: 'admin' })}>Painel do administrador</Link>
        </p>
      )}
      {data.accounts.length === 0 && (
        <Alert variant="info">
          <p>
            Você ainda não participa de nenhuma conta. Seu id de usuário é{' '}
            <code className="font-mono">{data.userId}</code>; envie-o ao administrador.
          </p>
        </Alert>
      )}
      <ul className="grid gap-4 sm:grid-cols-2">
        {data.accounts.map((account) => (
          <li key={account.id}>
            <Card className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="font-display text-lg text-fg">{account.name}</strong>
                <Badge>{account.role === 'owner' ? 'dono' : 'membro'}</Badge>
                {account.status === 'suspended' && <Badge variant="warning">suspensa</Badge>}
              </div>
              <nav className="flex flex-wrap gap-4 text-sm">
                <Link href={routeHref({ name: 'invoices', accountId: account.id })}>Notas</Link>
                <Link href={routeHref({ name: 'emitters', accountId: account.id })}>Emitentes</Link>
                <Link href={routeHref({ name: 'customers', accountId: account.id })}>Clientes</Link>
                {account.role === 'owner' && (
                  <Link href={routeHref({ name: 'members', accountId: account.id })}>Membros</Link>
                )}
              </nav>
            </Card>
          </li>
        ))}
      </ul>
    </Layout>
  );
}
