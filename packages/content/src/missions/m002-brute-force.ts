import type { MissionDef } from '@greyhat/core';
import { generateAuthLog } from '../generators/authlog';

export const ATTACKER_IP = '203.0.113.77';
export const COMPROMISED_USER = 'deploy';
const DECOY_IP = '198.51.100.23';

const START = Date.UTC(2026, 0, 12, 11, 45, 0);

export const m002: MissionDef = {
  id: 'M002',
  title: 'Brute Force',
  track: 'Log analysis',
  role: 'defense',
  difficulty: 2,
  xp: 200,
  briefing: [
    'Monday 11:45 UTC. The on-call engineer flagged unusual SSH traffic on srv01,',
    'a public-facing server. You can read /var/log/auth.log through the adm group.',
    '',
    'Work out who attacked the server, and whether they got in.',
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
      id: 'victim',
      text: 'Identify the account the attacker compromised (submit <username>)',
      check: { kind: 'answer', value: COMPROMISED_USER },
    },
  ],
  hints: [
    "Failed logins contain 'Failed password'. Start with: grep 'Failed password' /var/log/auth.log | head",
    'You need a count per source IP. Extract IPs with grep -oE, then: sort | uniq -c | sort -rn | head',
    "One IP is noisy but harmless. The real attacker also has a successful login: grep Accepted /var/log/auth.log",
  ],
  debrief: [
    `The attacker at ${ATTACKER_IP} sprayed passwords at several accounts and got into '${COMPROMISED_USER}'.`,
    'Detection pattern: many "Failed password" lines from one IP followed by "Accepted" from the same IP.',
    'Note the decoy: the most obvious noise is not always the most dangerous source.',
    '',
    'Fixes: disable SSH password auth (PasswordAuthentication no), require keys, add fail2ban or',
    'rate limiting, restrict SSH by source IP, and rotate the compromised credentials.',
    'MITRE ATT&CK: T1110 Brute Force.',
  ],
  world: {
    startTime: START,
    hosts: [
      {
        id: 'srv01',
        hostname: 'srv01',
        ip: '203.0.113.10',
        users: [
          { name: 'root', uid: 0, home: '/root' },
          { name: 'analyst', uid: 1000, home: '/home/analyst', groups: ['adm'] },
          { name: 'deploy', uid: 1001, home: '/home/deploy' },
          { name: 'alice', uid: 1002, home: '/home/alice' },
          { name: 'bob', uid: 1003, home: '/home/bob' },
        ],
        fs: (rng) => ({
          '/home/analyst/': { owner: 'analyst' },
          '/home/analyst/oncall-ticket.txt': {
            owner: 'analyst',
            content: [
              'ALERT: spike in sshd authentication failures on srv01',
              'Window: roughly 10:10 - 10:30 UTC',
              'Please investigate and report back.',
              '',
            ].join('\n'),
          },
          '/var/log/auth.log': {
            owner: 'root',
            group: 'adm',
            mode: 0o640,
            content: generateAuthLog(rng, {
              hostname: 'srv01',
              start: Date.UTC(2026, 0, 12, 8, 0, 0),
              end: Date.UTC(2026, 0, 12, 11, 40, 0),
              legit: [
                { user: 'alice', ip: '10.0.2.14', uid: 1002 },
                { user: 'bob', ip: '10.0.2.31', uid: 1003 },
                { user: 'deploy', ip: '10.0.2.5', uid: 1001 },
              ],
              legitSessions: 28,
              attack: {
                ip: ATTACKER_IP,
                startAt: Date.UTC(2026, 0, 12, 10, 12, 0),
                attempts: 140,
                compromisedUser: COMPROMISED_USER,
                compromisedUid: 1001,
              },
              decoy: { ip: DECOY_IP, attempts: 9 },
            }),
          },
          '/var/log/syslog': {
            group: 'adm',
            mode: 0o640,
            content: 'Jan 12 11:00:01 srv01 CRON[2210]: (root) CMD (run-parts /etc/cron.hourly)\n',
          },
        }),
      },
    ],
  },
  start: { hostId: 'srv01', user: 'analyst' },
  solution: [
    'cat oncall-ticket.txt',
    "grep 'Failed password' /var/log/auth.log | grep -oE '[0-9]{1,3}(\\.[0-9]{1,3}){3}' | sort | uniq -c | sort -rn | head -3",
    `submit ${ATTACKER_IP}`,
    'grep Accepted /var/log/auth.log | grep 203.0.113.77',
    `submit ${COMPROMISED_USER}`,
  ],
};
