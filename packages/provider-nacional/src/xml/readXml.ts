import { DOMParser, type Element } from '@xmldom/xmldom';
import { NFSE_NAMESPACE } from '../dps/buildDpsXml';

export class NfseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NfseParseError';
  }
}

export function parseXmlRoot(xml: string, rootName: string): Element {
  let root: Element | null;
  try {
    const parser = new DOMParser({
      onError: (level, message) => {
        if (level !== 'warning') throw new Error(message);
      },
    });
    root = parser.parseFromString(xml, 'text/xml').documentElement;
  } catch (error) {
    throw new NfseParseError(
      `Invalid XML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!root || root.localName !== rootName || root.namespaceURI !== NFSE_NAMESPACE) {
    throw new NfseParseError(`Expected <${rootName}> in the NFS-e namespace.`);
  }
  return root;
}

// Direct children only: names such as CNPJ and valores repeat at several depths.
export function childElements(parent: Element): Element[] {
  const result: Element[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    const element = node as Element;
    if (node.nodeType === 1 && element.namespaceURI === NFSE_NAMESPACE) result.push(element);
  }
  return result;
}

export function child(parent: Element, name: string): Element | undefined {
  return childElements(parent).find((element) => element.localName === name);
}

function path(parent: Element, names: string[]): Element | undefined {
  let current: Element | undefined = parent;
  for (const name of names) current = current ? child(current, name) : undefined;
  return current;
}

export function requiredChild(parent: Element, ...names: string[]): Element {
  const element = path(parent, names);
  if (!element) throw new NfseParseError(`Missing ${names.join('/')}.`);
  return element;
}

export function text(parent: Element, ...names: string[]): string | undefined {
  const value = path(parent, names)?.textContent ?? undefined;
  return value === '' ? undefined : value;
}

export function requiredText(parent: Element, ...names: string[]): string {
  const value = text(parent, ...names);
  if (value === undefined) throw new NfseParseError(`Missing ${names.join('/')}.`);
  return value;
}
