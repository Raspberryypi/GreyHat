import type { MissionDef } from '@greyhat/core';
import { generatePrivilegeLog } from '../generators/privlog';

export const INCIDENT_USER = 'contractor';
export const INCIDENT_METHOD = 'su';

const START = Date.UTC(2026, 3, 6, 0, 0, 0);
const INCIDENT_AT = Date.UTC(2026, 3, 6, 3, 14, 0);

export const m005: MissionDef = {
  id: 'M005',
  title: 'After the Fact',
  track: 'Log analysis',
  role: 'defense',
  difficulty: 2,
  xp: 210,
  briefing: [
    'Finance flagged unusual overnight activity on finance01. Nothing was defaced and no',
    'files are missing -- but someone is worried an account got used for something it',
    "should not have been used for, and wants to know who, and how, before deciding what",
    'to do about it.',
    '',
    "You have /var/log/auth.log through the adm group. Normal admins use sudo constantly;",
    "that alone is not the story. Find the ONE escalation to root that does not belong.",
  ],
  objectives: [
    {
      id: 'read-log',
      text: 'Open the authentication log (/var/log/auth.log)',
      check: { kind: 'fileRead', path: '/var/log/auth.log' },
    },
    {
      id: 'who',
      text: 'Identify the account behind the illegitimate escalation (submit <username>)',
      check: { kind: 'answer', value: INCIDENT_USER },
    },
    {
      id: 'how',
      text: 'Identify the mechanism used to reach root (submit su or sudo)',
      check: { kind: 'answer', value: INCIDENT_METHOD },
    },
  ],
  hints: [
    "Both `su` and `sudo` can open a root session, and both say so in this log. Search for the " +
      "literal phrase that both leave behind: grep 'session opened for user root' /var/log/auth.log",
    'Most of those hits are routine sudo lines from known admin accounts during business hours. ' +
      'One hit looks different in two ways at once: the account, and the hour. Check timestamps.',
    "The odd line starts with the process name in brackets right after the hostname -- `su[`, not " +
      "`sudo:`. That tells you the mechanism; the username right before \"(uid=0)\" is the account.",
  ],
  debrief: [
    `The ${INCIDENT_USER} account ran \`su\` straight to root at 03:14 -- hours outside any normal`,
    'admin activity on this box, using an account that has no routine reason to touch root at all.',
    'Every other root session in the log is ordinary sudo use by known admins doing known things.',
    '',
    'The lesson: "they used sudo/su successfully" is not itself suspicious -- admins do that all',
    'day. What makes an escalation worth investigating is WHO did it and WHEN, against what that',
    'account normally does. A SIEM rule of "alert on su/sudo root session from an account with no',
    'sudo rules of its own, or outside its normal hours" would have caught this one immediately.',
    '',
    'Fixes: remove su/sudo access from accounts that do not need it (least privilege), alert on any',
    '"session opened for user root" line from an account outside its known baseline, and rotate the',
    `${INCIDENT_USER} account's credentials now that it is confirmed compromised.`,
    'MITRE ATT&CK: T1548.003 Abuse Elevation Control Mechanism: Sudo and Sudo Caching, T1078 Valid',
    'Accounts.',
  ],
  world: {
    startTime: START,
    hosts: [
      {
        id: 'finance01',
        hostname: 'finance01',
        ip: '203.0.113.40',
        users: [
          { name: 'root', uid: 0, home: '/root' },
          { name: 'analyst', uid: 1000, home: '/home/analyst', groups: ['adm'] },
          { name: 'sre-priya', uid: 1001, home: '/home/sre-priya' },
          { name: 'sre-malik', uid: 1002, home: '/home/sre-malik' },
          { name: INCIDENT_USER, uid: 1050, home: `/home/${INCIDENT_USER}` },
        ],
        fs: (rng) => ({
          '/home/analyst/': { owner: 'analyst' },
          '/home/analyst/shift-note.txt': {
            owner: 'analyst',
            content: [
              'Finance flagged odd overnight activity on finance01. Nothing missing or defaced,',
              'but they want to know if an account reached root that should not have, and how.',
              '',
              "Remember: most sudo activity here is completely normal admin work. Don't chase",
              'every hit -- find the one that is actually out of place.',
              '',
            ].join('\n'),
          },
          '/var/log/auth.log': {
            owner: 'root',
            group: 'adm',
            mode: 0o640,
            content: generatePrivilegeLog(rng, {
              hostname: 'finance01',
              start: Date.UTC(2026, 3, 5, 8, 0, 0),
              end: Date.UTC(2026, 3, 6, 8, 0, 0),
              legit: [
                { user: 'sre-priya', ip: '10.0.5.12', uid: 1001 },
                { user: 'sre-malik', ip: '10.0.5.18', uid: 1002 },
              ],
              legitSessions: 20,
              routineSudo: {
                users: ['sre-priya', 'sre-malik'],
                commands: [
                  '/usr/bin/apt-get update',
                  '/usr/bin/systemctl restart nginx',
                  '/usr/bin/systemctl status postgresql',
                  '/usr/bin/journalctl -xe',
                  '/usr/sbin/useradd -m newhire',
                ],
                count: 34,
              },
              incident: { user: INCIDENT_USER, at: INCIDENT_AT, method: INCIDENT_METHOD },
            }),
          },
        }),
      },
    ],
  },
  start: { hostId: 'finance01', user: 'analyst' },
  solution: [
    'cat shift-note.txt',
    "grep 'session opened for user root' /var/log/auth.log",
    `submit ${INCIDENT_USER}`,
    `submit ${INCIDENT_METHOD}`,
  ],
};
