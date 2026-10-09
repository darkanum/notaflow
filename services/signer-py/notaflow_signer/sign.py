from cryptography import x509
from cryptography.hazmat.primitives.serialization import pkcs12
from lxml import etree
from signxml import DigestAlgorithm, SignatureMethod, XMLSigner, XMLVerifier, methods
from signxml.exceptions import InvalidSignature
from signxml.verifier import SignatureConfiguration

PROFILES = {
    "rsa-sha1-c14n": (
        SignatureMethod.RSA_SHA1,
        DigestAlgorithm.SHA1,
        "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    ),
    "rsa-sha256-exc-c14n": (
        SignatureMethod.RSA_SHA256,
        DigestAlgorithm.SHA256,
        "http://www.w3.org/2001/10/xml-exc-c14n#",
    ),
}


class _NfseSigner(XMLSigner):
    # The national NFS-e accepts RSA-SHA1; signxml blocks SHA1 unless a subclass allows it.
    def check_deprecated_methods(self) -> None:
        pass


def sign_xml(xml: bytes, pfx: bytes, password: str, element_id: str, profile: str) -> bytes:
    signature_method, digest, c14n = PROFILES[profile]
    key, cert, _ = pkcs12.load_key_and_certificates(pfx, password.encode())
    if key is None or cert is None:
        raise ValueError("The certificate file has no key or no certificate.")
    root = etree.fromstring(xml)
    signer = _NfseSigner(
        method=methods.enveloped,
        signature_algorithm=signature_method,
        digest_algorithm=digest,
        c14n_algorithm=c14n,
    )
    # signxml appends the Signature as the last child of the root, as the XSD requires.
    signed = signer.sign(root, key=key, cert=[cert], reference_uri=f"#{element_id}")
    return etree.tostring(signed, encoding="UTF-8")


def verify_xml(xml: bytes, certificate_pem: bytes) -> bool:
    cert = x509.load_pem_x509_certificate(certificate_pem)
    config = SignatureConfiguration(
        signature_methods=frozenset(SignatureMethod),
        digest_algorithms=frozenset(DigestAlgorithm),
        require_x509=False,
    )
    try:
        XMLVerifier().verify(xml, x509_cert=cert, expect_config=config)
        return True
    except InvalidSignature:
        return False
