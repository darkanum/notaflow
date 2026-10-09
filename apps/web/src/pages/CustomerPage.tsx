import { type FormEvent, useState } from 'react';
import { api, type Customer, type PartyAddress } from '../api';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { routeHref } from '../router';
import {
  Alert,
  Button,
  CARD_CLASSES,
  Field,
  FORM_CLASSES,
  Input,
  Link,
  SECTION_TITLE_CLASSES,
  Select,
  Spinner,
} from '../ui';

type Text = 'name' | 'email' | 'phone' | 'municipalRegistration';
const ADDRESS_FIELDS = [
  'municipality',
  'zip',
  'country',
  'postalCode',
  'city',
  'region',
  'street',
  'number',
  'complement',
  'district',
] as const;
type AddressField = (typeof ADDRESS_FIELDS)[number];
const REQUIRED: Record<PartyAddress['kind'], AddressField[]> = {
  domestic: ['municipality', 'zip', 'street', 'number', 'district'],
  foreign: ['country', 'postalCode', 'city', 'region', 'street', 'number', 'district'],
};

export function CustomerPage(props: { accountId: string; customerId: string }) {
  const url = `/api/accounts/${encodeURIComponent(props.accountId)}/customers/${encodeURIComponent(props.customerId)}`;
  const customer = useAsync(() => api.get<Customer>(url), [url]);
  return (
    <Layout title={customer.data?.name ?? 'Cliente'} accountId={props.accountId}>
      <Link href={routeHref({ name: 'customers', accountId: props.accountId })} variant="muted">
        Voltar para os clientes
      </Link>
      {customer.error && <Alert variant="error">{errorText(customer.error)}</Alert>}
      {!customer.data && !customer.error && <Spinner />}
      {customer.data && <CustomerForm url={url} customer={customer.data} />}
    </Layout>
  );
}

function CustomerForm({ url, customer }: { url: string; customer: Customer }) {
  const [text, setText] = useState<Record<Text, string>>({
    name: customer.name,
    email: customer.email ?? '',
    phone: customer.phone ?? '',
    municipalRegistration: customer.municipalRegistration ?? '',
  });
  const original = customer.address;
  const [kind, setKind] = useState<PartyAddress['kind']>(original?.kind ?? 'domestic');
  const [address, setAddress] = useState<Record<AddressField, string>>(
    Object.fromEntries(ADDRESS_FIELDS.map((f) => [f, original?.[f] ?? ''])) as Record<
      AddressField,
      string
    >,
  );
  const [message, setMessage] = useState<{ variant: 'info' | 'error'; text: string } | null>(null);

  function changes(): Record<string, unknown> | null {
    const body: Record<string, unknown> = {};
    for (const field of ['name', 'email', 'phone', 'municipalRegistration'] as const) {
      const value = text[field].trim();
      if (value && value !== ((customer[field] as string | null) ?? '')) body[field] = value;
    }
    const filled = ADDRESS_FIELDS.filter((f) => address[f].trim() !== '');
    const touched = ADDRESS_FIELDS.some((f) => address[f].trim() !== (original?.[f] ?? ''));
    if (filled.length > 0 && (touched || kind !== original?.kind)) {
      if (REQUIRED[kind].some((f) => address[f].trim() === '')) return null;
      const fields = [...REQUIRED[kind], 'complement' as const];
      body.address = Object.fromEntries([
        ['kind', kind],
        ...fields.filter((f) => address[f].trim() !== '').map((f) => [f, address[f].trim()]),
      ]);
    }
    return body;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const body = changes();
    if (body === null) {
      setMessage({ variant: 'error', text: 'Endereço incompleto.' });
      return;
    }
    if (Object.keys(body).length === 0) {
      setMessage({ variant: 'info', text: 'Nada mudou.' });
      return;
    }
    try {
      await api.put(url, body);
      setMessage({
        variant: 'info',
        text: 'Dados salvos. O sync não sobrescreve campos editados à mão.',
      });
    } catch (error) {
      setMessage({ variant: 'error', text: errorText(error) });
    }
  }

  const textField = (field: Text, label: string, type = 'text') => (
    <Field label={label}>
      <Input
        type={type}
        value={text[field]}
        onChange={(e) => setText((t) => ({ ...t, [field]: e.target.value }))}
      />
    </Field>
  );
  const addressField = (field: AddressField, label: string) => (
    <Field label={label}>
      <Input
        value={address[field]}
        onChange={(e) => setAddress((a) => ({ ...a, [field]: e.target.value }))}
      />
    </Field>
  );

  return (
    <form onSubmit={save} className={`${CARD_CLASSES} ${FORM_CLASSES}`}>
      <p className="text-sm text-muted">
        {customer.documentType} {customer.document ?? ''}
      </p>
      {textField('name', 'Nome')}
      {textField('email', 'E-mail', 'email')}
      {textField('phone', 'Telefone')}
      {textField('municipalRegistration', 'Inscrição municipal')}
      <h2 className={SECTION_TITLE_CLASSES}>Endereço</h2>
      <Field label="País">
        <Select value={kind} onChange={(e) => setKind(e.target.value as PartyAddress['kind'])}>
          <option value="domestic">Brasil</option>
          <option value="foreign">Exterior</option>
        </Select>
      </Field>
      {kind === 'domestic' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {addressField('municipality', 'Município (código IBGE)')}
          {addressField('zip', 'CEP')}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {addressField('country', 'País (código ISO, ex.: US)')}
          {addressField('postalCode', 'Código postal')}
          {addressField('city', 'Cidade')}
          {addressField('region', 'Estado ou região')}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {addressField('street', 'Logradouro')}
        {addressField('number', 'Número')}
        {addressField('complement', 'Complemento')}
        {addressField('district', 'Bairro')}
      </div>
      {message && <Alert variant={message.variant}>{message.text}</Alert>}
      <div>
        <Button type="submit" variant="primary">
          Salvar
        </Button>
      </div>
    </form>
  );
}
