/**
 * "Is this address somewhere this server should not be talking to?"
 *
 * The question comes up whenever the server is handed a URL by somebody else — here, an image
 * gateway that answers with a `url` instead of base64. The answer has to be about the *address*, not
 * the name in the URL: a name can be anything, and `127.0.0.1.nip.io` or `http://2130706433/` are
 * both names that mean "this machine".
 *
 * Kept separate from the route so the ranges can be tested without a running server: a wrong mask
 * here is exactly the kind of mistake that only shows up in production, on a network where it matters.
 */

function ipv4ToInt(ip: string): number | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    let value = 0;
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) return null;
        const octet = Number(part);
        if (octet > 255) return null;
        value = value * 256 + octet;
    }
    return value;
}

/**
 * True for IPv4 addresses this server must never fetch: loopback, link-local (cloud metadata), RFC
 * 1918 private ranges, carrier-grade NAT, and the multicast and reserved blocks.
 */
export function isForbiddenIpv4(ip: string): boolean {
    const value = ipv4ToInt(ip);
    // Unparseable is not "public": refusing it keeps a malformed literal from sneaking through.
    if (value === null) return true;

    const inRange = (base: string, bits: number) => {
        const baseValue = ipv4ToInt(base);
        if (baseValue === null) return false;
        const mask = (0xffffffff << (32 - bits)) >>> 0;
        // Both sides come out of the same signed 32-bit `&`, so the comparison stays consistent.
        return (value & mask) === (baseValue & mask);
    };

    return (
        inRange('0.0.0.0', 8) ||
        inRange('10.0.0.0', 8) ||
        inRange('100.64.0.0', 10) ||
        inRange('127.0.0.0', 8) ||
        inRange('169.254.0.0', 16) ||
        inRange('172.16.0.0', 12) ||
        inRange('192.0.0.0', 24) ||
        inRange('192.168.0.0', 16) ||
        inRange('198.18.0.0', 15) ||
        inRange('224.0.0.0', 4) ||
        inRange('240.0.0.0', 4)
    );
}

/** The same rule for IPv6, including the IPv4-mapped form that hides a v4 target behind a v6 name. */
export function isForbiddenIpv6(ip: string): boolean {
    const address = ip.toLowerCase().split('%')[0];
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isForbiddenIpv4(mapped[1]);
    if (address === '::' || address === '::1') return true;
    if (/^f[cd]/.test(address)) return true; // fc00::/7 unique-local
    if (/^fe[89ab]/.test(address)) return true; // fe80::/10 link-local
    return false;
}

/** Picks the right rule for a resolved address (`dns.lookup` reports the family alongside it). */
export function isForbiddenAddress(address: string, family: number): boolean {
    return family === 6 ? isForbiddenIpv6(address) : isForbiddenIpv4(address);
}
