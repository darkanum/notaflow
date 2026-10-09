import datetime

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

from notaflow_signer.sign import sign_xml, verify_xml

NS = "http://www.sped.fazenda.gov.br/nfse"
ELEMENT_ID = "DPS355030821234567800019500900000000000000001"
XML = (
    f'<DPS xmlns="{NS}" versao="1.01"><infDPS Id="{ELEMENT_ID}">'
    "<xDescServ>Consultoria em análise &amp; ção</xDescServ></infDPS></DPS>"
).encode()


@pytest.fixture(scope="module")
def certificate():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "EMPRESA TESTE LTDA:12345678000195")])
    now = datetime.datetime.now(datetime.UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(1)
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=365))
        .sign(key, hashes.SHA256())
    )
    pfx = pkcs12.serialize_key_and_certificates(
        b"test", key, cert, None, serialization.BestAvailableEncryption(b"test-password")
    )
    return pfx, cert.public_bytes(serialization.Encoding.PEM)


@pytest.mark.parametrize("profile", ["rsa-sha1-c14n", "rsa-sha256-exc-c14n"])
def test_signs_and_verifies(certificate, profile):
    pfx, cert_pem = certificate
    signed = sign_xml(XML, pfx, "test-password", ELEMENT_ID, profile)
    assert verify_xml(signed, cert_pem)


@pytest.mark.parametrize("profile", ["rsa-sha1-c14n", "rsa-sha256-exc-c14n"])
def test_signature_is_the_last_child_of_the_root(certificate, profile):
    pfx, _ = certificate
    signed = sign_xml(XML, pfx, "test-password", ELEMENT_ID, profile)
    assert signed.rstrip().endswith(b"</ds:Signature></DPS>") or signed.rstrip().endswith(b"</Signature></DPS>")


def test_tampered_document_fails(certificate):
    pfx, cert_pem = certificate
    signed = sign_xml(XML, pfx, "test-password", ELEMENT_ID, "rsa-sha1-c14n")
    assert not verify_xml(signed.replace(b"Consultoria", b"Consultorio"), cert_pem)
