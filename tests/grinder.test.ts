import { describe, it, expect } from "vitest";
import { blake2b } from "@noble/hashes/blake2b";
import { bytesToHex } from "@noble/hashes/utils";
import { u64LE, computePackageId, grindPackageId, validateGrindTarget } from "../src/grinder.js";

describe("u64LE", () => {
  it("encodes 0 as 8 zero bytes", () => {
    const result = u64LE(0);
    expect(result).toEqual(new Uint8Array(8));
    expect(result.length).toBe(8);
  });

  it("encodes 1 as [1, 0, 0, 0, 0, 0, 0, 0]", () => {
    const result = u64LE(1);
    expect(Array.from(result)).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("encodes 256 as [0, 1, 0, 0, 0, 0, 0, 0]", () => {
    const result = u64LE(256);
    expect(Array.from(result)).toEqual([0, 1, 0, 0, 0, 0, 0, 0]);
  });
});

describe("computePackageId", () => {
  it("produces expected hex for a known tx_digest", () => {
    // Deterministic test: use a fixed 32-byte digest, compute expected
    // package_id via the same algorithm inline (with 0xf1 scope byte).
    const txDigest = blake2b(new Uint8Array([1, 2, 3, 4]), { dkLen: 32 });

    // Expected: blake2b( 0xf1 || txDigest || u64_le(0) )
    const input = new Uint8Array(1 + 32 + 8);
    input[0] = 0xf1;
    input.set(txDigest, 1);
    // creation_index 0 → 8 zero bytes (already zeroed)
    const expectedHash = blake2b(input, { dkLen: 32 });
    const expectedHex = `0x${bytesToHex(expectedHash)}`;

    const result = computePackageId(txDigest, 0);
    expect(result).toBe(expectedHex);
    expect(result.length).toBe(66); // 0x + 64 hex chars
  });

  it("produces different IDs for different creation indices", () => {
    const txDigest = blake2b(new Uint8Array([5, 6, 7, 8]), { dkLen: 32 });
    const id0 = computePackageId(txDigest, 0);
    const id1 = computePackageId(txDigest, 1);
    expect(id0).not.toBe(id1);
  });
});

describe("grindPackageId", () => {
  it("finds a package ID ending with target '00' in reasonable iterations", () => {
    // Use a short 2-char hex target so the grind completes quickly (~256 avg).
    const result = grindPackageId({
      sender:
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      compiledModules: [
        // Minimal bytes encoded as base64
        Buffer.from([0, 1, 2, 3]).toString("base64"),
      ],
      dependencies: [
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      ],
      gasCoinObjectId:
        "0xabababababababababababababababababababababababababababababababab",
      gasCoinVersion: 1,
      gasCoinDigest: "11111111111111111111111111111111",
      gasPrice: 1000n,
      expirationEpoch: 100,
      target: "00",
    });

    expect(result.packageId.endsWith("00")).toBe(true);
    expect(result.packageId.startsWith("0x")).toBe(true);
    expect(result.packageId.length).toBe(66);
    expect(result.iterations).toBeGreaterThan(0);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.gasBudget).toBeGreaterThanOrEqual(500_000_000n);
  });

  it("returns a valid gasBudget that can be used verbatim", () => {
    const result = grindPackageId({
      sender:
        "0x0000000000000000000000000000000000000000000000000000000000000002",
      compiledModules: [
        Buffer.from([10, 20, 30]).toString("base64"),
      ],
      dependencies: [
        "0x0000000000000000000000000000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000000000000000000000000000002",
      ],
      gasCoinObjectId:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      gasCoinVersion: 42,
      gasCoinDigest: "11111111111111111111111111111111",
      gasPrice: 750n,
      expirationEpoch: 200,
      target: "00",
    });

    expect(typeof result.gasBudget).toBe("bigint");
    expect(result.gasBudget >= 500_000_000n).toBe(true);
  });

  it("grinds for arbitrary hex suffix 'b00b' (4 chars)", () => {
    const result = grindPackageId({
      sender:
        "0x0000000000000000000000000000000000000000000000000000000000000003",
      compiledModules: [
        Buffer.from([42, 43, 44]).toString("base64"),
      ],
      dependencies: [
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      ],
      gasCoinObjectId:
        "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      gasCoinVersion: 5,
      gasCoinDigest: "11111111111111111111111111111111",
      gasPrice: 1000n,
      expirationEpoch: 50,
      target: "b00b",
    });

    expect(result.packageId.endsWith("b00b")).toBe(true);
    expect(result.packageId.startsWith("0x")).toBe(true);
    expect(result.iterations).toBeGreaterThan(0);
  });
});

describe("validateGrindTarget", () => {
  it("accepts valid hex targets", () => {
    expect(() => validateGrindTarget("8888")).not.toThrow();
    expect(() => validateGrindTarget("b00b")).not.toThrow();
    expect(() => validateGrindTarget("9999")).not.toThrow();
    expect(() => validateGrindTarget("dead")).not.toThrow();
    expect(() => validateGrindTarget("00")).not.toThrow();
  });

  it("rejects empty target", () => {
    expect(() => validateGrindTarget("")).toThrow("at least 1 hex");
  });

  it("rejects non-hex characters", () => {
    expect(() => validateGrindTarget("xyz")).toThrow("lowercase hex");
    expect(() => validateGrindTarget("88gg")).toThrow("lowercase hex");
  });
});
