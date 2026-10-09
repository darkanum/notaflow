import { api, type InvoiceDetail } from '../api';
import { EnvironmentBadge } from '../components/EnvironmentBadge';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { formatCents, formatCompetence, formatDate } from '../format';
import { routeHref } from '../router';
import { Alert, Badge, Card, Link, SECTION_TITLE_CLASSES, Spinner } from '../ui';
import { STATUS_TEXT, STATUS_VARIANT } from './InvoicesPage';

const EVENT_TEXT: Record<string, string> = {
  '101101': 'Cancelamento',
  '105102': 'Cancelamento por substituição',
  '105104': 'Cancelamento deferido em análise fiscal',
  '305101': 'Cancelamento de ofício',
};

export function InvoiceDetailPage(props: { accountId: string; invoiceId: string }) {
  const { accountId, invoiceId } = props;
  const url = `/api/accounts/${encodeURIComponent(accountId)}/invoices/${encodeURIComponent(invoiceId)}`;
  const invoice = useAsync(() => api.get<InvoiceDetail>(url), [url]);
  if (invoice.error) {
    return (
      <Layout title="Nota" accountId={accountId}>
        <Alert variant="error">{errorText(invoice.error)}</Alert>
      </Layout>
    );
  }
  if (!invoice.data) {
    return (
      <Layout title="Nota" accountId={accountId}>
        <Spinner />
      </Layout>
    );
  }
  const data = invoice.data;
  return (
    <Layout title={`NFS-e ${data.number ?? ''}`} accountId={accountId}>
      <div className="flex flex-wrap items-center gap-3">
        <Link href={routeHref({ name: 'invoices', accountId })} variant="muted">
          Voltar para as notas
        </Link>
        <EnvironmentBadge environment={data.environment} />
      </div>
      <Card>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr] [&_dt]:text-sm [&_dt]:text-muted [&_dd]:text-fg [&_dd]:break-all">
          <dt>Situação</dt>
          <dd>
            <Badge variant={STATUS_VARIANT[data.status]}>{STATUS_TEXT[data.status]}</Badge>
          </dd>
          <dt>Chave de acesso</dt>
          <dd>{data.accessKey}</dd>
          <dt>Emitida em</dt>
          <dd>{formatDate(data.issuedAt)}</dd>
          <dt>Competência</dt>
          <dd>{formatCompetence(data.competence)}</dd>
          <dt>Tomador</dt>
          <dd>
            {data.customerName} {data.customerDocument && `(${data.customerDocument})`}
          </dd>
          <dt>Serviço</dt>
          <dd>
            {data.serviceCode}: {data.description}
          </dd>
          <dt>Valor do serviço</dt>
          <dd>{formatCents(data.serviceCents)}</dd>
          {data.issCents !== null && (
            <>
              <dt>ISS</dt>
              <dd>{formatCents(data.issCents)}</dd>
            </>
          )}
          <dt>Valor líquido</dt>
          <dd>{formatCents(data.netCents)}</dd>
        </dl>
      </Card>
      <p>
        <Link href={`${url}/xml`}>Baixar XML</Link>
      </p>
      {data.events.length > 0 && (
        <Card>
          <h2 className={SECTION_TITLE_CLASSES}>Eventos</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {data.events.map((event) => (
              <li key={`${event.code}-${event.registeredAt}`}>
                {EVENT_TEXT[event.code] ?? `Evento ${event.code}`} em{' '}
                {formatDate(event.registeredAt)}
                {event.justification && `: ${event.justification}`}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Layout>
  );
}
