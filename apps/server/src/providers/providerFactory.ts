import type { CertificateMaterial, Environment, InvoiceProvider } from '@notaflow/core';
import {
  createMtlsDispatcher,
  NacionalClient,
  NacionalProvider,
} from '@notaflow/provider-nacional';

export type ProviderFactory = (input: {
  environment: Environment;
  certificate: CertificateMaterial;
}) => InvoiceProvider;

export function nacionalProviderFactory(urls?: { sefin: string; adn: string }): ProviderFactory {
  return ({ environment, certificate }) =>
    new NacionalProvider(
      new NacionalClient({
        environment,
        dispatcher: createMtlsDispatcher(certificate),
        ...(urls ? { urls } : {}),
      }),
      certificate.cnpj,
    );
}
