import type { Element } from '@xmldom/xmldom';
import type { InvoiceParty, PartyAddress, PartyDocument, ProviderInvoice } from '@notaflow/core';
import { decimalToCents } from '../xml/formatters';
import {
  child,
  NfseParseError,
  parseXmlRoot,
  requiredChild,
  requiredText,
  text,
} from '../xml/readXml';

export function parseNfseXml(xml: string): ProviderInvoice {
  const info = requiredChild(parseXmlRoot(xml, 'NFSe'), 'infNFSe');
  const dps = requiredChild(info, 'DPS', 'infDPS');
  const accessKey = (info.getAttribute('Id') ?? '').replace(/^NFS/, '');
  if (!/^[0-9A-Z]{50}$/.test(accessKey)) throw new NfseParseError('Invalid infNFSe/@Id.');
  const iss = text(info, 'valores', 'vISSQN');
  const nbsCode = text(dps, 'serv', 'cServ', 'cNBS');
  const toma = child(dps, 'toma');

  return {
    accessKey,
    number: requiredText(info, 'nNFSe'),
    environment: requiredText(dps, 'tpAmb') === '1' ? 'producao' : 'producao_restrita',
    issuedAt: new Date(requiredText(info, 'dhProc')),
    competence: requiredText(dps, 'dCompet'),
    dps: {
      id: dps.getAttribute('Id') ?? '',
      series: requiredText(dps, 'serie'),
      number: Number(requiredText(dps, 'nDPS')),
    },
    provider: {
      cnpj: requiredText(info, 'emit', 'CNPJ'),
      name: requiredText(info, 'emit', 'xNome'),
    },
    customer: toma ? party(toma) : null,
    service: {
      nationalTaxCode: requiredText(dps, 'serv', 'cServ', 'cTribNac'),
      description: requiredText(dps, 'serv', 'cServ', 'xDescServ'),
      ...(nbsCode ? { nbsCode } : {}),
    },
    amounts: {
      serviceCents: cents(requiredText(dps, 'valores', 'vServPrest', 'vServ')),
      ...(iss ? { issCents: cents(iss) } : {}),
      netCents: cents(requiredText(info, 'valores', 'vLiq')),
    },
    xml,
  };
}

function cents(value: string): number {
  try {
    return decimalToCents(value);
  } catch {
    throw new NfseParseError(`Invalid amount: ${value}`);
  }
}

function party(toma: Element): InvoiceParty {
  const municipalRegistration = text(toma, 'IM');
  const end = child(toma, 'end');
  const email = text(toma, 'email');
  const phone = text(toma, 'fone');
  return {
    document: document(toma),
    name: requiredText(toma, 'xNome'),
    ...(municipalRegistration ? { municipalRegistration } : {}),
    ...(end ? { address: address(end) } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
  };
}

function document(toma: Element): PartyDocument | null {
  for (const type of ['CNPJ', 'CPF', 'NIF'] as const) {
    const value = text(toma, type);
    if (value) return { type, value };
  }
  return null;
}

function address(end: Element): PartyAddress {
  const complement = text(end, 'xCpl');
  const common = {
    street: requiredText(end, 'xLgr'),
    number: requiredText(end, 'nro'),
    ...(complement ? { complement } : {}),
    district: requiredText(end, 'xBairro'),
  };
  if (child(end, 'endExt')) {
    return {
      kind: 'foreign',
      country: requiredText(end, 'endExt', 'cPais'),
      postalCode: requiredText(end, 'endExt', 'cEndPost'),
      city: requiredText(end, 'endExt', 'xCidade'),
      region: requiredText(end, 'endExt', 'xEstProvReg'),
      ...common,
    };
  }
  return {
    kind: 'domestic',
    municipality: requiredText(end, 'endNac', 'cMun'),
    zip: requiredText(end, 'endNac', 'CEP'),
    ...common,
  };
}
