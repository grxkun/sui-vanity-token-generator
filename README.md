# Sui Vanity Token Generator

Deploy tokens on [Sui](https://sui.io) with a **custom hex suffix** on the package ID. The grinder brute-forces the `gasBudget` until the resulting package address ends with your chosen vanity suffix.

**Example** — our `$VANITY` token landed package ID ending in `b00b`:

```
0x6d73126f7f8f9a2a8f08503b4b8af1d9984cd80a19cebeeeb346517f0606b00b
```

> [View on SuiScan](https://suiscan.xyz/mainnet/tx/4zPqHx5wS7Xy9ahiJZhjCTTZNzsXMAqkTnPq1eR3HUy2)

---

## How It Works

Sui derives a package ID deterministically from the transaction digest:

```
tx_digest  = blake2b("TransactionData::" || bcs_bytes)
package_id = blake2b(0xf1 || tx_digest || u64_le(creation_index))
```

Since `gasBudget` is part of the BCS-serialized transaction data, changing it changes the package ID. The grinder patches the 8 budget bytes in-place each iteration — no re-serialization needed — making it fast enough to find 4-char suffixes in seconds.

| Suffix Length | Expected Iterations | ~Time   |
|---------------|--------------------:|---------|
| 2 chars (1 byte) | ~256 | instant |
| 4 chars (2 bytes) | ~65,536 | 1–5s |
| 6 chars (3 bytes) | ~16.7M | minutes |
| 8 chars (4 bytes) | ~4.3B | hours |

---

## Quick Start

```bash
git clone https://github.com/grxkun/sui-vanity-token-generator.git
cd sui-vanity-token-generator
npm install
npm test
```

---

## Deploy Your Own Token

### 1. Install the Sui CLI

Follow the [Sui CLI install guide](https://docs.sui.io/guides/developer/getting-started/sui-install), then set up a wallet:

```bash
sui client new-address ed25519
sui client switch --address <NEW_ADDRESS>
```

Send SUI to the new address for gas (~1 SUI is enough).

### 2. Deploy — one command

```bash
# Deploy $FOILED with package ID ending in b00b
npx tsx src/deploy.ts FOILED --suffix b00b

# Deploy $PEPE with package ID ending in dead
npx tsx src/deploy.ts PEPE --suffix dead

# Deploy $VANITY with the default suffix (b00b)
npx tsx src/deploy.ts VANITY

# Dry run first (grinds but doesn't submit)
npx tsx src/deploy.ts FOILED --suffix b00b --dry

# Deploy to testnet
npx tsx src/deploy.ts FOILED --suffix b00b --testnet
```

The script automatically:
1. Generates the Move source for your token name
2. Compiles it with `sui move build`
3. Grinds gas budgets until the package ID ends with your suffix
4. Signs the raw BCS bytes and submits to the network

**Output:**
```
[deploy] PUBLISHED: 0x369271d57e998391ff48f6928c36c772024023889b565af060778786507eb00b
[deploy] coin type: 0x...b00b::foiled::FOILED
[deploy] VANITY SUFFIX CONFIRMED: ...b00b
```

### 3. All Options

```
Usage: npx tsx src/deploy.ts <TOKEN_NAME> [options]

  TOKEN_NAME          Token ticker (e.g. VANITY, FOILED, PEPE)

  --suffix <hex>      Vanity hex suffix (default: b00b)
  --supply <number>   Total supply before decimals (default: 1000000000)
  --decimals <number> Token decimals (default: 9)
  --desc <text>       Token description
  --dry               Grind only, don't publish
  --testnet           Deploy to testnet instead of mainnet
```

Fun suffix ideas: `"dead"`, `"beef"`, `"cafe"`, `"babe"`, `"face"`, `"c0de"`, `"f00d"`, `"0000"`, `"1337"`.

---

## Project Structure

```
src/
  grinder.ts      Core vanity grinder — pure hashing, no RPC calls
  deploy.ts       CLI deploy — generates Move, builds, grinds, publishes
  constants.ts    Configurable defaults (suffix, gas floor, epoch buffer)
  launch.ts       Full launch flow with SuiClient integration
  registry.ts     On-chain registry reads + registration
token/
  sources/
    vanity.move   Example $VANITY token (1B supply, 9 decimals, immutable metadata)
move/
  registry.move   On-chain vanity suffix enforcement module
tests/
  grinder.test.ts 11 tests covering u64LE, computePackageId, grindPackageId, validation
```

---

## API

### `grindPackageId(params: GrindParams): GrindResult`

The core grinder function. Takes transaction parameters and a hex `target` suffix, returns the matching `gasBudget` and predicted `packageId`.

```ts
import { grindPackageId } from "./src/grinder.js";

const result = grindPackageId({
  sender: "0x...",
  compiledModules: [base64Module],
  dependencies: ["0x1", "0x2"],
  gasCoinObjectId: "0x...",
  gasCoinVersion: 123,
  gasCoinDigest: "...",
  gasPrice: 1000n,
  expirationEpoch: 100,
  target: "b00b",  // any hex suffix
});

console.log(result.packageId);  // 0x...b00b
console.log(result.gasBudget);  // use this exact budget when publishing
```

### `computePackageId(txDigest: Uint8Array, creationIndex: number): string`

Derive a Sui object ID from a transaction digest.

### `serializePublishTxData(params: GrindParams, gasBudget: bigint): Uint8Array`

Build BCS-serialized `TransactionData` for a Publish transaction. Used by both the grinder and deploy script to ensure byte-for-byte identical serialization.

---

## Key Technical Details

- **Digest formula**: `blake2b("TransactionData::" || bcs_bytes)` — NOT the intent prefix `[0,0,0]`
- **Object ID derivation**: `blake2b([0xf1] || tx_digest || u64_le(creation_index))` — `0xf1` is `HashingIntentScope::RegularObjectId`
- **Signing** uses a different prefix: the SDK's `signTransaction` adds intent `[0,0,0]` before hashing for the signature
- **Raw BCS signing** is critical — using `signAndExecuteTransaction` causes the SDK to re-serialize the transaction, changing the gas budget and breaking the vanity suffix

---

## License

MIT