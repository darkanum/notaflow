import { api, type InvoiceDetail } from '../api';
import { EnvironmentBadge } from '../components/EnvironmentBadge';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { formatCents, formatCompetence, formatDate } from '../format';
import { routeHref } from '../router';
import { STATUS_TEXT } from './InvoicesPage';

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
      <Layout title="Nota">
        <p className="error">{errorText(invoice.error)}</p>
      </Layout>
    );
  }
  if (!invoice.data) {
    return (
      <Layout title="Nota">
        <p>Carregando...</p>
      </Layout>
    );
  }
  const data = invoice.data;
  return (
    <Layout title={`NFS-e ${data.number ?? ''}`}>
      <p>
        <a href={routeHref({ name: 'invoices', accountId })}>Voltar para as notas</a>
      </p>
      <EnvironmentBadge environment={data.environment} />
      <dl className="card">
        <dt>Situação</dt>
        <dd className={`status-${data.status}`}>{STATUS_TEXT[data.status]}</dd>
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
      <p>
        <a href={`${url}/xml`}>Baixar XML</a>
      </p>
      {data.events.length > 0 && (
        <section className="card">
          <h2>Eventos</h2>
          <ul>
            {data.events.map((event) => (
              <li key={`${event.code}-${event.registeredAt}`}>
                {EVENT_TEXT[event.code] ?? `Evento ${event.code}`} em{' '}
                {formatDate(event.registeredAt)}
                {event.justification && `: ${event.justification}`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Layout>
  );
}
