# Certificate Vault

The vault stores each tenant's A1 certificate (`.pfx`) and its password, encrypted. Only the server decrypts them, in memory, to sign or to open the mTLS connection.

## Envelope encryption

- Each certificate has its own random 32-byte data key.
- The data key encrypts the `.pfx` and the password with AES-256-GCM. Each sealed value is `iv (12 bytes) | tag (16 bytes) | ciphertext`.
- `NFSE_MASTER_KEY` (32 bytes, base64) encrypts the data key the same way. The database stores only the wrapped data key.
- A wrong key and a tampered value both raise `VaultError`. The vault never returns partial bytes.

Code: `apps/server/src/vault/envelope.ts` and `VaultCertificateStore.ts`.

## Key rotation

A master key rotation re-wraps each data key with `rewrapKey(wrappedKey, oldKey, newKey)`. The `.pfx` and password ciphertexts do not change.

## Losing the master key

Stored certificates become unreadable. The owners upload their `.pfx` again. Invoices are not lost, because the ADN keeps them.

## Rules

- A certificate, its password, and the master key never go to disk in clear text and never go to a log.
- Onboarding runs the connection test before it stores anything, so a failed test leaves no emitter and no certificate.
- An emitter has one active certificate. A replacement keeps the old row, inactive, as history.
- The UI warns 30 days before the active certificate expires (`expiresSoon` in `GET /api/accounts/:accountId/emitters`).
