"""Validate XML from stdin against an XSD. Exit 0 when valid; print one error per line otherwise."""
import sys

from lxml import etree


def main() -> int:
    schema = etree.XMLSchema(etree.parse(sys.argv[1]))
    document = etree.fromstring(sys.stdin.buffer.read())
    if schema.validate(document):
        return 0
    for error in schema.error_log:
        print(f"{error.line}: {error.message}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
