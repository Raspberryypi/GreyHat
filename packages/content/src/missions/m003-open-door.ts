import type { MissionDef } from '@greyhat/core';

export const TARGET_IP = '10.0.3.20';
export const SVC_USER = 'svc-backup';
export const SVC_PASSWORD = 'Harbor2026!';
export const FLAG = 'GREYHAT{weak_creds_are_a_free_shell}';

const START = Date.UTC(2026, 2, 3, 9, 0, 0);

export const m003: MissionDef = {
  id: 'M003',
  title: 'Open Door',
  track: 'Reconnaissance & initial access',
  role: 'offense',
  difficulty: 2,
  xp: 220,
  briefing: [
    'A pentest engagement: the client asked you to check whether their backup',
    'server, web01 (10.0.3.20), can be reached from an internal workstation.',
    '',
    'Scan it, see what is listening, and see how far a weak password gets you.',
  ],
  objectives: [
    {
      id: 'scan',
      text: 'Scan web01 (10.0.3.20) for open ports',
      check: { kind: 'commandRun', name: 'nmap', argsPattern: '10\\.0\\.3\\.20' },
    },
    {
      id: 'login',
      text: `Log in to web01 as ${SVC_USER} over ssh`,
      check: { kind: 'authSuccess', targetUser: SVC_USER, targetHostId: 'web01' },
    },
    {
      id: 'flag',
      text: 'Read the flag left in the compromised account\'s home directory',
      check: { kind: 'fileRead', path: `/home/${SVC_USER}/flag.txt`, hostId: 'web01' },
    },
    {
      id: 'submit',
      text: 'Submit the flag',
      check: { kind: 'answer', value: FLAG },
    },
  ],
  hints: [
    'Start with: nmap -p 22 10.0.3.20 -- see if ssh is even open before guessing anything.',
    `Read the ops note on this box. Backup service accounts tend to follow a naming pattern: the`,
    `project codename, the year, and an exclamation mark -- try: ssh ${SVC_USER}@10.0.3.20, then ${SVC_USER}'s`,
    'password following that exact pattern (capitalized codename + 4-digit year + "!").',
  ],
  debrief: [
    `${SVC_USER} on web01 used the password "${SVC_PASSWORD}" -- predictable, pattern-based, and never`,
    'rotated. One nmap scan plus one guess was enough for a full shell on a production backup host.',
    '',
    'Fixes: disable password auth for service accounts (key-based auth only), enforce a real password',
    'policy (no project-name-plus-year patterns), rotate service credentials on a schedule, and alert',
    'on repeated auth failures followed by a success from the same source (see M002).',
    'MITRE ATT&CK: T1110 Brute Force / Password Guessing, T1078 Valid Accounts.',
  ],
  world: {
    startTime: START,
    hosts: [
      {
        id: 'kali',
        hostname: 'kali',
        ip: '10.0.3.5',
        users: [
          { name: 'root', uid: 0, home: '/root' },
          { name: 'operator', uid: 1000, home: '/home/operator' },
        ],
        fs: {
          '/home/operator/': { owner: 'operator' },
          '/home/operator/ops-note.txt': {
            owner: 'operator',
            content: [
              'Client intake notes - backup infrastructure',
              '',
              'web01 (10.0.3.20) is their "Project Harbor" backup box. Ops team has a bad habit:',
              'service account passwords follow <Codename><Year>! -- flagged this before, they',
              'have not fixed it yet. Worth checking before anything fancier.',
              '',
            ].join('\n'),
          },
        },
        reachable: ['web01'],
      },
      {
        id: 'web01',
        hostname: 'web01',
        ip: TARGET_IP,
        users: [
          { name: 'root', uid: 0, home: '/root' },
          { name: SVC_USER, uid: 1050, home: `/home/${SVC_USER}`, password: SVC_PASSWORD },
        ],
        services: [{ port: 22, proto: 'tcp', name: 'ssh', version: 'OpenSSH 8.2p1 Ubuntu' }],
        fs: {
          [`/home/${SVC_USER}/`]: { owner: SVC_USER },
          [`/home/${SVC_USER}/flag.txt`]: { owner: SVC_USER, content: `${FLAG}\n` },
          '/var/log/auth.log': {
            owner: 'root',
            group: 'adm',
            mode: 0o640,
            content: '',
          },
        },
        reachable: ['kali'],
      },
    ],
  },
  start: { hostId: 'kali', user: 'operator' },
  solution: [
    'cat ops-note.txt',
    `nmap -p 22 ${TARGET_IP}`,
    `ssh ${SVC_USER}@${TARGET_IP}`,
    SVC_PASSWORD,
    'cat flag.txt',
    `submit ${FLAG}`,
  ],
};
