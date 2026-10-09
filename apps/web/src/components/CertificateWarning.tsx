import type { Emitter } from '../api';
import { formatDate } from '../format';

export function CertificateWarning({ certificate }: { certificate: Emitter['certificate'] }) {
  if (!certificate) return <p className="warning">Emitente sem certificado ativo.</p>;
  if (!certificate.expiresSoon) return null;
  return (
    <p className="warning">
      O certificado vence em {formatDate(certificate.validTo)}. Envie um novo.
    </p>
  );
}
