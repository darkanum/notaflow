import { useState } from 'react';
import { ApiError, api, type InvoiceDetail } from '../api';
import { EnvironmentBadge } from '../components/EnvironmentBadge';
import { errorText } from '../components/Layout';
import { formatCents } from '../format';
import { Alert, Button, Field, Modal, Select, Textarea } from '../ui';

const REASONS = [
  { value: '1', label: '1 - Erro na emissão' },
  { value: '2', label: '2 - Serviço não prestado' },
  { value: '9', label: '9 - Outros' },
] as const;

export function CancelDialog(props: {
  open: boolean;
  url: string;
  invoice: InvoiceDetail;
  onClose: () => void;
  onDone: (alreadyCancelled: boolean) => void;
}) {
  const { invoice } = props;
  const [reason, setReason] = useState<'1' | '2' | '9'>('1');
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const length = justification.trim().length;
  const production = invoice.environment === 'producao';

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const answer = await api.post<{ alreadyCancelled?: boolean }>(`${props.url}/cancel`, {
        reason,
        justification: justification.trim(),
      });
      props.onDone(answer.alreadyCancelled === true);
    } catch (failure) {
      // A Sefin refusal carries its own code and message, which say more than our text.
      if (failure instanceof ApiError && failure.code === 'sefin_rejected') {
        setError(`${String(failure.body.code)}: ${String(failure.body.message)}`);
      } else {
        setError(errorText(failure));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={props.open}
      title={`Cancelar NFS-e ${invoice.number ?? ''}`}
      onClose={props.onClose}
    >
      <div className="flex flex-col gap-4">
        <EnvironmentBadge environment={invoice.environment} />
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm [&_dt]:text-muted">
          <dt>Tomador</dt>
          <dd>{invoice.customerName}</dd>
          <dt>Valor</dt>
          <dd>{formatCents(invoice.serviceCents)}</dd>
        </dl>
        <Field label="Motivo">
          <Select value={reason} onChange={(e) => setReason(e.target.value as '1' | '2' | '9')}>
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Justificativa" hint={`${length}/255 (mínimo 15)`}>
          <Textarea
            maxLength={255}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
          />
        </Field>
        {error && <Alert variant="error">{error}</Alert>}
        <div className="flex flex-wrap gap-3">
          <Button
            variant="danger"
            disabled={busy || length < 15 || length > 255}
            onClick={() => void confirm()}
          >
            {production ? 'Cancelar em PRODUÇÃO' : 'Cancelar em produção restrita'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={props.onClose}>
            Voltar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
