import socket
import ssl

import structlog

logger = structlog.get_logger()


def check_ssl(domain: str) -> bool:
    """Check if domain has valid SSL certificate."""
    try:
        context = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=5) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
                return cert is not None
    except Exception:
        return False


def check_domain(domain: str) -> dict:
    """Check domain DNS and SSL status."""
    result = {
        "has_ssl": False,
        "domain": domain,
        "dns_resolves": False,
    }

    try:
        # DNS resolution check
        socket.getaddrinfo(domain, None)
        result["dns_resolves"] = True
    except socket.gaierror:
        logger.info("dns_resolution_failed", domain=domain)
        return result

    # SSL check
    result["has_ssl"] = check_ssl(domain)

    return result
