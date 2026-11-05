// Shared physical dimensions (metres). Rack-local space: origin at floor centre
// of the rack, +z is the front face, +x is "right" when facing the front.

export const U = 0.04445; // one rack unit
export const RACK = { width: 0.6, height: 2.0, depth: 1.07 };
export const RAIL_BASE = 0.05; // height of the bottom of U1
export const RACK_HEADER_Y = 1.96; // centre of the top header (label plate)

export const SERVER_WIDTH = 0.44;
export const SERVER_DEPTH = 0.7;
export const SERVER_FRONT_Z = 0.47;
export const NIC_X = 0.1;
export const STATUS_LED_X = [-0.19, -0.172];
export const statusLedDy = (units) => (units === 1 ? 0.008 : 0.03);

export const TOR_U = 42;
export const torPortX = (i) => -0.17 + (i % 24) * 0.0115;
export const TOR_ROW_DY = 0.009;
export const TOR_LED_DY = 0.0185;
export const sfpCageX = (i) => 0.118 + i * 0.019; // 4 uplink cages (ports 49-52) on the TOR switch
export const SFP_LED_DY = 0.0165;

export const ROOM = { minX: -4.2, maxX: 4.2, minZ: -7.2, maxZ: 7.2, height: 3.6 };

// Helpdesk wing: a doorway in the server room's +z wall, a corridor, then the office.
export const DOORWAY = { x: -2.6, width: 1.0, height: 2.1 };
export const CORRIDOR = { minX: -3.3, maxX: -1.9, minZ: ROOM.maxZ, maxZ: ROOM.maxZ + 3, height: 2.6 };
export const OFFICE = { minX: -6.2, maxX: 0.6, minZ: ROOM.maxZ + 3, maxZ: ROOM.maxZ + 8, height: 2.8 };
export const WORLD_BOUNDS = { minX: OFFICE.minX - 0.3, maxX: ROOM.maxX + 0.3, minZ: ROOM.minZ - 0.3, maxZ: OFFICE.maxZ + 0.3 };
