import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV = 12;
const TAG = 16;

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

export interface SealedCertificate {
  pfxCiphertext: Buffer;
  passwordCiphertext: Buffer;
  wrappedKey: Buffer;
}

export function seal(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function open(sealed: Buffer, key: Buffer): Buffer {
  if (sealed.length < IV + TAG) throw new VaultError('Sealed data is too short.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, IV));
    decipher.setAuthTag(sealed.subarray(IV, IV + TAG));
    return Buffer.concat([decipher.update(sealed.subarray(IV + TAG)), decipher.final()]);
  } catch {
    // Never say which part failed: the key and a tampered blob look the same to a caller.
    throw new VaultError('Sealed data cannot be opened with this key.');
  }
}

export function sealCertificate(
  pfx: Buffer,
  password: string,
  masterKey: Buffer,
): SealedCertificate {
  const dataKey = randomBytes(32);
  return {
    pfxCiphertext: seal(pfx, dataKey),
    passwordCiphertext: seal(Buffer.from(password, 'utf8'), dataKey),
    wrappedKey: seal(dataKey, masterKey),
  };
}

export function openCertificate(
  sealed: SealedCertificate,
  masterKey: Buffer,
): { pfx: Buffer; password: string } {
  const dataKey = open(sealed.wrappedKey, masterKey);
  return {
    pfx: open(sealed.pfxCiphertext, dataKey),
    password: open(sealed.passwordCiphertext, dataKey).toString('utf8'),
  };
}

export function rewrapKey(wrappedKey: Buffer, oldMasterKey: Buffer, newMasterKey: Buffer): Buffer {
  return seal(open(wrappedKey, oldMasterKey), newMasterKey);
}
