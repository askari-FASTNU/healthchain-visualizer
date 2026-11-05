// Real cryptography: SHA-256, Keccak-256 and ECDSA on secp256k1 (the curve used by Bitcoin and Ethereum).
import { sha256 as nobleSha256 } from '@noble/hashes/sha256';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { secp256k1 } from '@noble/curves/secp256k1';
import type { Signature } from './types';

export { bytesToHex, hexToBytes };

/** JSON with object keys sorted, so every node serialises the same data to the same bytes. */
export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = sortKeys(val);
    }
    return out;
  }
  return v;
}

export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? utf8ToBytes(input) : input;
  return bytesToHex(nobleSha256(bytes));
}

export function hashValue(value: unknown): string {
  return sha256Hex(canonical(value));
}

export function keyPairFromSeed(seed: string) {
  // Demo keys are derived from a fixed seed so the chain is reproducible. Never do this for real keys.
  let priv = nobleSha256(utf8ToBytes('healthchain-demo-key:' + seed));
  // A valid private key must be below the curve order; with SHA-256 output that is almost always true.
  if (!secp256k1.utils.isValidPrivateKey(priv)) priv = nobleSha256(priv);
  const pub = secp256k1.getPublicKey(priv, false);
  return { privateKey: bytesToHex(priv), publicKey: bytesToHex(pub), address: addressFromPublicKey(bytesToHex(pub)) };
}

export function randomKeyPair() {
  const priv = secp256k1.utils.randomPrivateKey();
  const pub = secp256k1.getPublicKey(priv, false);
  return { privateKey: bytesToHex(priv), publicKey: bytesToHex(pub), address: addressFromPublicKey(bytesToHex(pub)) };
}

/** Ethereum-style address: last 20 bytes of Keccak-256 of the public key (without the 0x04 prefix). */
export function addressFromPublicKey(pubHex: string): string {
  const pub = hexToBytes(pubHex);
  const body = pub.length === 65 ? pub.slice(1) : pub;
  return '0x' + bytesToHex(keccak_256(body)).slice(-40);
}

export function keccakHex(pubHex: string): string {
  const pub = hexToBytes(pubHex);
  return bytesToHex(keccak_256(pub.length === 65 ? pub.slice(1) : pub));
}

export function sign(hashHex: string, privateKeyHex: string): Signature {
  const sig = secp256k1.sign(hexToBytes(hashHex), hexToBytes(privateKeyHex));
  return { r: sig.r.toString(16).padStart(64, '0'), s: sig.s.toString(16).padStart(64, '0'), v: sig.recovery };
}

/** Recover the signer's public key from the signature (as Ethereum nodes do). */
export function recoverPublicKey(hashHex: string, sig: Signature): string | null {
  try {
    const s = new secp256k1.Signature(BigInt('0x' + sig.r), BigInt('0x' + sig.s)).addRecoveryBit(sig.v);
    return s.recoverPublicKey(hexToBytes(hashHex)).toHex(false);
  } catch {
    return null;
  }
}

export function verify(hashHex: string, sig: Signature, publicKeyHex: string): boolean {
  try {
    const s = new secp256k1.Signature(BigInt('0x' + sig.r), BigInt('0x' + sig.s));
    return secp256k1.verify(s.toBytes('compact'), hexToBytes(hashHex), hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

export function short(hex: string | undefined, n = 6): string {
  if (!hex) return '';
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length <= n * 2 + 1) return hex;
  return (hex.startsWith('0x') ? '0x' : '') + clean.slice(0, n) + '…' + clean.slice(-4);
}
