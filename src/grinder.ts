import { blake2b } from "@noble/hashes/blake2b";
import { bytesToHex } from "@noble/hashes/utils";
import { bcs } from "@mysten/sui/bcs";
import { fromBase64 } from "@mysten/sui/utils";
import { CREATION_INDEX, GAS_BUDGET_FLOOR } from "./constants.js";

const HEX_RE = /^[0-9a-f]+$/i;

/** Validate that `target` is a non-empty hex string (valid package ID suffix). */
export function validateGrindTarget(target: string): void {
  if (target.length === 0) {
    throw new Error("Grind target must be at least 1 hex character");
  }
  if (!HEX_RE.test(target)) {
    throw new Error(
      `Grind target must be lowercase hex characters [0-9a-f], got "${target}"`,
    );
  }
}

export interface GrindParams {
  sender: string;
  compiledModules: string[];
  dependencies: string[];
  gasCoinObjectId: string;
  gasCoinVersion: number;
  gasCoinDigest: string;
  gasPrice: bigint;
  expirationEpoch: number;
  target: string;
}

export interface GrindResult {
  gasBudget: bigint;
  packageId: string;
  iterations: number;
  elapsedMs: number;
}

/** Encode a non-negative integer as 8-byte little-endian. */
export function u64LE(n: number): Uint8Array {
  const buf = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

function bigintToU64LE(n: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  let v = n;
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Compute a Sui object ID from a transaction digest and creation index.
 *
 *   object_id = blake2b-256( tx_digest || u64_le(creation_index) )
 */
export function computePackageId(
  txDigest: Uint8Array,
  creationIndex: number,
): string {
  const input = concat(txDigest, u64LE(creationIndex));
  const hash = blake2b(input, { dkLen: 32 });
  return `0x${bytesToHex(hash)}`;
}

/**
 * Build the BCS-serialized TransactionData for a Publish transaction.
 * Matches Sui's exact wire format: TransactionData::V1 with a single
 * ProgrammableTransaction containing one Publish command.
 */
function serializePublishTxData(
  params: GrindParams,
  gasBudget: bigint,
): Uint8Array {
  const modules = params.compiledModules.map((m) => fromBase64(m));

  const txDataValue = {
    V1: {
      kind: {
        ProgrammableTransaction: {
          inputs: [] as never[],
          commands: [
            {
              Publish: {
                modules,
                dependencies: params.dependencies,
              },
            },
          ],
        },
      },
      sender: params.sender,
      gasData: {
        payment: [
          {
            objectId: params.gasCoinObjectId,
            version: String(params.gasCoinVersion),
            digest: params.gasCoinDigest,
          },
        ],
        owner: params.sender,
        price: String(params.gasPrice),
        budget: String(gasBudget),
      },
      expiration: {
        Epoch: String(params.expirationEpoch),
      },
    },
  };

  return bcs.TransactionData.serialize(txDataValue).toBytes();
}

/**
 * Grind for a Sui package ID whose hex representation ends with `target`.
 *
 * The only tuneable value is `gasBudget`; every other field stays fixed so
 * the BCS serialisation is done once and only the 8 budget bytes are patched
 * each iteration before re-hashing.
 *
 * Algorithm:
 *   tx_digest  = blake2b-256( intent_prefix || bcs(TransactionData) )
 *   package_id = blake2b-256( tx_digest || u64_le(creation_index) )
 *
 * intent_prefix = [0x00, 0x00, 0x00]  (TransactionData scope, V0, Sui)
 */
export function grindPackageId(params: GrindParams): GrindResult {
  validateGrindTarget(params.target);

  // Use a distinctive marker to locate the gasBudget bytes after serialisation.
  const MARKER_BUDGET = 0xdeadbeefdeadbeefn;
  const bcsBytes = serializePublishTxData(params, MARKER_BUDGET);

  // Build the intent message: [scope=0, version=0, appId=0] || bcs_bytes
  const intentBytes = new Uint8Array(3 + bcsBytes.length);
  // intentBytes[0..2] are already 0 (TransactionData, V0, Sui)
  intentBytes.set(bcsBytes, 3);

  // Locate the 8-byte marker inside the intent message so we can patch in-place.
  const markerBytes = bigintToU64LE(MARKER_BUDGET);
  const budgetOffset = findBytes(intentBytes, markerBytes);
  if (budgetOffset === -1) {
    throw new Error(
      "Failed to locate gasBudget marker in serialized TransactionData",
    );
  }

  const creationSuffix = u64LE(CREATION_INDEX);

  let budget = params.gasPrice > GAS_BUDGET_FLOOR
    ? params.gasPrice
    : GAS_BUDGET_FLOOR;
  let iterations = 0;
  const start = performance.now();

  while (true) {
    // Patch the budget bytes directly in the pre-built intent message.
    intentBytes.set(bigintToU64LE(budget), budgetOffset);

    // tx_digest = blake2b-256( intent_message )
    const txDigest = blake2b(intentBytes, { dkLen: 32 });

    // package_id = blake2b-256( tx_digest || u64_le(creation_index) )
    const packageIdBytes = blake2b(concat(txDigest, creationSuffix), {
      dkLen: 32,
    });
    const hex = bytesToHex(packageIdBytes);

    iterations++;

    if (hex.endsWith(params.target)) {
      const elapsedMs = performance.now() - start;
      console.log(
        `[grinder] found 0x${hex} in ${iterations} iterations (${Math.round(elapsedMs)}ms)`,
      );
      return {
        gasBudget: budget,
        packageId: `0x${hex}`,
        iterations,
        elapsedMs,
      };
    }

    if (iterations % 10_000 === 0) {
      console.log(
        `[grinder] iter=${iterations} latest=0x${hex.slice(0, 8)}...${hex.slice(-8)}`,
      );
    }

    budget += 1n;
  }
}
