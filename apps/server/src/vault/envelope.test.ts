import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { open, openCertificate, rewrapKey, seal, sealCertificate, VaultError } from './envelope';

const master = randomBytes(32);

test('seal and open round-trip, with a new IV each time', () => {
  const data = Buffer.from('segredo ção');
  const a = seal(data, master);
  const b = seal(data, master);
  expect(a.equals(b)).toBe(false);
  expect(open(a, master).toString()).toBe('segredo ção');
});

test('open throws VaultError with the wrong key', () => {
  expect(() => open(seal(Buffer.from('x'), master), randomBytes(32))).toThrow(VaultError);
});

test('open throws VaultError on a tampered ciphertext', () => {
  const sealed = seal(Buffer.from('certificate bytes'), master);
  sealed.writeUInt8(sealed.readUInt8(sealed.length - 1) ^ 0x01, sealed.length - 1);
  expect(() => open(sealed, master)).toThrow(VaultError);
});

test('open throws VaultError on a blob too short to hold an IV and a tag', () => {
  expect(() => open(Buffer.alloc(10), master)).toThrow(VaultError);
});

test('sealCertificate uses a data key per certificate, wrapped by the master key', () => {
  const pfx = randomBytes(2000);
  const one = sealCertificate(pfx, 'senha-1', master);
  const two = sealCertificate(pfx, 'senha-1', master);
  expect(one.wrappedKey.equals(two.wrappedKey)).toBe(false);
  expect(one.pfxCiphertext.includes(pfx.subarray(0, 32))).toBe(false);
  expect(openCertificate(one, master)).toEqual({ pfx, password: 'senha-1' });
});

test('rewrapKey moves a certificate to a new master key without touching the ciphertexts', () => {
  const sealed = sealCertificate(Buffer.from('pfx'), 'senha', master);
  const next = randomBytes(32);
  const moved = { ...sealed, wrappedKey: rewrapKey(sealed.wrappedKey, master, next) };
  expect(openCertificate(moved, next)).toEqual({ pfx: Buffer.from('pfx'), password: 'senha' });
  expect(() => openCertificate(moved, master)).toThrow(VaultError);
});
