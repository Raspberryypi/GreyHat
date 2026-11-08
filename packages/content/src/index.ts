import type { MissionDef } from '@greyhat/core';
import { m001 } from './missions/m001-first-login';
import { m002 } from './missions/m002-brute-force';
import { m003 } from './missions/m003-open-door';
import { m004 } from './missions/m004-sloppy-sudoers';
import { m005 } from './missions/m005-after-the-fact';

/** All missions, in recommended play order. */
export const missions: MissionDef[] = [m001, m002, m003, m004, m005];

export { generateAuthLog } from './generators/authlog';
export { generatePrivilegeLog } from './generators/privlog';
