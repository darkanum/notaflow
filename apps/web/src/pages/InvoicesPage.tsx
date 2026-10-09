import { type FormEvent, useState } from 'react';
import { api, type Emitter, type InvoicePage } from '../api';
import { EnvironmentBadge } from '../components/EnvironmentBadge';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { formatCents, formatCompetence } from '../format';
import { routeHref } from '../router';

export const STATUS_TEXT: Record<string, string> = {
  pending: 'Pendente',
  issued: 'Emitida',
  rejected: 'Rejeitada',
  unknown: 'Incerta',
  cancelled: 'Cancelada',
};

const PAGE = 50;

type Filters = {
  emitterId: string;
  status: string;
  competenceFrom: string;
  competenceTo: string;
  q: string;
};

export function InvoicesPage({ accountId }: { accountId: string }) {
  const base = `/api/accounts/${encodeURIComponent(accountId)}`;
  const [filters, setFilters] = useState<Filters>({
    emitterId: '',
    status: '',
    competenceFrom: '',
    competenceTo: '',
    q: '',
  });
  const [offset, setOffset] = useState(0);
  const [accessKey, setAccessKey] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const emitters = useAsync(() => api.get<Emitter[]>(`${base}/emitters`), [base]);
  const query = new URLSearchParams(
    Object.entries({ ...filters, limit: String(PAGE), offset: String(offset) }).filter(
      ([, value]) => value !== '',
    ),
  ).toString();
  const page = useAsync(() => api.get<InvoicePage>(`${base}/invoices?${query}`), [base, query]);

  async function lookup(event: FormEvent) {
    event.preventDefault();
    setLookupError(null);
    try {
      const { id } = await api.post<{ id: string }>(`${base}/invoices/lookup`, {
        accessKey: accessKey.trim(),
      });
      window.location.hash = routeHref({ name: 'invoice', accountId, invoiceId: id });
    } catch (error) {
      setLookupError(errorText(error));
    }
  }

  const set = (field: keyof Filters) => (value: string) => {
    setOffset(0);
    setFilters((previous) => ({ ...previous, [field]: value }));
  };

  return (
    <Layout title="Notas">
      <form onSubmit={lookup} className="card">
        <label>
          Buscar por chave de acesso
          <input value={accessKey} onChange={(e) => setAccessKey(e.target.value)} />
        </label>
        <button type="submit">Buscar</button>
        {lookupError && <p className="error">{lookupError}</p>}
      </form>
      <div className="card">
        <select
          aria-label="Emitente"
          value={filters.emitterId}
          onChange={(e) => set('emitterId')(e.target.value)}
        >
          <option value="">Todos os emitentes</option>
          {emitters.data?.map((emitter) => (
            <option key={emitter.id} value={emitter.id}>
              {emitter.companyName}
            </option>
          ))}
        </select>
        <select
          aria-label="Situação"
          value={filters.status}
          onChange={(e) => set('status')(e.target.value)}
        >
          <option value="">Todas as situações</option>
          {Object.entries(STATUS_TEXT).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
        <input
          aria-label="Competência de"
          type="date"
          value={filters.competenceFrom}
          onChange={(e) => set('competenceFrom')(e.target.value)}
        />
        <input
          aria-label="Competência até"
          type="date"
          value={filters.competenceTo}
          onChange={(e) => set('competenceTo')(e.target.value)}
        />
        <input
          aria-label="Pesquisar"
          placeholder="Número ou tomador"
          value={filters.q}
          onChange={(e) => set('q')(e.target.value)}
        />
      </div>
      {page.error && <p className="error">{errorText(page.error)}</p>}
      {page.data && (
        <>
          <table>
            <thead>
              <tr>
                <th>Número</th>
                <th>Competência</th>
                <th>Tomador</th>
                <th>Valor</th>
                <th>Situação</th>
                <th>Ambiente</th>
              </tr>
            </thead>
            <tbody>
              {page.data.items.map((invoice) => (
                <tr key={invoice.id}>
                  <td>
                    <a href={routeHref({ name: 'invoice', accountId, invoiceId: invoice.id })}>
                      {invoice.number ?? '-'}
                    </a>
                  </td>
                  <td>{formatCompetence(invoice.competence)}</td>
                  <td>{invoice.customerName}</td>
                  <td>{formatCents(invoice.serviceCents)}</td>
                  <td className={`status-${invoice.status}`}>{STATUS_TEXT[invoice.status]}</td>
                  <td>
                    {invoice.environment === 'producao' ? (
                      'Produção'
                    ) : (
                      <EnvironmentBadge environment={invoice.environment} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            {page.data.total} notas.{' '}
            {offset > 0 && <button onClick={() => setOffset(offset - PAGE)}>Anteriores</button>}
            {offset + PAGE < page.data.total && (
              <button onClick={() => setOffset(offset + PAGE)}>Próximas</button>
            )}
          </p>
        </>
      )}
    </Layout>
  );
}
