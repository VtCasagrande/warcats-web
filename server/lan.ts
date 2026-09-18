import { networkInterfaces } from 'node:os';

export function lanAddresses() {
  const addresses: string[] = [];
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.internal || net.family !== 'IPv4') continue;
      if (!addresses.includes(net.address)) addresses.push(net.address);
    }
  }
  return addresses;
}

export function isPrivateHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.local')
    || /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
}

export function hostName(host = '') {
  return host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
}

export function isLoopbackHost(host = '') {
  const hostname = hostName(host);
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/** Vite may keep the LAN Host or rewrite it to 127.0.0.1:3001. Private origins must still pass. */
export function isBrowserOriginAllowed(originHeader: string | undefined, hostHeader: string | undefined, extra: string[] = []) {
  if (!originHeader) return true;
  let origin: URL;
  try { origin = new URL(originHeader); } catch { return false; }
  if (extra.includes(origin.origin)) return true;
  if (hostHeader && origin.host === hostHeader) return true;
  return isPrivateHostname(origin.hostname) && (isLoopbackHost(hostHeader) || isPrivateHostname(hostName(hostHeader)));
}
