import type { MissionDef } from '@greyhat/core';

export const PASSWORD = 'Quicksand#26';
export const FLAG = 'GH-9042-REPORTS';

export const m008: MissionDef = {
  id: 'M008',
  title: 'Three Strikes',
  track: 'Reconnaissance',
  role: 'offense',
  difficulty: 2,
  xp: 220,
  briefing: [
    "You've been asked to confirm whether app02's reporting service account,",
    "svc-reports, is still using its original setup password. You have a",
    'clean shot at it -- but whoever hardened this box also turned on',
    "fail2ban, so there's no room to guess your way in. Find the password",
    'before you touch ssh, not after.',
  ],
  objectives: [
    {
      id: 'read-hint',
      text: 'Find whatever tells you the real password before you try ssh',
      check: { kind: 'fileRead', path: '/home/analyst/handover-notes.txt' },
    },
    {
      id: 'login',
      text: 'Log in as svc-reports on app02',
      check: { kind: 'authSuccess', targetUser: 'svc-reports', targetHostId: 'app02' },
    },
    {
      id: 'flag',
      text: 'Read the flag and submit it',
      check: { kind: 'answer', value: FLAG },
    },
  ],
  hints: [
    "Don't start guessing at svc-reports' password. Something on this box already tells you what it is -- look around before you touch ssh.",
    "Once you find it, use it exactly as written -- copy it character for character, including any punctuation.",
    "app02 runs fail2ban watching sshd: three wrong guesses total -- even split across separate ssh attempts, not just three in a row -- and your IP is auto-blocked for the rest of this session, no way back in. Get it right the first time rather than trying your luck.",
  ],
  debrief: [
    `svc-reports' password was never rotated after setup: ${PASSWORD}, sitting in a handover note.`,
    'A blind brute-force against this account would have tripped fail2ban after exactly three',
    'wrong guesses -- the account would have become unreachable for the rest of the engagement,',
    "with nothing left to show for it. Reconnaissance (finding a credential that's already known",
    "or written down somewhere) beats guessing: it's faster, quieter, and doesn't trip the exact",
    'defense built to catch guessing.',
    '',
    'Fixes: rotate credentials immediately after any handover or onboarding, never leave a',
    'password in a plaintext note once it has been used, and keep fail2ban (or an equivalent)',
    'enabled -- it genuinely would have stopped a less careful attacker here. Pair it with',
    'disabling SSH password auth entirely and requiring keys, so there is no password to guess',
    'or leave lying around in the first place.',
    'MITRE ATT&CK: T1078 Valid Accounts (via found credentials), contrasted with T1110 Brute Force.',
  ],
  world: {
    startTime: Date.UTC(2026, 2, 9, 10, 0, 0),
    hosts: [
      {
        id: 'pentest-box',
        hostname: 'pentest-box',
        ip: '10.0.5.5',
        users: [
          { name: 'root', uid: 0, home: '/root' },
          { name: 'analyst', uid: 1000, home: '/home/analyst' },
        ],
        fs: {
          '/home/analyst/': { owner: 'analyst' },
          '/home/analyst/handover-notes.txt': {
            owner: 'analyst',
            content: [
              'app02 handover, from the outgoing contractor:',
              '',
              'svc-reports account is used by the nightly reporting job. Setup password was',
              `${PASSWORD} -- as far as I know nobody ever got around to rotating it after`,
              "setup. Heads up: ops turned on fail2ban on this box a while back, so don't",
              "go testing ssh logins by trial and error -- you'll lock the account's source",
              'IP out after 3 bad attempts, same as anyone else would.',
              '',
            ].join('\n'),
          },
        },
      },
      {
        id: 'app02',
        hostname: 'app02',
        ip: '203.0.113.133',
        users: [
          { name: 'root', uid: 0, home: '/root' },
          { name: 'svc-reports', uid: 1050, home: '/home/svc-reports', password: PASSWORD },
        ],
        services: [{ port: 22, proto: 'tcp', name: 'ssh', version: 'OpenSSH 9.3p1 Ubuntu' }],
        fail2ban: { maxFailures: 3, windowMs: 60 * 60_000 },
        fs: {
          '/home/svc-reports/': { owner: 'svc-reports' },
          '/home/svc-reports/flag.txt': { owner: 'svc-reports', content: `${FLAG}\n` },
        },
      },
    ],
  },
  start: { hostId: 'pentest-box', user: 'analyst' },
  solution: [
    'cat handover-notes.txt',
    'ssh svc-reports@203.0.113.133',
    PASSWORD,
    'cat flag.txt',
    `submit ${FLAG}`,
  ],
};
