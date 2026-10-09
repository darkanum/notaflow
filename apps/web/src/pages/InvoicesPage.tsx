import { type FormEvent, useState } from 'react';
import { api, type Emitter, type InvoicePage } from '../api';
import { EnvironmentBadge } from '../components/EnvironmentBadge';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { formatCents, formatCompetence } from '../format';
import { routeHref } from '../router';
import {
  Alert,
  Badge,
  type BadgeVariant,
  Button,
  CARD_CLASSES,
  Card,
  Field,
  Input,
  Link,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
} from '../ui';

export const STATUS_TEXT: Record<string, string> = {
  pending: 'Pendente',
  issued: 'Emitida',
  rejected: 'Rejeitada',
  unknown: 'Incerta',
  cancelled: 'Cancelada',
};

export const STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: 'info',
  issued: 'success',
  rejected: 'danger',
  unknown: 'warning',
  cancelled: 'neutral',
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
    <Layout title="Notas" accountId={accountId}>
      <form
        onSubmit={lookup}
        className={`${CARD_CLASSES} flex flex-col gap-3 sm:flex-row sm:items-end`}
      >
        <div className="flex-1">
          <Field label="Buscar por chave de acesso">
            <Input value={accessKey} onChange={(e) => setAccessKey(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" variant="secondary">
          Buscar
        </Button>
      </form>
      {lookupError && <Alert variant="error">{lookupError}</Alert>}
      <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select
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
        </Select>
        <Select
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
        </Select>
        <Input
          aria-label="Competência de"
          type="date"
          value={filters.competenceFrom}
          onChange={(e) => set('competenceFrom')(e.target.value)}
        />
        <Input
          aria-label="Competência até"
          type="date"
          value={filters.competenceTo}
          onChange={(e) => set('competenceTo')(e.target.value)}
        />
        <Input
          aria-label="Pesquisar"
          placeholder="Número ou tomador"
          value={filters.q}
          onChange={(e) => set('q')(e.target.value)}
        />
      </Card>
      {page.error && <Alert variant="error">{errorText(page.error)}</Alert>}
      {page.data && (
        <>
          <Table>
            <THead>
              <tr>
                <TH>Número</TH>
                <TH>Competência</TH>
                <TH>Tomador</TH>
                <TH>Valor</TH>
                <TH>Situação</TH>
                <TH>Ambiente</TH>
              </tr>
            </THead>
            <TBody>
              {page.data.items.map((invoice) => (
                <tr key={invoice.id}>
                  <TD>
                    <Link href={routeHref({ name: 'invoice', accountId, invoiceId: invoice.id })}>
                      {invoice.number ?? '-'}
                    </Link>
                  </TD>
                  <TD>{formatCompetence(invoice.competence)}</TD>
                  <TD>{invoice.customerName}</TD>
                  <TD className="whitespace-nowrap">{formatCents(invoice.serviceCents)}</TD>
                  <TD>
                    <Badge variant={STATUS_VARIANT[invoice.status]}>
                      {STATUS_TEXT[invoice.status]}
                    </Badge>
                  </TD>
                  <TD>
                    {invoice.environment === 'producao' ? (
                      'Produção'
                    ) : (
                      <EnvironmentBadge environment={invoice.environment} />
                    )}
                  </TD>
                </tr>
              ))}
            </TBody>
          </Table>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
            <span>{page.data.total} notas.</span>
            {offset > 0 && (
              <Button size="sm" variant="secondary" onClick={() => setOffset(offset - PAGE)}>
                Anteriores
              </Button>
            )}
            {offset + PAGE < page.data.total && (
              <Button size="sm" variant="secondary" onClick={() => setOffset(offset + PAGE)}>
                Próximas
              </Button>
            )}
          </div>
        </>
      )}
    </Layout>
  );
}
