import { type FormEvent, useState } from 'react';
import { api, type Member } from '../api';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';

export function MembersPage({ accountId }: { accountId: string }) {
  const url = `/api/accounts/${encodeURIComponent(accountId)}/members`;
  const members = useAsync(() => api.get<Member[]>(url), [url]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function invite(event: FormEvent) {
    event.preventDefault();
    try {
      await api.post(url, { email, name });
      setMessage(`${email} agora é membro da conta.`);
      setEmail('');
      setName('');
      members.reload();
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  return (
    <Layout title="Membros">
      {members.error && <p className="error">{errorText(members.error)}</p>}
      <ul className="list">
        {members.data?.map((member) => (
          <li key={member.userId}>
            {member.name} ({member.email}): {member.role === 'owner' ? 'dono' : 'membro'}
          </li>
        ))}
      </ul>
      <form onSubmit={invite} className="card">
        <h2>Convidar membro</h2>
        <label>
          E-mail
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Nome
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit">Convidar</button>
        {message && <p className="message">{message}</p>}
      </form>
    </Layout>
  );
}
