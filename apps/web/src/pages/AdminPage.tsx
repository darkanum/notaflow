import { type FormEvent, useState } from 'react';
import { type AdminAccount, api, type AuditEntry } from '../api';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { formatDate } from '../format';

type Act = (action: () => Promise<string>) => Promise<void>;

export function AdminPage() {
  const accounts = useAsync(() => api.get<AdminAccount[]>('/api/admin/accounts'), []);
  const audit = useAsync(() => api.get<AuditEntry[]>('/api/admin/audit?limit=100'), []);
  const [message, setMessage] = useState<string | null>(null);

  const act: Act = async (action) => {
    try {
      setMessage(await action());
      accounts.reload();
      audit.reload();
    } catch (error) {
      setMessage(errorText(error));
    }
  };

  function toggle(account: AdminAccount) {
    void act(async () => {
      const status = account.status === 'active' ? 'suspended' : 'active';
      await api.post(`/api/admin/accounts/${encodeURIComponent(account.id)}/status`, { status });
      return status === 'suspended' ? `${account.name} suspensa.` : `${account.name} reativada.`;
    });
  }

  return (
    <Layout title="Painel do administrador">
      {message && <p className="message">{message}</p>}
      {accounts.error && <p className="error">{errorText(accounts.error)}</p>}
      <table>
        <thead>
          <tr>
            <th>Conta</th>
            <th>Situação</th>
            <th>Membros</th>
            <th>Id</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {accounts.data?.map((account) => (
            <tr key={account.id}>
              <td>{account.name}</td>
              <td>{account.status === 'active' ? 'Ativa' : 'Suspensa'}</td>
              <td>{account.members}</td>
              <td>
                <code>{account.id}</code>
              </td>
              <td>
                <button onClick={() => toggle(account)}>
                  {account.status === 'active' ? 'Suspender' : 'Reativar'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewAccountForm act={act} />
      <NewUserForm act={act} />
      <SetMemberForm act={act} />
      <section className="card">
        <h2>Auditoria (últimas 100)</h2>
        <ul>
          {audit.data?.map((entry) => (
            <li key={entry.id}>
              {formatDate(entry.at)} {entry.userEmail}: {entry.action} {entry.entity} (
              {entry.result}){entry.detail && ` ${entry.detail}`}
            </li>
          ))}
        </ul>
      </section>
    </Layout>
  );
}

function NewAccountForm({ act }: { act: Act }) {
  const [name, setName] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      const { id } = await api.post<{ id: string }>('/api/admin/accounts', { name });
      setName('');
      return `Conta criada: ${id}`;
    });
  }
  return (
    <form onSubmit={submit} className="card">
      <h2>Nova conta</h2>
      <label>
        Nome
        <input required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit">Criar conta</button>
    </form>
  );
}

function NewUserForm({ act }: { act: Act }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [admin, setAdmin] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      const { id } = await api.post<{ id: string }>('/api/admin/users', {
        email,
        name,
        ...(admin ? { platformRole: 'admin' } : {}),
      });
      setEmail('');
      setName('');
      return `Usuário criado: ${id}`;
    });
  }
  return (
    <form onSubmit={submit} className="card">
      <h2>Novo usuário</h2>
      <label>
        E-mail
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Nome
        <input required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />{' '}
        Administrador da plataforma
      </label>
      <button type="submit">Criar usuário</button>
    </form>
  );
}

function SetMemberForm({ act }: { act: Act }) {
  const [accountId, setAccountId] = useState('');
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<'owner' | 'member'>('owner');
  function submit(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      await api.put(
        `/api/admin/accounts/${encodeURIComponent(accountId)}/members/${encodeURIComponent(userId)}`,
        { role },
      );
      return 'Vínculo salvo.';
    });
  }
  return (
    <form onSubmit={submit} className="card">
      <h2>Vincular usuário a uma conta</h2>
      <label>
        Id da conta
        <input required value={accountId} onChange={(e) => setAccountId(e.target.value)} />
      </label>
      <label>
        Id do usuário
        <input required value={userId} onChange={(e) => setUserId(e.target.value)} />
      </label>
      <label>
        Papel
        <select value={role} onChange={(e) => setRole(e.target.value as 'owner' | 'member')}>
          <option value="owner">Dono</option>
          <option value="member">Membro</option>
        </select>
      </label>
      <button type="submit">Salvar</button>
    </form>
  );
}
