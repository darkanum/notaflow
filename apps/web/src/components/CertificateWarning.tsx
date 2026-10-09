import type { Emitter } from '../api';
import { formatDate } from '../format';
import { Alert } from '../ui';

export function CertificateWarning({ certificate }: { certificate: Emitter['certificate'] }) {
  if (!certificate) return <Alert variant="warning">Emitente sem certificado ativo.</Alert>;
  if (!certificate.expiresSoon) return null;
  return (
    <Alert variant="warning">
      O certificado vence em {formatDate(certificate.validTo)}. Envie um novo.
    </Alert>
  );
}
