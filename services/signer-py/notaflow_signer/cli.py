import base64
import json
import sys

from notaflow_signer.sign import sign_xml, verify_xml


def main() -> int:
    command = sys.argv[1]
    # Read and write UTF-8 bytes: on Windows the text streams default to cp1252 and break accents.
    payload = json.load(sys.stdin.buffer)
    out = sys.stdout.buffer
    if command == "sign":
        signed = sign_xml(
            payload["xml"].encode(),
            base64.b64decode(payload["pfx_b64"]),
            payload["password"],
            payload["element_id"],
            payload["profile"],
        )
        out.write(json.dumps({"xml": signed.decode()}).encode())
        return 0
    if command == "verify":
        valid = verify_xml(payload["xml"].encode(), payload["certificate_pem"].encode())
        out.write(json.dumps({"valid": valid}).encode())
        return 0
    print(f"Unknown command: {command}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
