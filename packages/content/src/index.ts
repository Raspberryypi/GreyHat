import type { MissionDef } from '@greyhat/core';
import { m001 } from './missions/m001-first-login';
import { m002 } from './missions/m002-brute-force';
import { m003 } from './missions/m003-open-door';

/** All missions, in recommended play order. */
export const missions: MissionDef[] = [m001, m002, m003];

export { generateAuthLog } from './generators/authlog';
