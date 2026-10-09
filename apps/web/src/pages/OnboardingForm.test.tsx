// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { type OnboardBody, OnboardingForm } from './OnboardingForm';

afterEach(() => cleanup());

// jsdom does not see a file set by user-event on a required input, so a click would be blocked
// by form validation; submitting the form directly runs the same handler.
function submit() {
  const form = screen.getByRole('button', { name: /cadastrar/i }).closest('form');
  if (!form) throw new Error('no form');
  fireEvent.submit(form);
}

test('sends the .pfx in base64 with the fiscal fields, and the Simples regime only for ME/EPP', async () => {
  const onSubmit = vi.fn(async (_body: OnboardBody) => {});
  render(<OnboardingForm onSubmit={onSubmit} />);
  const user = userEvent.setup();
  await user.upload(
    screen.getByLabelText(/certificado a1/i),
    new File([new Uint8Array([1, 2, 3])], 'empresa.pfx'),
  );
  await user.type(screen.getByLabelText(/senha/i), 'segredo');
  await user.type(screen.getByLabelText(/município/i), '4113700');
  await user.selectOptions(screen.getByLabelText(/simples nacional/i), '3');
  await user.selectOptions(screen.getByLabelText(/regime de apuração/i), '1');
  submit();
  // The form reads the file with FileReader, so onSubmit runs a moment after the click.
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit).toHaveBeenCalledWith({
    pfxBase64: Buffer.from([1, 2, 3]).toString('base64'),
    password: 'segredo',
    municipality: '4113700',
    simplesNacional: '3',
    simplesRegime: '1',
    specialRegime: '0',
    dpsSeries: '900',
  });
});

test('leaves out the Simples regime when the emitter is not ME/EPP', async () => {
  const onSubmit = vi.fn(async (_body: OnboardBody) => {});
  render(<OnboardingForm onSubmit={onSubmit} />);
  const user = userEvent.setup();
  await user.upload(
    screen.getByLabelText(/certificado a1/i),
    new File([new Uint8Array([9])], 'x.pfx'),
  );
  await user.type(screen.getByLabelText(/município/i), '3550308');
  submit();
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('simplesRegime');
});
