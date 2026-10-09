import { type FormEvent, useState } from 'react';
import { fileToBase64 } from '../format';

type Simples = '1' | '2' | '3';

export interface OnboardBody {
  pfxBase64: string;
  password: string;
  municipality: string;
  municipalRegistration?: string;
  simplesNacional: Simples;
  simplesRegime?: Simples;
  specialRegime: string;
  dpsSeries: string;
}

export function OnboardingForm({ onSubmit }: { onSubmit: (body: OnboardBody) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [municipalRegistration, setMunicipalRegistration] = useState('');
  const [simplesNacional, setSimplesNacional] = useState<Simples>('1');
  const [simplesRegime, setSimplesRegime] = useState<Simples>('1');
  const [specialRegime, setSpecialRegime] = useState('0');
  const [dpsSeries, setDpsSeries] = useState('900');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      await onSubmit({
        pfxBase64: await fileToBase64(file),
        password,
        municipality,
        ...(municipalRegistration ? { municipalRegistration } : {}),
        simplesNacional,
        ...(simplesNacional === '3' ? { simplesRegime } : {}),
        specialRegime,
        dpsSeries,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <h2>Cadastrar emitente</h2>
      <label>
        Certificado A1 (.pfx)
        <input
          type="file"
          accept=".pfx,.p12"
          required
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <label>
        Senha do certificado
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label>
        Município (código IBGE)
        <input
          value={municipality}
          required
          pattern="[0-9]{7}"
          onChange={(e) => setMunicipality(e.target.value)}
        />
      </label>
      <label>
        Inscrição municipal (opcional)
        <input
          value={municipalRegistration}
          onChange={(e) => setMunicipalRegistration(e.target.value)}
        />
      </label>
      <label>
        Simples Nacional
        <select
          value={simplesNacional}
          onChange={(e) => setSimplesNacional(e.target.value as Simples)}
        >
          <option value="1">1 - Não optante</option>
          <option value="2">2 - MEI</option>
          <option value="3">3 - ME/EPP</option>
        </select>
      </label>
      {simplesNacional === '3' && (
        <label>
          Regime de apuração (Simples)
          <select
            value={simplesRegime}
            onChange={(e) => setSimplesRegime(e.target.value as Simples)}
          >
            <option value="1">1 - Tributos federais e municipal pelo Simples</option>
            <option value="2">2 - Federais pelo Simples, ISSQN fora</option>
            <option value="3">3 - Federais e ISSQN fora do Simples</option>
          </select>
        </label>
      )}
      <label>
        Regime especial
        <select value={specialRegime} onChange={(e) => setSpecialRegime(e.target.value)}>
          <option value="0">0 - Nenhum</option>
          <option value="1">1 - Ato cooperado</option>
          <option value="2">2 - Estimativa</option>
          <option value="3">3 - Microempresa municipal</option>
          <option value="4">4 - Notário ou registrador</option>
          <option value="5">5 - Profissional autônomo</option>
          <option value="6">6 - Sociedade de profissionais</option>
          <option value="9">9 - Outros</option>
        </select>
      </label>
      <label>
        Série da DPS
        <input
          value={dpsSeries}
          required
          pattern="[0-9]{1,5}"
          onChange={(e) => setDpsSeries(e.target.value)}
        />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? 'Testando conexão...' : 'Cadastrar'}
      </button>
    </form>
  );
}
