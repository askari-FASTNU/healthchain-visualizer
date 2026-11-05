// Demo participants and the four hospital validator nodes.
import { keyPairFromSeed } from './crypto';
import type { Actor, HospitalNode, Role } from './types';

export const CHAIN_ID = 'healthchain-1';

export const INITIAL_NODES: HospitalNode[] = [
  { id: 1, name: 'Northgate General Hospital', short: 'Northgate', online: true, byzantine: false, height: 0 },
  { id: 2, name: 'Harbor Medical Center', short: 'Harbor', online: true, byzantine: false, height: 0 },
  { id: 3, name: 'Riverside Clinic', short: 'Riverside', online: true, byzantine: false, height: 0 },
  { id: 4, name: "Summit Children's Hospital", short: 'Summit', online: true, byzantine: false, height: 0 },
];

/** The node the person using this app operates. */
export const MY_NODE_ID = 1;

const SEED: { id: string; name: string; role: Role; org: string; nodeId: number }[] = [
  { id: 'admin', name: 'You (node admin)', role: 'admin', org: 'Northgate General Hospital', nodeId: 1 },
  { id: 'ayesha', name: 'Dr. Ayesha Siddiqui', role: 'doctor', org: 'Northgate General Hospital', nodeId: 1 },
  { id: 'sana', name: 'Nurse Sana Iqbal', role: 'nurse', org: 'Northgate General Hospital', nodeId: 1 },
  { id: 'omar', name: 'Dr. Omar Farooq', role: 'doctor', org: 'Harbor Medical Center', nodeId: 2 },
  { id: 'ali', name: 'Ali Raza', role: 'patient', org: 'Patient', nodeId: 1 },
  { id: 'fatima', name: 'Fatima Noor', role: 'patient', org: 'Patient', nodeId: 2 },
  { id: 'bilal', name: 'Bilal Ahmed', role: 'patient', org: 'Patient', nodeId: 4 },
  { id: 'meridian', name: 'Meridian Diagnostics', role: 'lab', org: 'Meridian Diagnostics', nodeId: 3 },
  { id: 'crescent', name: 'Crescent Pharmacy', role: 'pharmacist', org: 'Crescent Pharmacy', nodeId: 3 },
  { id: 'unity', name: 'Unity Health Insurance', role: 'insurer', org: 'Unity Health Insurance', nodeId: 4 },
];

export function createDemoActors(): Actor[] {
  return SEED.map((s) => ({ ...s, ...keyPairFromSeed(s.id) }));
}

/** Someone outside the network, used for the forged-signature scenario. */
export function createAttacker() {
  return { name: 'Unknown attacker', ...keyPairFromSeed('attacker') };
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Node admin',
  doctor: 'Doctor',
  nurse: 'Nurse',
  patient: 'Patient',
  lab: 'Laboratory',
  pharmacist: 'Pharmacy',
  insurer: 'Insurer',
};
