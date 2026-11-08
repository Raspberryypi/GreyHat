import type { MissionDef } from '@greyhat/core';
import { generateAuthLog } from '../generators/authlog';

const ATTACKER_IP = '198.51.100.90';
const COMPROMISED_USER = 'svc-deploy';
const DECOY_IP = '203.0.113.44';

const START = Date.UTC(2026, 1, 3, 14, 20, 0);

export const m006: MissionDef = {
  id: 'M006',
  title: 'Lockdown',
  track: 'Incident response & containment',
  role: 'defense',
  difficulty: 2,
  xp: 240,
  briefing: [
    "You've done this before: a brute-force attack against edge01, and your job",
    'is to find the source. This time, finding it is only half the job -- ops',
    "wants the attacker's IP actually blocked before the next shift starts, not",
    'just named in a ticket.',
  ],
  objectives: [
    {
      id: 'read-log',
      text: 'Open the SSH authentication log (/var/log/auth.log)',
      check: { kind: 'fileRead', path: '/var/log/auth.log' },
    },
    {
      id: 'attacker',
      text: 'Identify the attacking IP address (submit <ip>)',
      check: { kind: 'answer', value: ATTACKER_IP },
    },
    {
      id: 'contain',
      text: "Block the attacker's IP on port 22 with ufw",
      check: { kind: 'firewallBlocks', hostId: 'edge01', port: 22, fromHostId: 'threat-host' },
    },
  ],
  hints: [
    "Same approach as the last brute-force case: grep 'Failed password' /var/log/auth.log | head",
    "Count failures per source IP: grep -oE for IPs, then sort | uniq -c | sort -rn | head -3. One IP is just a noisy, harmless scanner -- the real attacker also shows up in 'Accepted'.",
    'Blocking is a separate step from naming the IP: ufw deny from <ip> to any port 22. Check it stuck with ufw status.',
  ],
  debrief: [
    `${ATTACKER_IP} sprayed passwords against several accounts and got into '${COMPROMISED_USER}'.`,
    "Identifying an attacker doesn't stop them -- the account is still compromised and the attacker",
    'can still reach the port until someone actively blocks it. `ufw deny from <ip> to any port 22`',
    'closes that door immediately; a real environment would pair this with rotating the compromised',
    "credential and reviewing what that account touched while it was in the attacker's hands.",
    '',
    'This is the identify -> contain -> eradicate -> recover pattern real incident response follows --',
    "you just did the first two steps. Containment buys time; it isn't remediation by itself.",
    'MITRE ATT&CK: T1110 Brute Force. NIST SP 800-61: containment.',
  ],
  world: {
    startTime: START,
    hosts: [
      {
        id: 'edge01',
        hostname: 'edge01',
        ip: '203.0.113.5',
        users: [
          { name: 'root', uid: 0, home: '/root' },
          { name: 'analyst', uid: 1000, home: '/home/analyst', groups: ['adm'] },
          { name: 'svc-deploy', uid: 1001, home: '/home/svc-deploy' },
          { name: 'nora', uid: 1002, home: '/home/nora' },
          { name: 'theo', uid: 1003, home: '/home/theo' },
        ],
        services: [{ port: 22, proto: 'tcp', name: 'ssh', version: 'OpenSSH 9.3p1 Ubuntu' }],
        fs: (rng) => ({
          '/home/analyst/': { owner: 'analyst' },
          '/home/analyst/handoff-note.txt': {
            owner: 'analyst',
            content: [
              'Night shift: edge01 has been noisy on sshd since mid-afternoon. Same pattern as',
              'the srv01 incident last month -- find the source, and this time actually shut the',
              'door behind you (ufw), not just a ticket saying who it was.',
              '',
            ].join('\n'),
          },
          '/var/log/auth.log': {
            owner: 'root',
            group: 'adm',
            mode: 0o640,
            content: generateAuthLog(rng, {
              hostname: 'edge01',
              start: Date.UTC(2026, 1, 3, 11, 0, 0),
              end: Date.UTC(2026, 1, 3, 14, 15, 0),
              legit: [
                { user: 'nora', ip: '10.0.4.11', uid: 1002 },
                { user: 'theo', ip: '10.0.4.27', uid: 1003 },
                { user: 'svc-deploy', ip: '10.0.4.9', uid: 1001 },
              ],
              legitSessions: 24,
              attack: {
                ip: ATTACKER_IP,
                startAt: Date.UTC(2026, 1, 3, 13, 50, 0),
                attempts: 130,
                compromisedUser: COMPROMISED_USER,
                compromisedUid: 1001,
              },
              decoy: { ip: DECOY_IP, attempts: 8 },
            }),
          },
        }),
      },
      // A separate host purely so `ufw deny from <ip> ...` has something to
      // resolve the attacker's IP to (World.findHost / ufw need a HostSpec,
      // not just a bare string in a log line). No services, not reachable
      // from edge01 in any way that matters -- it exists only to carry the
      // IP address, matching M003's precedent of a flavor-only remote host.
      {
        id: 'threat-host',
        hostname: 'threat-host',
        ip: ATTACKER_IP,
        users: [{ name: 'root', uid: 0, home: '/root' }],
        fs: {},
      },
    ],
  },
  start: { hostId: 'edge01', user: 'analyst' },
  solution: [
    'cat handoff-note.txt',
    "grep 'Failed password' /var/log/auth.log | grep -oE '[0-9]{1,3}(\\.[0-9]{1,3}){3}' | sort | uniq -c | sort -rn | head -3",
    `submit ${ATTACKER_IP}`,
    `ufw deny from ${ATTACKER_IP} to any port 22`,
  ],
};
