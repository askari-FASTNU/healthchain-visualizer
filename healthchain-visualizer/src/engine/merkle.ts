// Bitcoin-style Merkle tree: hash pairs of transaction hashes until one root remains.
// With an odd number of nodes on a level, the last one is paired with itself.
import { sha256Hex } from './crypto';

export interface MerkleTree {
  levels: string[][]; // levels[0] = leaves (tx hashes), last level = [root]
  root: string;
}

export function buildMerkleTree(leaves: string[]): MerkleTree {
  if (leaves.length === 0) {
    const empty = sha256Hex('');
    return { levels: [[empty]], root: empty };
  }
  const levels: string[][] = [leaves.slice()];
  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1];
    const next: string[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      const left = prev[i];
      const right = prev[i + 1] ?? prev[i];
      next.push(sha256Hex(left + right));
    }
    levels.push(next);
  }
  return { levels, root: levels[levels.length - 1][0] };
}

/** The sibling hashes needed to prove one leaf is in the tree (a Merkle proof). */
export function merkleProof(tree: MerkleTree, leafIndex: number): { level: number; index: number; hash: string; side: 'left' | 'right' }[] {
  const proof: { level: number; index: number; hash: string; side: 'left' | 'right' }[] = [];
  let idx = leafIndex;
  for (let l = 0; l < tree.levels.length - 1; l++) {
    const level = tree.levels[l];
    const isRight = idx % 2 === 1;
    const sibIdx = isRight ? idx - 1 : Math.min(idx + 1, level.length - 1);
    proof.push({ level: l, index: sibIdx, hash: level[sibIdx], side: isRight ? 'left' : 'right' });
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/** Indices on each level that lie on the path from a leaf to the root. */
export function merklePath(tree: MerkleTree, leafIndex: number): number[] {
  const path: number[] = [];
  let idx = leafIndex;
  for (let l = 0; l < tree.levels.length; l++) {
    path.push(idx);
    idx = Math.floor(idx / 2);
  }
  return path;
}
