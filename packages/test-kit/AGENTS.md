# Test Kit: AI Context

Test-only helpers. `makeTestCertificate` builds a self-signed e-CNPJ-like `.pfx` (3DES) with `NAME:CNPJ` in the CN, the ICP-Brasil e-CNPJ convention.

## Key Rules

1. Never import this package from runtime code. It is a `devDependency` only.
