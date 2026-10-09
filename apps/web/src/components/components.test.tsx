// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { CertificateWarning } from './CertificateWarning';
import { EnvironmentBadge } from './EnvironmentBadge';

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
    <CertificateWarning certificate={{ validTo: '2026-10-20T00:00:00Z', expiresSoon: true }} />,
  );
  expect(screen.getByText(/vence em 20\/10\/2026/)).toBeTruthy();
  render(<CertificateWarning certificate={null} />);
  expect(screen.getByText(/sem certificado/i)).toBeTruthy();
});
