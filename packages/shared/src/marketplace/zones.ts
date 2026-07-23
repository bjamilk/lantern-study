export const NIGERIAN_GEOPOLITICAL_ZONES = [
  'North Central',
  'North East',
  'North West',
  'South East',
  'South South',
  'South West',
] as const;

export type NigerianGeopoliticalZone = (typeof NIGERIAN_GEOPOLITICAL_ZONES)[number];

const NIGERIAN_STATE_ZONE: Record<string, NigerianGeopoliticalZone> = {
  abia: 'South East',
  adamawa: 'North East',
  'akwa ibom': 'South South',
  anambra: 'South East',
  bauchi: 'North East',
  bayelsa: 'South South',
  benue: 'North Central',
  borno: 'North East',
  'cross river': 'South South',
  delta: 'South South',
  ebonyi: 'South East',
  edo: 'South South',
  ekiti: 'South West',
  enugu: 'South East',
  fct: 'North Central',
  'federal capital territory': 'North Central',
  abuja: 'North Central',
  gombe: 'North East',
  imo: 'South East',
  jigawa: 'North West',
  kaduna: 'North West',
  kano: 'North West',
  katsina: 'North West',
  kebbi: 'North West',
  kogi: 'North Central',
  kwara: 'North Central',
  lagos: 'South West',
  nasarawa: 'North Central',
  niger: 'North Central',
  ogun: 'South West',
  ondo: 'South West',
  osun: 'South West',
  oyo: 'South West',
  plateau: 'North Central',
  rivers: 'South South',
  sokoto: 'North West',
  taraba: 'North East',
  yobe: 'North East',
  zamfara: 'North West',
};

export function resolveNigerianGeopoliticalZone(
  state?: string | null
): NigerianGeopoliticalZone | null {
  if (!state) return null;
  return NIGERIAN_STATE_ZONE[state.trim().toLowerCase()] || null;
}
