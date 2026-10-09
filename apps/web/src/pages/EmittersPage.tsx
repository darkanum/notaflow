import { useState } from 'react';
import { api, type Emitter, type Me, type SyncResult, type SyncState } from '../api';
import { CertificateWarning } from '../components/CertificateWarning';
import { EnvironmentBadge } from '../components/EnvironmentBadge';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { fileToBase64, formatDate } from '../format';
import { OnboardingForm } from './OnboardingForm';

type Act = (action: () => Promise<string>) => Promise<void>;

export function EmittersPage({ accountId }: { accountId: string }) {
  const base = `/api/accounts/${encodeURIComponent(accountId)}`;
  const me = useAsync(() => api.get<Me>('/api/me'), []);
  const emitters = useAsync(() => api.get<Emitter[]>(`${base}/emitters`), [base]);
  const [message, setMessage] = useState<string | null>(null);
  const isOwner = me.data?.accounts.find((a) => a.id === accountId)?.role === 'owner';

  const act: Act = async (action) => {
    setMessage(null);
    try {
      setMessage(await action());
      emitters.reload();
    } catch (error) {
      setMessage(errorText(error));
    }
  };

  return (
    <Layout title="Emitentes">
      {message && <p className="message">{message}</p>}
      {emitters.error && <p className="error">{errorText(emitters.error)}</p>}
      {emitters.data?.map((emitter) => (
        <EmitterCard key={emitter.id} base={base} emitter={emitter} isOwner={isOwner} act={act} />
      ))}
      {isOwner && (
        <OnboardingForm
          onSubmit={(body) =>
            act(async () => {
              await api.post(`${base}/emitters`, body);
              return 'Emitente cadastrado em produção restrita. A primeira sincronização começou.';
            })
          }
        />
      )}
    </Layout>
  );
}

function EmitterCard(props: { base: string; emitter: Emitter; isOwner: boolean; act: Act }) {
  const { base, emitter, isOwner, act } = props;
  const url = `${base}/emitters/${encodeURIComponent(emitter.id)}`;
  const sync = useAsync(() => api.get<SyncState>(`${url}/sync`), [url]);

  async function replaceCertificate(file: File) {
    const password = window.prompt('Senha do novo certificado') ?? '';
    await act(async () => {
      await api.post(`${url}/certificate`, { pfxBase64: await fileToBase64(file), password });
      return 'Certificado trocado.';
    });
  }

  function switchEnvironment() {
    const target = emitter.environment === 'producao' ? 'producao_restrita' : 'producao';
    const confirm =
      target === 'producao'
        ? (window.prompt('Para emitir notas reais, digite producao') ?? '')
        : 'producao_restrita';
    if (!confirm) return;
    void act(async () => {
      await api.post(`${url}/environment`, { environment: target, confirm });
      return target === 'producao'
        ? 'Ambiente trocado para PRODUÇÃO.'
        : 'Ambiente trocado para produção restrita.';
    });
  }

  function syncNow() {
    void act(async () => {
      const result = await api.post<SyncResult>(`${url}/sync`, {});
      sync.reload();
      return result.error
        ? `Sincronização parou: ${result.error}`
        : `${result.invoices} notas e ${result.events} eventos sincronizados.`;
    });
  }

  return (
    <section className="card">
      <h2>
        {emitter.companyName} <small>{emitter.cnpj}</small>
      </h2>
      <EnvironmentBadge environment={emitter.environment} />
      <CertificateWarning certificate={emitter.certificate} />
      {sync.data && (
        <p>
          Última sincronização: {formatDate(sync.data.lastSuccessAt) || 'nunca'}
          {sync.data.lastError && <span className="error"> (erro: {sync.data.lastError})</span>}
        </p>
      )}
      <div className="actions">
        <button onClick={syncNow}>Sincronizar agora</button>
        {isOwner && (
          <>
            <label className="button">
              Trocar certificado
              <input
                type="file"
                accept=".pfx,.p12"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void replaceCertificate(file);
                }}
              />
            </label>
            <button onClick={switchEnvironment}>
              {emitter.environment === 'producao'
                ? 'Voltar para produção restrita'
                : 'Passar para PRODUÇÃO'}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
