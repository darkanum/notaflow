import type { ReactNode } from 'react';
import { ApiError } from '../api';
import { routeHref } from '../router';

export const ERROR_TEXT: Record<string, string> = {
  access_not_granted: 'Seu e-mail ainda não tem acesso ao NotaFlow. Fale com o administrador.',
  account_suspended: 'Esta conta está suspensa. Você pode consultar, mas não alterar.',
  owner_only: 'Só o dono da conta pode fazer isso.',
  cnpj_in_other_account: 'Este CNPJ já pertence a outra conta.',
  emitter_exists: 'Este emitente já está cadastrado. Use "Trocar certificado".',
  connection_test_failed: 'O teste de conexão com o sistema nacional falhou. Tente de novo.',
  WRONG_PASSWORD: 'Senha do certificado incorreta.',
  EXPIRED: 'Este certificado está vencido.',
  NOT_YET_VALID: 'Este certificado ainda não é válido.',
  INVALID_FILE: 'O arquivo não é um certificado .pfx válido.',
  CNPJ_NOT_FOUND: 'O certificado não traz um CNPJ.',
  cnpj_mismatch: 'O certificado é de outro CNPJ.',
  confirmation_required: 'Confirmação incorreta. Digite producao para confirmar.',
  sync_running: 'Uma sincronização já está em andamento.',
  invalid_access_key: 'A chave de acesso deve ter 50 caracteres.',
  emitter_not_found: 'Esta chave não é de um emitente desta conta.',
  invoice_not_found: 'Nenhuma nota encontrada com esta chave.',
  no_active_certificate: 'O emitente não tem certificado ativo.',
  user_exists: 'Já existe um usuário com este e-mail.',
  already_member: 'Esta pessoa já é membro da conta.',
  not_found: 'Não encontrado.',
};

export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    return ERROR_TEXT[error.code] ?? `Erro inesperado (${error.code}).`;
  }
  return 'Erro inesperado. Tente de novo.';
}

export function Layout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="app">
      <header>
        <a href={routeHref({ name: 'home' })} className="brand">
          NotaFlow
        </a>
      </header>
      <main>
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  );
}
