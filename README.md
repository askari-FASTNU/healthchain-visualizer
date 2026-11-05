# HealthChain Visualizer

A GUI that shows, step by step, how a permissioned blockchain processes hospital transactions. It does not run on a real blockchain. Instead, it re-creates every stage a real one goes through and draws it in a trail on the left of the screen while you use a hospital app on the right.

The cryptography is real (SHA-256, Keccak-256, ECDSA on secp256k1, Merkle trees, proof of work). Every hash, signature and state root you see is actually computed, not mocked.

## Running it

**Quickest:** double-click `HealthChain-Visualizer.html`. It is a single self-contained file that works offline in Chrome, Edge, Firefox or Safari.

**From source** (Node 18 or newer):

```bash
cd healthchain-visualizer
npm install
npm run dev      # development server at http://localhost:5173
npm run build    # type-checks and writes dist/index.html (the single-file app)
```

The chain is saved in the browser, so it survives a page reload. **Reset** in the top bar rebuilds it from the genesis block.

## Screen layout

| Area | What it shows |
|---|---|
| **Blockchain trail** (left) | The 11 stages of the last transaction, animated one after another. Click any finished stage to reopen it. The drop-down lists earlier transactions. |
| **Chain ribbon** (top) | The latest blocks, linked. A new block slides in when one is committed. |
| **Hospital portal** | Pick who you are acting as (doctor, nurse, patient, lab, pharmacy, insurer or node admin) and perform an action. The patient chart on the right reads the current state. |
| **Smart contract** | The dynamic contract: permission grid, rule parameters, source code editor, version history with diffs. |
| **Ledger** | Block explorer, full-chain verification and the tamper lab. |
| **Network** | The four hospital validator nodes, consensus settings and attack scenarios. |
| **World state** | Contract storage, nonces, state root, off-chain documents and the audit log. |

Top bar controls: **PBFT / PoW** consensus, **speed** (0.5x to 4x), **step by step** (pauses after each stage until you press *Next step*, useful when presenting) and **other hospitals** (adds transactions from the other nodes so blocks have several transactions and a real Merkle tree).

## The 11 stages in the trail

| # | Stage | What is really computed |
|---|---|---|
| 1 | Build the transaction | Sender, nonce, method, arguments, timestamp. Medical documents are stored off-chain; only their SHA-256 goes in. |
| 2 | Fingerprint with SHA-256 | Canonical JSON (sorted keys) is hashed. Shows the avalanche effect by changing one digit. |
| 3 | Sign with the private key | ECDSA signature (r, s, v) on secp256k1, and how the address is derived from Keccak-256 of the public key. |
| 4 | Broadcast | The entry node gossips the transaction to its peers (animated network). |
| 5 | Every node verifies it | Each node recomputes the hash, recovers the signer from the signature, checks the nonce and network membership. |
| 6 | Mempool | The transaction waits with pending transactions from other hospitals. |
| 7 | Run the smart contract | The contract runs in a sandbox. The trace shows each `require()` line of contract code that passed or failed, the storage changes, events, estimated gas and the state root before and after. |
| 8 | Build the block | Merkle tree of the transaction hashes with your transaction's proof path highlighted, plus the block header. |
| 9 | Reach consensus | PBFT: the Castro–Liskov message diagram (pre-prepare, prepare, commit, reply) with n = 4, f = 1. PoW: four nodes race to find a nonce. |
| 10 | Link it to the chain | The new block's previous-hash field matches the last block's hash; every online node appends it and agrees on the state root. |
| 11 | Receipt | Status, block, gas, events. A reverted transaction is still recorded, which gives hospitals an audit trail of refused attempts. |

## The dynamic contract

You operate Node 1 (Northgate General Hospital) and hold the admin role, so you can change the contract in three ways. Each change is itself a transaction that goes through all 11 stages, so the trail shows the network agreeing on the new rules before they apply.

1. **Permissions.** A grid of contract methods against roles, stored on-chain in `policy.permissions` and enforced by `guard()` before every call. For example, tick *Nurse* for `emergencyAccess()`, then act as Nurse Sana and try it.
2. **Rules.** Parameters the code reads, such as patient consent on or off, the maximum daily dose, the claim auto-approve limit and the minimum length of an emergency reason.
3. **Source code.** Edit the JavaScript contract and deploy it as a new version. Storage carries over between versions (like a proxy upgrade). Three ready-made examples are included:
   - block controlled drugs for patients under 18 (then prescribe Tramadol to Bilal Ahmed, age 16)
   - make consent expire after a number of blocks (adds a new rule parameter)
   - add a new `referPatient()` method (it appears in the portal with a generated form)

The contract must be deterministic, so `Date` and `Math.random()` are blocked inside it. Code that loops forever is stopped after 1.5 seconds and reported as out of gas. The version history keeps every version with a line diff; loading an old version and deploying it is a rollback that creates a new version rather than rewriting history.

## Hospital actions

| Role | Actions |
|---|---|
| Node admin | Register a patient, onboard a staff member (creates a new wallet), submit an insurance claim, change the policy, upgrade the contract |
| Doctor | Add a record, open a record (logged), write a prescription (dose checked), emergency break-glass access (flagged) |
| Nurse | Open a record |
| Patient | Give or withdraw consent for a provider |
| Laboratory | Add a lab result |
| Pharmacy | Dispense a prescription (only once) |
| Insurer | Approve or reject a claim above the auto-approve limit |

Any role can also try an action it is not permitted to do, to show the contract refusing it.

## Attack and failure scenarios (Network tab)

- **Forged signature.** The transaction claims to be from one person but is signed with another key. Every node rejects it at verification.
- **One faulty hospital.** A Byzantine node sends wrong PREPARE and COMMIT messages. The three honest nodes still reach the quorum of 3.
- **Faulty primary.** The replicas detect conflicting PRE-PREPAREs and change view to the next primary.
- **Two hospitals offline.** Below the 2f + 1 quorum, PBFT commits nothing (safety over liveness). Offline nodes catch up when they return.
- **Tampering with history** (Ledger tab). Edit an old transaction in your copy: its hash, signature check, Merkle root and block hash all fail, the next block's link breaks, and the other three hospitals outvote your copy.
- **Edited off-chain document** (patient chart). Change a stored document and its SHA-256 no longer matches the on-chain fingerprint.

## A five-minute demo

1. Turn on **Step by step**. Act as Dr. Ayesha and **write a prescription** for Ali Raza. Walk through each stage with *Next step*.
2. Act as **Dr. Omar** and open Ali's record. The contract reverts it (no consent), and the failed attempt still lands in a block.
3. Act as **Ali Raza** and give consent to Dr. Omar. Repeat step 2: now it succeeds and appears in the access log.
4. On the **Smart contract** tab, lower the maximum daily dose to 1000 mg. Then prescribe Paracetamol 500 mg three times a day: it is refused.
5. Load the **controlled drugs** example, deploy it as v2, and prescribe Tramadol to Bilal Ahmed (16). Show the failing `require()` line in the trace and the diff under version history.
6. On the **Network** tab, make Summit faulty, then take two nodes offline, submitting a transaction each time.
7. Switch to **PoW** and submit once to show the mining race.
8. On the **Ledger** tab, tamper with an old prescription's dose and show the broken chain.

## What is simulated

This is a teaching tool, so a few parts are simplified, and the trail says so where it matters:

- All four nodes run inside one browser tab. Messages between them are simulated, not sent over a network.
- PBFT messages are modelled (who sends what, quorum counting, view change) but not individually signed.
- Gas is an estimate using Ethereum-like prices, to show that storage writes are the expensive part.
- The state root is the SHA-256 of the canonical world state, not a Merkle Patricia trie.
- Demo keys are derived from fixed seeds so the chain is reproducible. Real keys must be random.
- Off-chain documents are kept in the browser as plain text, to show the fingerprint check. A real system would encrypt them.

## Project structure

```
src/
  engine/                 blockchain logic, no UI
    crypto.ts             SHA-256, Keccak-256, secp256k1 sign / verify / recover
    chain.ts              transactions, block hashing, mining template, chain validation
    merkle.ts             Merkle tree and proofs
    consensus.ts          PBFT (n = 4, f = 1) and proof-of-work race
    sandbox.ts            contract sandbox (require, emit, guard, upgrade and migrate)
    sandbox.worker.ts     runs the sandbox in a Web Worker with a time limit
    runtime.ts            executes transactions, state diff, gas estimate, state root
    contractSource.ts     contract v1 and the example upgrades
    pipeline.ts           drives a transaction through the 11 stages
    background.ts         transactions from the other hospitals
    seed.ts               genesis block and starting history
    store.ts              application state
  ui/
    Trail.tsx, StageDetail.tsx   the left-hand trail
    components/visuals.tsx       network graph, Merkle tree, PBFT diagram
    tabs/                        portal, contract, ledger, network, world state
```

Built with React, TypeScript, Vite, CodeMirror and the audited `@noble/hashes` and `@noble/curves` libraries.
