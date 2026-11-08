import type { MissionDef } from '@greyhat/core';
import { generateAccessLog } from '../generators/accesslog';

export const ATTACKER_IP = '192.0.2.77';
export const TECHNIQUE = 'sqli';

const START = Date.UTC(2026, 4, 12, 9, 0, 0);

export const m007: MissionDef = {
  id: 'M007',
  title: "Web Logs Don't Lie",
  track: 'Log analysis',
  role: 'defense',
  difficulty: 2,
  xp: 230,
  briefing: [
    'www01 is the public marketing site. Someone on the on-call rotation noticed a handful',
    'of weird-looking requests in the nginx access log overnight and flagged it before',
    'heading to bed, without digging further.',
    '',
    'Find out who it was, what they were trying, and shut the door.',
  ],
  objectives: [
    {
      id: 'read-log',
      text: 'Open the nginx access log (/var/log/nginx/access.log)',
      check: { kind: 'fileRead', path: '/var/log/nginx/access.log' },
    },
    {
      id: 'attacker',
      text: 'Identify the attacking IP address (submit <ip>)',
      check: { kind: 'answer', value: ATTACKER_IP },
    },
    {
      id: 'technique',
      text: 'Identify the technique used (submit sqli or traversal)',
      check: { kind: 'answer', value: TECHNIQUE },
    },
    {
      id: 'contain',
      text: "Block the attacker's IP on port 80 with ufw",
      check: { kind: 'firewallBlocks', hostId: 'www01', port: 80, fromHostId: 'web-threat-host' },
    },
  ],
  hints: [
    "Most of this traffic is normal page loads. Look for requests whose query string has characters " +
      "that don't belong in a URL -- quotes, SQL keywords -- rather than a product ID or a search term.",
    'grep for a SQL keyword directly in the log -- a real page load never contains the word SELECT: ' +
      'grep SELECT /var/log/nginx/access.log',
    "Block it the same way you would any other attacker, just on the port nginx actually listens on: " +
      "ufw deny from <ip> to any port 80 (not 22 -- this is a web server, not ssh).",
  ],
  debrief: [
    `${ATTACKER_IP} sent several requests with classic SQL injection payloads (OR 1=1 tautologies,`,
    'UNION SELECT) in the query string, and the app returned 200 OK for them -- meaning the',
    'malformed query very likely ran rather than being rejected outright. That 200 is the whole',
    'story: a blocked or sanitized attempt would have come back 400 or 403, not 200.',
    '',
    'Fixes: use parameterized queries / prepared statements -- never build SQL by concatenating',
    'user input into a string. Run the database connection with the least privilege the app',
    'actually needs, so even a successful injection has nothing useful to UNION SELECT out of.',
    'Put a WAF in front of public endpoints to catch obvious injection patterns before they reach',
    'the app. Blocking the source IP, like you just did, buys time -- it does not fix the',
    'underlying injection flaw, which still needs a code fix and a release.',
    'CWE-89 SQL Injection. OWASP Top 10 A03:2021 Injection. MITRE ATT&CK T1190 Exploit',
    'Public-Facing Application.',
  ],
  world: {
    startTime: START,
    hosts: [
      {
        id: 'www01',
        hostname: 'www01',
        ip: '203.0.113.88',
        users: [
          { name: 'root', uid: 0, home: '/root' },
          { name: 'analyst', uid: 1000, home: '/home/analyst', groups: ['adm'] },
        ],
        services: [{ port: 80, proto: 'tcp', name: 'http', version: 'nginx 1.24.0' }],
        fs: (rng) => ({
          '/home/analyst/': { owner: 'analyst' },
          '/home/analyst/alert.txt': {
            owner: 'analyst',
            content: [
              'Saw a few odd-looking hits in the nginx log overnight, query strings that didn\'t look',
              'like normal page traffic. Didn\'t have time to dig in before I had to log off --',
              'can you pick it up? Find the source, confirm what they were trying, and block it.',
              '',
            ].join('\n'),
          },
          '/var/log/nginx/': { owner: 'root' },
          '/var/log/nginx/access.log': {
            owner: 'root',
            group: 'adm',
            mode: 0o640,
            content: generateAccessLog(rng, {
              start: Date.UTC(2026, 4, 12, 6, 0, 0),
              end: Date.UTC(2026, 4, 12, 8, 50, 0),
              legitIps: ['198.51.100.21', '198.51.100.34', '198.51.100.56', '198.51.100.9'],
              legitPaths: [
                '/',
                '/about',
                '/products',
                '/products/42',
                '/login',
                '/static/app.js',
                '/static/style.css',
                '/api/health',
                '/contact',
                '/blog/post-1',
              ],
              legitRequests: 60,
              attack: {
                ip: ATTACKER_IP,
                technique: TECHNIQUE,
                attempts: 6,
                firstAt: Date.UTC(2026, 4, 12, 8, 30, 0),
              },
            }),
          },
        }),
      },
      // Flavor-only host so `ufw deny from <ip> ...` has something to
      // resolve the attacker's IP to, same precedent as M006's 'threat-host'.
      {
        id: 'web-threat-host',
        hostname: 'web-threat-host',
        ip: ATTACKER_IP,
        users: [{ name: 'root', uid: 0, home: '/root' }],
        fs: {},
      },
    ],
  },
  start: { hostId: 'www01', user: 'analyst' },
  solution: [
    'cat alert.txt',
    'grep SELECT /var/log/nginx/access.log',
    `submit ${ATTACKER_IP}`,
    `submit ${TECHNIQUE}`,
    `ufw deny from ${ATTACKER_IP} to any port 80`,
  ],
};
