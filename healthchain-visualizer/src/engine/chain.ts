// Transactions, blocks, proof of work and full-chain validation.
import { canonical, recoverPublicKey, addressFromPublicKey, sha256Hex, sign } from './crypto';
import { buildMerkleTree } from './merkle';
import { CHAIN_ID } from './actors';
import type { Block, BlockHeader, SignedTx, TxType, UnsignedTx } from './types';

export const ZERO_HASH = '0'.repeat(64);

export function makeUnsigned(p: { type: TxType; from: string; nonce: number; method?: string; args?: unknown; source?: string; note?: string; timestamp?: number }): UnsignedTx {
  return {
    chainId: CHAIN_ID,
    type: p.type,
    from: p.from,
    nonce: p.nonce,
    method: p.method,
    args: p.args,
    source: p.source,
    note: p.note,
    timestamp: p.timestamp ?? Date.now(),
  };
}

export function unsignedPart(tx: SignedTx | UnsignedTx): UnsignedTx {
  const { chainId, type, from, nonce, method, args, source, note, timestamp } = tx;
  return { chainId, type, from, nonce, method, args, source, note, timestamp };
}

export function txHash(tx: UnsignedTx): string {
  return sha256Hex(canonical(unsignedPart(tx)));
}

export function signTx(unsigned: UnsignedTx, privateKey: string): SignedTx {
  const hash = txHash(unsigned);
  return { ...unsigned, hash, signature: sign(hash, privateKey) };
}

/** Who actually signed this transaction, according to the signature alone. */
export function recoverSigner(tx: SignedTx): string | null {
  const pub = recoverPublicKey(tx.hash, tx.signature);
  return pub ? addressFromPublicKey(pub) : null;
}

export function blockHash(h: BlockHeader): string {
  return sha256Hex(canonical(h));
}

/** Pieces of the header string around the nonce, so mining only re-hashes with a new number. */
export function miningTemplate(h: BlockHeader): { prefix: string; suffix: string } {
  const marker = canonical({ ...h, nonce: -987654321 });
  const [prefix, suffix] = marker.split('-987654321');
  return { prefix, suffix };
}

export function meetsTarget(hash: string, difficulty: number): boolean {
  for (let i = 0; i < difficulty; i++) if (hash[i] !== '0') return false;
  return true;
}

export interface BlockCheck {
  number: number;
  txHashesOk: boolean;
  signaturesOk: boolean;
  merkleOk: boolean;
  hashOk: boolean;
  linkOk: boolean;
  powOk: boolean;
  computedHash: string;
  computedMerkle: string;
  problems: string[];
}

/** Re-check every block the way a node does when it downloads the chain. */
export function validateChain(blocks: Block[]): BlockCheck[] {
  const results: BlockCheck[] = [];
  let prev = ZERO_HASH;
  for (const b of blocks) {
    const problems: string[] = [];
    const recomputed = b.txs.map((t) => sha256Hex(canonical(unsignedPart(t))));
    const txHashesOk = recomputed.every((h, i) => h === b.txs[i].hash);
    if (!txHashesOk) problems.push('A transaction no longer matches its hash: its contents were changed');
    const signaturesOk = b.txs.every((t, i) => {
      const pub = recoverPublicKey(recomputed[i], t.signature);
      return pub !== null && addressFromPublicKey(pub) === t.from;
    });
    if (!signaturesOk) problems.push('A signature does not match the transaction contents');
    const computedMerkle = buildMerkleTree(recomputed).root;
    const merkleOk = computedMerkle === b.header.merkleRoot;
    if (!merkleOk) problems.push('Merkle root in the header does not match the transactions');
    const header = { ...b.header, merkleRoot: computedMerkle };
    const computedHash = blockHash(header);
    const hashOk = computedHash === b.hash;
    if (!hashOk) problems.push('Block hash changed');
    const linkOk = b.header.prevHash === prev;
    if (!linkOk) problems.push('Previous-hash link is broken');
    const powOk = b.header.consensus !== 'pow' || meetsTarget(computedHash, b.header.difficulty);
    if (!powOk) problems.push('Proof of work no longer meets the difficulty target');
    results.push({ number: b.header.number, txHashesOk, signaturesOk, merkleOk, hashOk, linkOk, powOk, computedHash, computedMerkle, problems });
    prev = computedHash;
  }
  return results;
}
