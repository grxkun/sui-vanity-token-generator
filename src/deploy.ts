import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { grindPackageId, serializePublishTxData } from "./grinder.js";
import { EPOCH_BUFFER } from "./constants.js";
import { readFileSync } from "fs";

const VANITY_SUFFIX = "b00b";
const RPC_URL = "https://fullnode.mainnet.sui.io:443";

async function main() {
  const dryRun = process.argv.includes("--dry");

  // 1. Load keypair from sui client config
  const configPath = `${process.env.HOME}/.sui/sui_config/sui.keystore`;
  const keystore: string[] = JSON.parse(readFileSync(configPath, "utf-8"));
  const privKeyB64 = keystore[0];
  const privKeyBytes = fromBase64(privKeyB64);
  // First byte is the scheme flag (0 = ed25519), rest is the 32-byte secret
  const keypair = Ed25519Keypair.fromSecretKey(privKeyBytes.slice(1));
  const sender = keypair.toSuiAddress();
  console.log(`[deploy] sender: ${sender}`);

  // 2. Connect to mainnet
  const client = new SuiClient({ url: RPC_URL });

  // 3. Check balance
  const balance = await client.getBalance({ owner: sender });
  console.log(`[deploy] balance: ${BigInt(balance.totalBalance) / 1_000_000_000n} SUI`);

  // 4. Get compiled modules from build output
  const mvBytes = readFileSync(
    "./token/build/vanity_token/bytecode_modules/vanity.mv",
  );
  const compiledModules = [toBase64(mvBytes)];
  console.log(`[deploy] module size: ${mvBytes.length} bytes`);

  // 5. Dependencies - standard Sui framework packages
  const dependencies = [
    "0x0000000000000000000000000000000000000000000000000000000000000001", // MoveStdlib
    "0x0000000000000000000000000000000000000000000000000000000000000002", // Sui Framework
  ];

  // 6. Fetch gas price + epoch
  const gasPrice = BigInt(await client.getReferenceGasPrice());
  const systemState = await client.getLatestSuiSystemState();
  const currentEpoch = Number(systemState.epoch);
  const expirationEpoch = currentEpoch + EPOCH_BUFFER;
  console.log(`[deploy] gasPrice: ${gasPrice}, epoch: ${currentEpoch}, expiration: ${expirationEpoch}`);

  // 7. Get gas coin
  const coins = await client.getCoins({ owner: sender, coinType: "0x2::sui::SUI" });
  if (coins.data.length === 0) throw new Error("No SUI coins");
  const gasCoin = coins.data.reduce((max, c) =>
    BigInt(c.balance) > BigInt(max.balance) ? c : max,
  );
  console.log(`[deploy] gasCoin: ${gasCoin.coinObjectId} (${BigInt(gasCoin.balance) / 1_000_000_000n} SUI)`);

  const grindParams = {
    sender,
    compiledModules,
    dependencies,
    gasCoinObjectId: gasCoin.coinObjectId,
    gasCoinVersion: Number(gasCoin.version),
    gasCoinDigest: gasCoin.digest,
    gasPrice,
    expirationEpoch,
    target: VANITY_SUFFIX,
  };

  // 8. GRIND for vanity suffix
  console.log(`[deploy] grinding for ...${VANITY_SUFFIX} package ID...`);
  const grindResult = grindPackageId(grindParams);

  console.log(`[deploy] package ID: ${grindResult.packageId}`);
  console.log(`[deploy] gasBudget: ${grindResult.gasBudget}`);
  console.log(`[deploy] iterations: ${grindResult.iterations}`);

  if (dryRun) {
    console.log("[deploy] --dry flag set, not publishing.");
    return;
  }

  // 9. Build the EXACT same BCS bytes the grinder used — no SDK rebuild
  const txDataBytes = serializePublishTxData(grindParams, grindResult.gasBudget);
  const txDataB64 = toBase64(txDataBytes);
  console.log(`[deploy] BCS tx size: ${txDataBytes.length} bytes`);

  // 10. Sign the raw transaction bytes
  //     signTransaction adds the intent prefix [0,0,0] internally before hashing
  const { signature } = await keypair.signTransaction(txDataBytes);
  console.log(`[deploy] signed, submitting to mainnet...`);

  // 11. Execute with pre-signed bytes — bypasses any SDK re-serialization
  const result = await client.executeTransactionBlock({
    transactionBlock: txDataB64,
    signature: [signature],
    options: { showEffects: true, showObjectChanges: true },
  });

  console.log(`[deploy] tx digest: ${result.digest}`);
  console.log(`[deploy] status: ${result.effects?.status?.status}`);

  if (result.effects?.status?.status === "failure") {
    console.log(`[deploy] error: ${result.effects.status.error}`);
  }

  if (result.objectChanges) {
    for (const change of result.objectChanges) {
      if (change.type === "published") {
        console.log(`[deploy] PUBLISHED package: ${change.packageId}`);
        console.log(`[deploy] coin type: ${change.packageId}::vanity::VANITY`);
        if (change.packageId.endsWith(VANITY_SUFFIX)) {
          console.log(`[deploy] VANITY SUFFIX CONFIRMED: ...${VANITY_SUFFIX}`);
        } else {
          console.log(`[deploy] WARNING: suffix mismatch!`);
        }
      }
    }
  }

  console.log(`[deploy] explorer: https://suiscan.xyz/mainnet/tx/${result.digest}`);
}

main().catch((err) => {
  console.error("[deploy] FATAL:", err);
  process.exit(1);
});
