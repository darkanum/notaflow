import { expect, test } from 'vitest';
import { readFixture } from '../../test/fixtures';
import { NfseParseError } from '../xml/readXml';
import { parseEventXml } from './parseEventXml';

test('reads a cancellation event', () => {
  const xml = readFixture('EVENT_CANCEL.xml');
  expect(parseEventXml(xml)).toEqual({
    accessKey: '35503082212345678000195000000000004226100000000420',
    code: '101101',
    registeredAt: new Date('2026-10-03T21:28:43Z'),
    reasonCode: '1',
    justification: 'Erro no valor do serviço',
    xml,
  });
});

test('reads an event type it does not know, without a reason', () => {
  const xml = readFixture('EVENT_CANCEL.xml').replace(
    /<e101101>.*<\/e101101>/,
    '<e105102><xDesc>Outro</xDesc></e105102>',
  );
  const event = parseEventXml(xml);
  expect(event.code).toBe('105102');
  expect(event.reasonCode).toBeUndefined();
});

test('throws NfseParseError for an event without a detail group', () => {
  const xml = readFixture('EVENT_CANCEL.xml').replace(/<e101101>.*<\/e101101>/, '');
  expect(() => parseEventXml(xml)).toThrow(NfseParseError);
});
