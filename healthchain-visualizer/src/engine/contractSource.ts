// Version 1 of the hospital smart contract, deployed in the genesis block.
// The person using the app can edit and redeploy it from the Smart contract tab.

export const DEFAULT_CONTRACT = `/*
 * HealthChain medical records contract
 *
 * Every hospital node runs this exact code for every transaction and must get
 * the same result, so the code has to be deterministic: no Date.now(),
 * no Math.random(), no network calls.
 *
 * Inside the contract you can use:
 *   state             contract storage, kept between transactions
 *   policy            { permissions, params }, changed by the node admin
 *   caller            { address, name, role, org } of whoever signed the transaction
 *   block             { number, timestamp } of the block being built
 *   require(ok, why)  revert the whole transaction if ok is false
 *   emit(name, data)  add an event to the receipt (the permanent audit log)
 *   hash(value)       SHA-256 of any value
 *
 * Patient data never goes on-chain. A record carries only the SHA-256
 * fingerprint of the document, which stays in the hospital's own storage.
 */

function hasConsent(patient, provider) {
  if (!policy.params.consentRequired) return true;
  const given = (state.consents[patient] || {})[provider];
  const emergency = (state.emergency[patient] || {})[provider];
  return Boolean(given || emergency);
}

function nextId(prefix, collection) {
  return prefix + "-" + (Object.keys(collection).length + 1);
}

contract({
  name: "MedicalRecords",

  // Written to storage at deployment. Keys added by a later upgrade are merged in;
  // values that already exist on-chain are kept.
  defaultPolicy: {
    permissions: {
      registerPatient: ["admin"],
      addMember: ["admin"],
      grantConsent: ["patient"],
      revokeConsent: ["patient"],
      addRecord: ["doctor", "lab"],
      accessRecord: ["doctor", "nurse"],
      emergencyAccess: ["doctor"],
      prescribe: ["doctor"],
      dispense: ["pharmacist"],
      submitClaim: ["admin"],
      reviewClaim: ["insurer"],
      updatePolicy: ["admin"],
    },
    params: {
      consentRequired: true,
      emergencyAccessEnabled: true,
      maxDailyDoseMg: 4000,
      claimAutoApproveLimit: 50000,
      minEmergencyReasonLength: 15,
    },
  },

  // Runs once, in the genesis block.
  init({ members }) {
    state.members = members;
    state.patients = {};
    state.consents = {};
    state.emergency = {};
    state.records = {};
    state.accessLog = [];
    state.prescriptions = {};
    state.claims = {};
  },

  // Runs before every method, like a Solidity modifier.
  guard(method) {
    const allowed = policy.permissions[method] || [];
    require(allowed.includes(caller.role), \`Role "\${caller.role}" may not call \${method}()\`);
  },

  methods: {
    registerPatient({ patient, name, age, bloodGroup }) {
      require(state.members[patient], "That wallet is not on the network");
      require(state.members[patient].role === "patient", "That wallet does not belong to a patient");
      require(!state.patients[patient], "Patient is already registered");
      state.patients[patient] = { name, age, bloodGroup, registeredBy: caller.org, block: block.number };
      emit("PatientRegistered", { patient, name });
    },

    addMember({ address, name, role, org }) {
      const roles = ["admin", "doctor", "nurse", "patient", "lab", "pharmacist", "insurer"];
      require(roles.includes(role), \`Unknown role "\${role}"\`);
      require(!state.members[address], "Address is already a member");
      state.members[address] = { name, role, org };
      emit("MemberAdded", { address, name, role });
    },

    grantConsent({ provider }) {
      require(state.patients[caller.address], "Only a registered patient can give consent");
      require(state.members[provider], "Provider is not on the network");
      require(provider !== caller.address, "You cannot give consent to yourself");
      state.consents[caller.address] = state.consents[caller.address] || {};
      state.consents[caller.address][provider] = { block: block.number };
      emit("ConsentGranted", { patient: caller.address, provider });
    },

    revokeConsent({ provider }) {
      const given = state.consents[caller.address] || {};
      require(given[provider], "There is no consent to revoke for this provider");
      delete given[provider];
      emit("ConsentRevoked", { patient: caller.address, provider });
    },

    addRecord({ patient, kind, title, dataHash, storageRef }) {
      require(state.patients[patient], "Unknown patient");
      require(hasConsent(patient, caller.address), "Patient has not given you consent");
      require(/^[0-9a-f]{64}$/.test(dataHash), "dataHash must be a SHA-256 fingerprint, not patient data");
      const id = nextId("REC", state.records);
      state.records[id] = { patient, kind, title, dataHash, storageRef, author: caller.address, block: block.number };
      emit("RecordAdded", { id, patient, kind });
    },

    accessRecord({ recordId, reason }) {
      const record = state.records[recordId];
      require(record, "Record not found");
      require(hasConsent(record.patient, caller.address), "No consent from the patient. Access denied");
      state.accessLog.push({ recordId, by: caller.address, reason, block: block.number });
      emit("RecordAccessed", { recordId, by: caller.name, reason });
    },

    emergencyAccess({ patient, reason }) {
      require(policy.params.emergencyAccessEnabled, "Emergency access is switched off by policy");
      require(state.patients[patient], "Unknown patient");
      const min = policy.params.minEmergencyReasonLength;
      require((reason || "").length >= min, \`Give a reason of at least \${min} characters\`);
      state.emergency[patient] = state.emergency[patient] || {};
      state.emergency[patient][caller.address] = { reason, block: block.number };
      emit("EmergencyAccess", { patient, by: caller.name, reason, flaggedForReview: true });
    },

    prescribe({ patient, drug, doseMg, timesPerDay, days }) {
      require(state.patients[patient], "Unknown patient");
      require(hasConsent(patient, caller.address), "Patient has not given you consent");
      const daily = doseMg * timesPerDay;
      const limit = policy.params.maxDailyDoseMg;
      require(daily <= limit, \`Daily dose \${daily} mg is above the \${limit} mg safety limit\`);
      const id = nextId("RX", state.prescriptions);
      state.prescriptions[id] = {
        patient, drug, doseMg, timesPerDay, days,
        doctor: caller.address, status: "active", block: block.number,
      };
      emit("Prescribed", { id, patient, drug, dailyMg: daily });
    },

    dispense({ prescriptionId }) {
      const rx = state.prescriptions[prescriptionId];
      require(rx, "Prescription not found");
      require(rx.status === "active", \`Prescription is already \${rx.status}\`);
      rx.status = "dispensed";
      rx.dispensedBy = caller.address;
      emit("Dispensed", { id: prescriptionId, by: caller.name });
    },

    submitClaim({ patient, amount, description }) {
      require(state.patients[patient], "Unknown patient");
      require(amount > 0, "Claim amount must be above zero");
      const id = nextId("CLM", state.claims);
      const auto = amount <= policy.params.claimAutoApproveLimit;
      state.claims[id] = {
        patient, amount, description, hospital: caller.org,
        status: auto ? "approved" : "pending review", block: block.number,
      };
      emit(auto ? "ClaimAutoApproved" : "ClaimNeedsReview", { id, amount });
    },

    reviewClaim({ claimId, approve }) {
      const claim = state.claims[claimId];
      require(claim, "Claim not found");
      require(claim.status === "pending review", \`Claim is \${claim.status}, not waiting for review\`);
      claim.status = approve ? "approved" : "rejected";
      claim.reviewedBy = caller.org;
      emit("ClaimReviewed", { id: claimId, status: claim.status });
    },

    updatePolicy({ permissions, params }) {
      if (permissions) Object.assign(policy.permissions, permissions);
      if (params) Object.assign(policy.params, params);
      emit("PolicyUpdated", {
        permissions: Object.keys(permissions || {}),
        params: Object.keys(params || {}),
      });
    },
  },
});
`;

export interface ContractExample {
  id: string;
  title: string;
  description: string;
  apply: (source: string) => string | null;
}

/** Ready-made edits for the source editor, to show how a code upgrade changes behaviour. */
export const CONTRACT_EXAMPLES: ContractExample[] = [
  {
    id: 'controlled',
    title: 'Block controlled drugs for under-18 patients',
    description: 'Adds a new rule inside prescribe(). Try prescribing Tramadol to a patient younger than 18 afterwards.',
    apply: (src) => {
      const anchor = '      const daily = doseMg * timesPerDay;';
      if (!src.includes(anchor) || src.includes('controlled drug')) return null;
      return src.replace(
        anchor,
        `      const controlled = ["Morphine", "Oxycodone", "Fentanyl", "Tramadol"];
      require(!(controlled.includes(drug) && state.patients[patient].age < 18),
        \`\${drug} is a controlled drug and cannot be prescribed to a patient under 18\`);
${anchor}`,
      );
    },
  },
  {
    id: 'expiry',
    title: 'Make consent expire after a number of blocks',
    description: 'Changes hasConsent() and adds a new policy parameter, consentValidityBlocks, which appears on the Rules screen after the upgrade.',
    apply: (src) => {
      const fnAnchor = '  const given = (state.consents[patient] || {})[provider];';
      const paramAnchor = '      minEmergencyReasonLength: 15,';
      if (!src.includes(fnAnchor) || !src.includes(paramAnchor) || src.includes('consentValidityBlocks')) return null;
      return src
        .replace(
          fnAnchor,
          `${fnAnchor}
  if (given && block.number - given.block > policy.params.consentValidityBlocks) return false;`,
        )
        .replace(paramAnchor, `${paramAnchor}\n      consentValidityBlocks: 20,`);
    },
  },
  {
    id: 'referral',
    title: 'Add a new method: referPatient()',
    description: 'Adds a referral feature. The new method gets a default permission for doctors and shows up under "Call any contract method" in the portal.',
    apply: (src) => {
      const methodsAnchor = '    updatePolicy({ permissions, params }) {';
      const permAnchor = '      updatePolicy: ["admin"],';
      const initAnchor = '    state.claims = {};';
      if (!src.includes(methodsAnchor) || src.includes('referPatient')) return null;
      return src
        .replace(permAnchor, `${permAnchor}\n      referPatient: ["doctor"],`)
        .replace(initAnchor, `${initAnchor}\n    state.referrals = {};`)
        .replace(
          methodsAnchor,
          `    referPatient({ patient, toProvider, note }) {
      require(state.patients[patient], "Unknown patient");
      require(hasConsent(patient, caller.address), "Patient has not given you consent");
      require(state.members[toProvider], "Receiving provider is not on the network");
      state.referrals = state.referrals || {};
      const id = nextId("REF", state.referrals);
      state.referrals[id] = { patient, from: caller.address, to: toProvider, note, block: block.number };
      emit("PatientReferred", { id, patient, to: state.members[toProvider].name });
    },

${methodsAnchor}`,
        );
    },
  },
];
