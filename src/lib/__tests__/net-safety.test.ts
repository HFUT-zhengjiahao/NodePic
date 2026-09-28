import { isForbiddenAddress, isForbiddenIpv4, isForbiddenIpv6 } from '@/lib/net-safety';
import { describe, expect, it } from 'vitest';

/**
 * The server sometimes has to fetch a URL an upstream gateway handed it. These are the addresses that
 * must never be reachable that way — the ranges a block-list of host *names* cannot catch, because the
 * name can be anything (`127.0.0.1.nip.io`, `http://2130706433/`) as long as it resolves here.
 */
describe('isForbiddenIpv4', () => {
    it('refuses loopback, private, link-local and reserved ranges', () => {
        for (const address of [
            '127.0.0.1',
            '127.1.2.3',
            '10.0.0.5',
            '10.255.255.255',
            '172.16.0.1',
            '172.31.255.255',
            '192.168.1.1',
            '169.254.169.254',
            '100.64.0.1',
            '0.0.0.0',
            '224.0.0.1',
            '255.255.255.255'
        ]) {
            expect(isForbiddenIpv4(address), address).toBe(true);
        }
    });

    it('allows the addresses a real image gateway lives on', () => {
        for (const address of ['8.8.8.8', '1.1.1.1', '104.16.0.1', '172.32.0.1', '192.0.2.1']) {
            expect(isForbiddenIpv4(address), address).toBe(false);
        }
    });

    it('refuses anything it cannot parse', () => {
        for (const address of ['', 'nonsense', '1.2.3', '1.2.3.4.5', '256.1.1.1', '2130706433']) {
            expect(isForbiddenIpv4(address), address).toBe(true);
        }
    });
});

describe('isForbiddenIpv6', () => {
    it('refuses loopback, the unspecified address, unique-local and link-local', () => {
        for (const address of ['::1', '::', 'fd00::1', 'fc00::1', 'fe80::1', 'fe80::1%en0']) {
            expect(isForbiddenIpv6(address), address).toBe(true);
        }
    });

    it('sees through an IPv4-mapped address', () => {
        expect(isForbiddenIpv6('::ffff:127.0.0.1')).toBe(true);
        expect(isForbiddenIpv6('::ffff:8.8.8.8')).toBe(false);
    });

    it('allows a public v6 address', () => {
        expect(isForbiddenIpv6('2606:4700::1111')).toBe(false);
    });
});

describe('isForbiddenAddress', () => {
    it('applies the rule for the family dns.lookup reported', () => {
        expect(isForbiddenAddress('127.0.0.1', 4)).toBe(true);
        expect(isForbiddenAddress('8.8.8.8', 4)).toBe(false);
        expect(isForbiddenAddress('::1', 6)).toBe(true);
        expect(isForbiddenAddress('2606:4700::1111', 6)).toBe(false);
    });
});
