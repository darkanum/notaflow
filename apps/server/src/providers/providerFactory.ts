import type {
  CertificateMaterial,
  Environment,
  InvoiceIssuer,
  InvoiceProvider,
} from '@notaflow/core';
import {
  createMtlsDispatcher,
  NacionalClient,
  NacionalIssuer,
  NacionalProvider,
} from '@notaflow/provider-nacional';

export type ProviderFactory = (input: {
  environment: Environment;
  certificate: CertificateMaterial;
}) => InvoiceProvider;

export type IssuerFactory = (input: {
  environment: Environment;
  certificate: CertificateMaterial;
}) => InvoiceIssuer;

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

export function nacionalIssuerFactory(urls?: { sefin: string; adn: string }): IssuerFactory {
  return ({ environment, certificate }) =>
    new NacionalIssuer({
      client: new NacionalClient({
        environment,
        dispatcher: createMtlsDispatcher(certificate),
        ...(urls ? { urls } : {}),
      }),
      certificate,
      environment,
      appVersion: 'notaflow-1b',
    });
}
