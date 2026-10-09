import { type FormEvent, useState } from 'react';
import { fileToBase64 } from '../format';
import {
  Button,
  CARD_CLASSES,
  Field,
  FORM_CLASSES,
  Input,
  SECTION_TITLE_CLASSES,
  Select,
} from '../ui';

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
    <form onSubmit={submit} className={`${CARD_CLASSES} ${FORM_CLASSES}`}>
      <h2 className={SECTION_TITLE_CLASSES}>Cadastrar emitente</h2>
      <Field label="Certificado A1 (.pfx)">
        <Input
          className="h-auto py-2"
          type="file"
          accept=".pfx,.p12"
          required
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </Field>
      <Field label="Senha do certificado">
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Município (código IBGE)">
        <Input
          value={municipality}
          required
          pattern="[0-9]{7}"
          onChange={(e) => setMunicipality(e.target.value)}
        />
      </Field>
      <Field label="Inscrição municipal (opcional)">
        <Input
          value={municipalRegistration}
          onChange={(e) => setMunicipalRegistration(e.target.value)}
        />
      </Field>
      <Field label="Simples Nacional">
        <Select
          value={simplesNacional}
          onChange={(e) => setSimplesNacional(e.target.value as Simples)}
        >
          <option value="1">1 - Não optante</option>
          <option value="2">2 - MEI</option>
          <option value="3">3 - ME/EPP</option>
        </Select>
      </Field>
      {simplesNacional === '3' && (
        <Field label="Regime de apuração (Simples)">
          <Select
            value={simplesRegime}
            onChange={(e) => setSimplesRegime(e.target.value as Simples)}
          >
            <option value="1">1 - Tributos federais e municipal pelo Simples</option>
            <option value="2">2 - Federais pelo Simples, ISSQN fora</option>
            <option value="3">3 - Federais e ISSQN fora do Simples</option>
          </Select>
        </Field>
      )}
      <Field label="Regime especial">
        <Select value={specialRegime} onChange={(e) => setSpecialRegime(e.target.value)}>
          <option value="0">0 - Nenhum</option>
          <option value="1">1 - Ato cooperado</option>
          <option value="2">2 - Estimativa</option>
          <option value="3">3 - Microempresa municipal</option>
          <option value="4">4 - Notário ou registrador</option>
          <option value="5">5 - Profissional autônomo</option>
          <option value="6">6 - Sociedade de profissionais</option>
          <option value="9">9 - Outros</option>
        </Select>
      </Field>
      <Field label="Série da DPS">
        <Input
          value={dpsSeries}
          required
          pattern="[0-9]{1,5}"
          onChange={(e) => setDpsSeries(e.target.value)}
        />
      </Field>
      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? 'Testando conexão...' : 'Cadastrar'}
      </Button>
    </form>
  );
}
