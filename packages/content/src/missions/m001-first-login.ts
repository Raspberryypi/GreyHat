import type { MissionDef } from '@greyhat/core';

const ACCESS_CODE = 'GH-7731-ALPHA';

export const m001: MissionDef = {
  id: 'M001',
  title: 'First Login',
  track: 'Linux fundamentals',
  role: 'fundamentals',
  difficulty: 1,
  xp: 100,
  briefing: [
    'You have just been handed a workstation (ws01) at a small engineering firm.',
    'A colleague left a trail of clues before going on leave. Somewhere on this',
    'machine is the access code for Project Atlas. Find it and submit it.',
  ],
  objectives: [
    { id: 'ls', text: 'List the files in your home directory', check: { kind: 'commandRun', name: 'ls' } },
    {
      id: 'ls-a',
      text: 'Reveal hidden files (names starting with a dot)',
      check: { kind: 'commandRun', name: 'ls', argsPattern: '(^|\\s)-[a-zA-Z]*a' },
    },
    {
      id: 'note',
      text: 'Read the hidden note in your home directory',
      check: { kind: 'fileRead', path: '/home/analyst/.secret_note' },
    },
    {
      id: 'find',
      text: 'Use find to search the filesystem',
      check: { kind: 'commandRun', name: 'find', mustSucceed: false },
    },
    {
      id: 'code',
      text: 'Read the access code file',
      check: { kind: 'fileRead', path: '/srv/projects/atlas/config/access_code.txt' },
    },
    {
      id: 'submit',
      text: 'Submit the access code (submit <code>)',
      check: { kind: 'answer', value: ACCESS_CODE },
    },
  ],
  hints: [
    "Plain 'ls' skips hidden files. Try 'ls -la' in your home directory.",
    "The note mentions the file name and the /srv directory. Try: find /srv -name access_code.txt",
    "Searching from / is noisy because you cannot enter some directories. Append 2>/dev/null to hide those errors.",
  ],
  debrief: [
    'What you practised:',
    '  - ls -a reveals dotfiles. Attackers (and admins) hide things there all the time.',
    '  - find locates files by name, type, owner and permissions.',
    '  - "Permission denied" is the OS enforcing least privilege. 2>/dev/null only hides the message.',
    'Defensive takeaway: never store secrets in plain text files. Use a secrets manager,',
    'and keep readable-by-everyone files (mode 644) free of credentials.',
  ],
  world: {
    startTime: Date.UTC(2026, 0, 12, 9, 30, 0),
    hosts: [
      {
        id: 'ws01',
        hostname: 'ws01',
        ip: '10.0.1.20',
        users: [
          { name: 'root', uid: 0, home: '/root' },
          { name: 'analyst', uid: 1000, home: '/home/analyst' },
        ],
        fs: {
          '/home/analyst/': { owner: 'analyst' },
          '/home/analyst/README.txt': {
            owner: 'analyst',
            content: [
              'Welcome to GreyHat, analyst.',
              '',
              'This is a sandboxed training workstation. Nothing here touches a real system.',
              '',
              'Your first job is to get your bearings:',
              '  1. Look around your home directory.',
              '  2. Not everything is shown by default. Linux hides names that start with a dot.',
              '  3. Follow the trail.',
              '',
              'Commands you will want: ls, cd, cat, find, grep',
              '',
            ].join('\n'),
          },
          '/home/analyst/.secret_note': {
            owner: 'analyst',
            mode: 0o600,
            content: [
              'Analyst,',
              '',
              'The access code for Project Atlas was moved out of the wiki.',
              'It lives somewhere under /srv in a file called access_code.txt.',
              'Use find to locate it. Tip: errors go to stderr, and 2>/dev/null',
              'sends stderr to the void.',
              '',
              '- M.',
              '',
            ].join('\n'),
          },
          '/home/analyst/notes/': { owner: 'analyst' },
          '/home/analyst/notes/todo.txt': {
            owner: 'analyst',
            content: '- rotate backup keys\n- ask devops about the atlas config location\n- renew TLS cert (12 days left)\n',
          },
          '/srv/projects/atlas/README.md': 'Project Atlas: internal deployment config. Do not commit secrets.\n',
          '/srv/projects/atlas/config/access_code.txt': `${ACCESS_CODE}\n`,
          '/srv/projects/atlas/config/app.conf': 'port=8443\nlog_level=info\n',
          '/srv/projects/helios/config/settings.conf': 'mode=production\nretries=3\n',
          '/srv/projects/helios/README.md': 'Project Helios: batch processing service.\n',
          '/root/': { mode: 0o700 },
          '/root/.bash_history': { mode: 0o600, content: 'apt update\nvim /etc/ssh/sshd_config\n' },
          '/var/log/syslog': 'Jan 12 09:00:01 ws01 CRON[812]: (root) CMD (run-parts /etc/cron.hourly)\n',
        },
      },
    ],
  },
  start: { hostId: 'ws01', user: 'analyst' },
  solution: [
    'ls',
    'ls -la',
    'cat .secret_note',
    'find / -name access_code.txt 2>/dev/null',
    'cat /srv/projects/atlas/config/access_code.txt',
    `submit ${ACCESS_CODE}`,
  ],
};
