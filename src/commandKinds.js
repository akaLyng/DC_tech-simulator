/**
 * Which console commands exist in real life. Everything is simulated either way; this only
 * decides where the game shows a [game] tag, so players know what they can type on a real
 * machine. COMMANDS.md has the full table with the reasoning.
 *
 * - real: works on a real system with the same syntax and does the same job
 * - simplified: exists, but the game's version differs in a way that matters
 * - fictional: made up for the game
 */
export const GAME_TAG = '[game]';

// Server consoles (Linux and the management controller). Anything not listed is real.
const LINUX = [
  [/^power( status| cycle| reset| restart)?$/, 'fictional'], // real BMCs: ipmitool chassis power ...
  [/^console$/, 'fictional'], // real: the iDRAC/iLO web console or ipmitool sol activate
  [/^(logs|sel|event log)$/, 'fictional'], // real: ipmitool sel list or racadm getsel
  [/^boot( list| (order|first|set)\b.*)?$/, 'fictional'], // real: ipmitool chassis bootdev, BIOS setup
  [/^client( |-)?curl$|^test( from)? client$/, 'fictional'], // stands in for curl run from another machine
  [/^hint$/, 'fictional'],
  [/^reset$/, 'fictional'], // the real reset reinitialises the terminal; here it restarts the ticket
  [/^help$/, 'simplified'], // bash's help lists shell builtins; here it lists this ticket's commands
];

/** 'real' | 'simplified' | 'fictional' for a command typed in a server console. */
export function linuxKind(cmd) {
  const c = cmd.trim().replace(/\s+/g, ' ').replace(/^sudo /, '');
  return LINUX.find(([re]) => re.test(c))?.[1] ?? 'real';
}

/** The command with " [game]" after it unless it's real. */
export function tagged(cmd, kind) {
  return kind === 'real' ? cmd : `${cmd} ${GAME_TAG}`;
}
