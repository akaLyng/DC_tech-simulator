// Spare parts on the shelf by the door. A case asks for a type and a variant;
// anything else in your hand is rejected with an explanation.

export const PARTS = {
  'hdd-1tb': { type: 'disk', variant: '1TB', label: 'HDD 1 TB', spec: '3.5" 7.2k SATA', color: 0x30343a, shape: 'disk' },
  'ssd-480': { type: 'disk', variant: '480GB', label: 'SSD 480 GB', spec: '2.5" SATA', color: 0x5a6470, shape: 'ssd' },
  'psu-800': { type: 'psu', variant: '800W', label: 'PSU 800 W', spec: 'Hot-swap, 80+ Platinum', color: 0x454b52, shape: 'psu' },
  'psu-1100': { type: 'psu', variant: '1100W', label: 'PSU 1100 W', spec: 'Hot-swap, 80+ Titanium', color: 0x2c3036, shape: 'psu' },
  'sfp-10g': { type: 'sfp', variant: '10G', label: 'SFP+ 10G SR', spec: '850 nm, LC, multimode', color: 0x3c7bd6, shape: 'sfp' },
  'sfp-25g': { type: 'sfp', variant: '25G', label: 'SFP28 25G SR', spec: '850 nm, LC, multimode', color: 0x9b6bd6, shape: 'sfp' },
  'cat6': { type: 'cable', variant: 'cat6', label: 'Cat6 patch cable', spec: 'Copper, RJ45, 2 m', color: 0x2f6fe0, shape: 'coil' },
  'fiber-om4': { type: 'cable', variant: 'fiber', label: 'OM4 fiber patch', spec: 'LC-LC duplex, 3 m', color: 0x2ec4c9, shape: 'coil' },
};

// Shelf layout, top to bottom: two bins per level.
export const SHELF_LEVELS = [
  ['sfp-10g', 'sfp-25g'],
  ['cat6', 'fiber-om4'],
  ['psu-800', 'psu-1100'],
  ['hdd-1tb', 'ssd-480'],
];

const TYPE_NAMES = { disk: 'a disk', psu: 'a power supply', sfp: 'an SFP module', cable: 'a patch cable' };

/**
 * Check what the player is holding against what a job needs.
 * Returns null when it fits; otherwise output lines (and records a mistake if
 * the player tried to use the wrong thing, as opposed to having empty hands).
 */
export function checkPart(hand, want, L) {
  const part = hand.part;
  if (!part) return L(`You need ${want.label} for this. Spares are on the parts shelf by the exit.`, 'o-warn');
  if (part.type !== want.type) {
    hand.mistake(`Tried to fit ${part.label} where ${TYPE_NAMES[want.type]} goes`);
    return L(`That's ${TYPE_NAMES[part.type]} (${part.label}). This job needs ${want.label}.`, 'o-err');
  }
  if (part.variant !== want.variant) {
    hand.mistake(`Wrong variant: ${part.label} instead of ${want.label}`);
    return L(`Wrong part: you're holding ${part.label}, but this needs ${want.label}. ${want.why || ''}`.trim(), 'o-err');
  }
  return null;
}
