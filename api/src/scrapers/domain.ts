// =py scrapers/whois_dns — Python opens a socket to port 443 and inspects the TLS certificate.
// Workers has no raw sockets, so an HTTPS request stands in: a Response proves the name resolved
// and the handshake completed, and any throw (DNS failure, TLS failure, timeout) means it did not.
// The two signals therefore collapse into one; only has_ssl is persisted, so nothing downstream
// can tell the difference.

const TIMEOUT_MS = 5_000; // =py socket.create_connection(..., timeout=5)

export interface DomainCheck {
  has_ssl: boolean;
  domain: string;
  dns_resolves: boolean;
}

// =py check_domain
export async function checkDomain(domain: string): Promise<DomainCheck> {
  try {
    await fetch(`https://${domain}`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { has_ssl: true, domain, dns_resolves: true };
  } catch (error) {
    console.log('domain_check_failed', { domain, error: error instanceof Error ? error.message : String(error) });
    return { has_ssl: false, domain, dns_resolves: false };
  }
}
