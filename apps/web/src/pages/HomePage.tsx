import { api, type Me } from '../api';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { routeHref } from '../router';

export function HomePage() {
  const me = useAsync(() => api.get<Me>('/api/me'), []);
  if (me.error) {
    return (
      <Layout title="NotaFlow">
        <p className="error">{errorText(me.error)}</p>
      </Layout>
    );
  }
  if (!me.data) {
    return (
      <Layout title="NotaFlow">
        <p>Carregando...</p>
      </Layout>
    );
  }
  const { data } = me;
  return (
    <Layout title={`Olá, ${data.name}`}>
      {data.platformRole === 'admin' && (
        <p>
          <a href={routeHref({ name: 'admin' })}>Painel do administrador</a>
        </p>
      )}
      {data.accounts.length === 0 && <p>Você ainda não participa de nenhuma conta.</p>}
      <ul className="list">
        {data.accounts.map((account) => (
          <li key={account.id} className="card">
            <strong>{account.name}</strong> ({account.role === 'owner' ? 'dono' : 'membro'})
            {account.status === 'suspended' && <span className="warning"> suspensa</span>}
            <nav>
              <a href={routeHref({ name: 'invoices', accountId: account.id })}>Notas</a>
              <a href={routeHref({ name: 'emitters', accountId: account.id })}>Emitentes</a>
              {account.role === 'owner' && (
                <a href={routeHref({ name: 'members', accountId: account.id })}>Membros</a>
              )}
            </nav>
          </li>
        ))}
      </ul>
    </Layout>
  );
}
