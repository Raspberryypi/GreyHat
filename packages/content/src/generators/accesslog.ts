import type { Rng } from '@greyhat/core';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Apache/nginx Combined Log Format timestamp: [12/May/2026:08:30:04 +0000] */
function clfStamp(ms: number): string {
  const d = new Date(ms);
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return `${p2(d.getUTCDate())}/${MONTHS[d.getUTCMonth()]}/${d.getUTCFullYear()}:${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} +0000`;
}

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const TRAVERSAL_PATHS = [
  '/download?file=../../../../etc/passwd',
  '/static/..%2f..%2f..%2fetc%2fpasswd',
  '/files/../../../../etc/shadow',
];

const SQLI_PATHS = [
  "/products?id=1' OR 1=1 UNION SELECT username,password FROM users--",
  "/login?user=admin' UNION SELECT 1,2,3--",
  "/search?q=1' UNION SELECT username,password FROM users--",
];

export interface AccessLogOptions {
  start: number;
  end: number;
  legitIps: string[];
  legitPaths: string[];
  legitRequests: number;
  attack: {
    ip: string;
    technique: 'traversal' | 'sqli';
    attempts: number;
    firstAt: number;
  };
}

/**
 * Generates an nginx/Apache Combined Log Format access.log mixing normal
 * page-load traffic with a handful of attack probes (path traversal or
 * SQL injection, chosen per mission). Traversal probes come back 403
 * (blocked by the app); SQLi probes come back 200 -- the more alarming
 * signal, since a 200 on a query-string-injected request means the
 * malformed query very likely ran rather than being rejected outright.
 */
export function generateAccessLog(rng: Rng, o: AccessLogOptions): string {
  const events: { t: number; line: string }[] = [];
  const span = o.end - o.start;

  for (let i = 0; i < o.legitRequests; i++) {
    const t = o.start + Math.floor(rng.next() * span);
    const ip = rng.pick(o.legitIps);
    const path = rng.pick(o.legitPaths);
    const size = rng.int(200, 15000);
    events.push({ t, line: `${ip} - - [${clfStamp(t)}] "GET ${path} HTTP/1.1" 200 ${size} "-" "${UA}"` });
  }

  const payloads = o.attack.technique === 'traversal' ? TRAVERSAL_PATHS : SQLI_PATHS;
  const status = o.attack.technique === 'traversal' ? 403 : 200;
  for (let i = 0; i < o.attack.attempts; i++) {
    const t = o.attack.firstAt + i * rng.int(2000, 9000);
    const path = rng.pick(payloads);
    events.push({ t, line: `${o.attack.ip} - - [${clfStamp(t)}] "GET ${path} HTTP/1.1" ${status} ${rng.int(150, 900)} "-" "curl/8.4.0"` });
  }

  events.sort((a, b) => a.t - b.t);
  return events.map((e) => e.line).join('\n') + '\n';
}
