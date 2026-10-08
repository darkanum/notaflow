import { escapeXml } from '../xml/escapeXml';
import { centsToDecimal, formatBrasiliaDateTime } from '../xml/formatters';
import { buildDpsId } from './buildDpsId';
import type { Address, DpsInput } from './types';

export const NFSE_NAMESPACE = 'http://www.sped.fazenda.gov.br/nfse';
export const SCHEMA_VERSION = '1.01';

// Element order follows tiposComplexos_v1.01.xsd; the XSD test fails on any reorder.
export function buildDpsXml(input: DpsInput): { id: string; xml: string } {
  const id = buildDpsId({
    municipality: input.emitterMunicipality,
    cnpj: input.provider.cnpj,
    series: input.series,
    number: input.number,
  });

  const xml =
    `<DPS xmlns="${NFSE_NAMESPACE}" versao="${SCHEMA_VERSION}">` +
    `<infDPS Id="${id}">` +
    tag('tpAmb', input.environment === 'producao' ? '1' : '2') +
    tag('dhEmi', formatBrasiliaDateTime(input.issuedAt)) +
    tag('verAplic', input.appVersion) +
    tag('serie', input.series) +
    tag('nDPS', String(input.number)) +
    tag('dCompet', input.competence) +
    tag('tpEmit', '1') +
    tag('cLocEmi', input.emitterMunicipality) +
    provider(input) +
    customer(input) +
    service(input) +
    amounts(input) +
    `</infDPS></DPS>`;

  return { id, xml };
}

function tag(name: string, value: string | undefined): string {
  return value === undefined ? '' : `<${name}>${escapeXml(value)}</${name}>`;
}

function provider({ provider: p }: DpsInput): string {
  return (
    '<prest>' +
    tag('CNPJ', p.cnpj) +
    tag('IM', p.municipalRegistration) +
    tag('fone', p.phone) +
    tag('email', p.email) +
    '<regTrib>' +
    tag('opSimpNac', p.simplesNacional) +
    tag('regApTribSN', p.simplesRegime) +
    tag('regEspTrib', p.specialRegime) +
    '</regTrib></prest>'
  );
}

function customer({ customer: c }: DpsInput): string {
  if (!c) return '';
  return (
    '<toma>' +
    tag(c.document.type, c.document.value) +
    tag('IM', c.municipalRegistration) +
    tag('xNome', c.name) +
    (c.address ? address(c.address) : '') +
    tag('fone', c.phone) +
    tag('email', c.email) +
    '</toma>'
  );
}

function address(a: Address): string {
  return (
    '<end><endNac>' +
    tag('cMun', a.municipality) +
    tag('CEP', a.zip) +
    '</endNac>' +
    tag('xLgr', a.street) +
    tag('nro', a.number) +
    tag('xCpl', a.complement) +
    tag('xBairro', a.district) +
    '</end>'
  );
}

function service({ service: s }: DpsInput): string {
  return (
    '<serv><locPrest>' +
    tag('cLocPrestacao', s.municipality) +
    '</locPrest><cServ>' +
    tag('cTribNac', s.nationalTaxCode) +
    tag('cTribMun', s.municipalTaxCode) +
    tag('xDescServ', s.description) +
    tag('cNBS', s.nbsCode) +
    '</cServ></serv>'
  );
}

function amounts({ amounts: a, tax: t }: DpsInput): string {
  return (
    '<valores><vServPrest>' +
    tag('vServ', centsToDecimal(a.serviceCents)) +
    '</vServPrest><trib><tribMun>' +
    tag('tribISSQN', t.issqnTaxation) +
    tag('tpRetISSQN', t.issRetention) +
    tag('pAliq', t.issRatePercent) +
    '</tribMun><totTrib>' +
    tag('indTotTrib', '0') +
    '</totTrib></trib></valores>'
  );
}
