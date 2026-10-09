import type { ProviderEvent } from '@notaflow/core';
import {
  childElements,
  NfseParseError,
  parseXmlRoot,
  requiredChild,
  requiredText,
  text,
} from '../xml/readXml';

export function parseEventXml(xml: string): ProviderEvent {
  const info = requiredChild(parseXmlRoot(xml, 'evento'), 'infEvento');
  const request = requiredChild(info, 'pedRegEvento', 'infPedReg');
  const detail = childElements(request).find((element) =>
    /^e[0-9]{6}$/.test(element.localName ?? ''),
  );
  if (!detail?.localName) throw new NfseParseError('Missing the event detail group (e######).');
  const reasonCode = text(detail, 'cMotivo');
  const justification = text(detail, 'xMotivo');
  return {
    accessKey: requiredText(request, 'chNFSe'),
    code: detail.localName.slice(1),
    registeredAt: new Date(requiredText(info, 'dhProc')),
    ...(reasonCode ? { reasonCode } : {}),
    ...(justification ? { justification } : {}),
    xml,
  };
}
