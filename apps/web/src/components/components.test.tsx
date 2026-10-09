// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { CertificateWarning } from './CertificateWarning';
import { EnvironmentBadge } from './EnvironmentBadge';
import { ERROR_TEXT, Layout } from './Layout';

afterEach(() => cleanup());

test('the environment badge says which environment, loudly', () => {
  render(<EnvironmentBadge environment="producao" />);
  expect(screen.getByText('PRODUÇÃO')).toBeTruthy();
  render(<EnvironmentBadge environment="producao_restrita" />);
  expect(screen.getByText(/PRODUÇÃO RESTRITA/)).toBeTruthy();
});

test('the certificate warning shows only when the certificate expires soon or is missing', () => {
  const { container } = render(
    <CertificateWarning certificate={{ validTo: '2030-01-01T00:00:00Z', expiresSoon: false }} />,
  );
  expect(container.textContent).toBe('');
  render(
    <CertificateWarning certificate={{ validTo: '2026-10-20T15:00:00Z', expiresSoon: true }} />,
  );
  expect(screen.getByText(/vence em 20\/10\/2026/)).toBeTruthy();
  render(<CertificateWarning certificate={null} />);
  expect(screen.getByText(/sem certificado/i)).toBeTruthy();
});

test('the layout shows the account links and marks the current page', () => {
  window.location.hash = '#/a/acc/invoices';
  render(
    <Layout title="Notas" accountId="acc">
      <p>conteúdo</p>
    </Layout>,
  );
  expect(screen.getByRole('link', { name: 'Notas' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('link', { name: 'Clientes' }).getAttribute('href')).toBe(
    '#/a/acc/customers',
  );
});

test('every error code the server can send has a text', () => {
  for (const code of [
    'template_unsupported',
    'sefin_rejected',
    'ptax_unavailable',
    'invalid_idempotency_key',
  ]) {
    expect(ERROR_TEXT[code]).toBeTruthy();
  }
});
