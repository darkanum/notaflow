import { useState } from 'react';
import { api, type Customer } from '../api';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { routeHref } from '../router';
import {
  Alert,
  Badge,
  Card,
  Field,
  Input,
  Link,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
} from '../ui';

export function CustomersPage({ accountId }: { accountId: string }) {
  const base = `/api/accounts/${encodeURIComponent(accountId)}/customers`;
  const [q, setQ] = useState('');
  const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  const customers = useAsync(() => api.get<Customer[]>(`${base}${query}`), [base, query]);

  return (
    <Layout title="Clientes" accountId={accountId}>
      <Card>
        <Field label="Pesquisar">
          <Input placeholder="Nome ou documento" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
      </Card>
      {customers.error && <Alert variant="error">{errorText(customers.error)}</Alert>}
      {!customers.data && !customers.error && <Spinner />}
      {customers.data && (
        <Table>
          <THead>
            <tr>
              <TH>Nome</TH>
              <TH>Documento</TH>
              <TH>E-mail</TH>
              <TH>Origem</TH>
            </tr>
          </THead>
          <TBody>
            {customers.data.map((customer) => (
              <tr key={customer.id}>
                <TD>
                  <Link href={routeHref({ name: 'customer', accountId, customerId: customer.id })}>
                    {customer.name}
                  </Link>
                </TD>
                <TD>{customer.document ?? 'sem documento'}</TD>
                <TD>{customer.email}</TD>
                <TD>
                  <Badge variant={customer.origin === 'manual' ? 'info' : 'neutral'}>
                    {customer.origin === 'manual' ? 'manual' : 'importado'}
                  </Badge>
                </TD>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
    </Layout>
  );
}
