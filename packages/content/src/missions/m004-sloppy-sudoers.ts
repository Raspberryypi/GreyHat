import type { MissionDef } from '@greyhat/core';

export const FLAG = 'GREYHAT{sudo_crontab_is_basically_root}';

const START = Date.UTC(2026, 2, 10, 14, 0, 0);

export const m004: MissionDef = {
  id: 'M004',
  title: 'Sloppy Sudoers',
  track: 'Privilege escalation',
  role: 'offense',
  difficulty: 2,
  xp: 240,
  briefing: [
    'You have a low-privilege account on app01. Ops asked you to figure out',
    'why the nightly backup job keeps failing -- but nobody will give you the',
    'root password.',
    '',
    "You don't need it. Check what you're actually allowed to do as someone else.",
  ],
  objectives: [
    {
      id: 'enum',
      text: 'Check what you can run with sudo',
      check: { kind: 'commandRun', name: 'sudo', argsPattern: '^-l$' },
    },
    {
      id: 'crontab',
      text: "Read root's crontab via sudo",
      check: { kind: 'commandRun', name: 'sudo', argsPattern: 'crontab' },
    },
    {
      id: 'flag',
      text: 'Read the flag left in root-only storage',
      check: { kind: 'fileRead', path: '/root/.secrets/flag.txt', hostId: 'app01' },
    },
    {
      id: 'submit',
      text: 'Submit the flag',
      check: { kind: 'answer', value: FLAG },
    },
  ],
  hints: [
    "You're logged in as a low-privilege account. Before trying anything fancy, check what you're allowed to run as someone else: sudo -l.",
    'crontab is on your sudo allow-list. Reading a crontab does not execute anything -- it just shows a schedule, and sometimes a comment the owner left themselves: sudo crontab -l.',
    "cat is also on your sudo allow-list, and a comment in root's crontab names the flag's exact path. If you can run cat as root, you can read any file on this box: sudo cat <path>.",
  ],
  debrief: [
    'jr-admin had NOPASSWD sudo rights to run cat and crontab as root. Neither looks dangerous on',
    'its own -- they only read things. But "only reads things" is exactly the problem: a sudo rule',
    "for any generic read tool (cat, less, more, vim, crontab -l...) is root-equivalent, because",
    'it lets you read anything on the filesystem the real root account could read, no matter what',
    'the sudoers comment says the rule was "for".',
    '',
    "This is the exact class of bug the GTFOBins project (gtfobins.github.io) catalogs: common",
    'binaries that defeat a restrictive sudoers entry the moment they are allowed at all. Fixes:',
    'scope sudo rules to exact arguments (Cmnd_Alias with full paths and fixed flags, not bare',
    'command names), avoid NOPASSWD for anything that can read or write files generally, and run',
    "`sudo -l` yourself periodically to audit what your own rules actually permit -- not what you",
    'intended them to permit.',
    'MITRE ATT&CK: T1548.003 Abuse Elevation Control Mechanism: Sudo and Sudo Caching.',
  ],
  world: {
    startTime: START,
    hosts: [
      {
        id: 'app01',
        hostname: 'app01',
        ip: '10.0.4.10',
        users: [
          { name: 'root', uid: 0, home: '/root' },
          { name: 'jr-admin', uid: 1000, home: '/home/jr-admin' },
        ],
        sudoers: [{ user: 'jr-admin', commands: ['cat', 'crontab'], noPasswd: true, asUser: 'root' }],
        crontabs: {
          root: [
            '# GreyHat Corp maintenance jobs',
            '# reminder: flag stored at /root/.secrets/flag.txt',
            '0 3 * * * /usr/local/bin/backup.sh > /var/log/backup.log 2>&1',
          ],
        },
        fs: {
          '/home/jr-admin/': { owner: 'jr-admin' },
          '/home/jr-admin/README.txt': {
            owner: 'jr-admin',
            content:
              "Ops note to self: nightly backups keep failing and nobody will give me the root\n" +
              "password to check why. I do have SOME sudo rights though -- worth checking\n" +
              'exactly what, instead of assuming they are useless.\n',
          },
          '/root/.secrets/': { owner: 'root', mode: 0o700 },
          '/root/.secrets/flag.txt': { owner: 'root', mode: 0o600, content: `${FLAG}\n` },
        },
      },
    ],
  },
  start: { hostId: 'app01', user: 'jr-admin' },
  solution: ['sudo -l', 'sudo crontab -l', 'sudo cat /root/.secrets/flag.txt', `submit ${FLAG}`],
};
