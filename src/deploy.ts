import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { grindPackageId, serializePublishTxData } from "./grinder.js";
import { EPOCH_BUFFER, DEFAULT_GRIND_TARGET } from "./constants.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// CLI: npx tsx src/deploy.ts <TOKEN_NAME> [--suffix <hex>] [--dry] [--testnet]
//
// Examples:
//   npx tsx src/deploy.ts VANITY
//   npx tsx src/deploy.ts FOILED --suffix b00b
//   npx tsx src/deploy.ts MAMOUN --suffix dead --testnet
//   npx tsx src/deploy.ts PEPE --dry
// ---------------------------------------------------------------------------

function usage(): never {
  console.log(`
Usage: npx tsx src/deploy.ts <TOKEN_NAME> [options]

Arguments:
  TOKEN_NAME          Token ticker (e.g. VANITY, FOILED, PEPE). Must be A-Z only.

Options:
  --suffix <hex>      Vanity hex suffix for the package ID (default: ${DEFAULT_GRIND_TARGET})
  --supply <number>   Total supply before decimals (default: 1000000000)
  --decimals <number> Token decimals (default: 9)
  --desc <text>       Token description
  --dry               Grind only, don't publish
  --testnet           Deploy to testnet instead of mainnet
  --help              Show this help
  `);
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help")) usage();

  const tokenName = args[0];
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(tokenName)) {
    console.error(`[deploy] ERROR: token name must be alphanumeric (A-Z, 0-9), got "${tokenName}"`);
    process.exit(1);
  }

  const flag = (name: string) => args.includes(name);
  const opt = (name: string, fallback: string) => {
    const idx = args.indexOf(name);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : fallback;
  };

  const suffix = opt("--suffix", DEFAULT_GRIND_TARGET);
  if (!/^[0-9a-f]+$/i.test(suffix)) {
    console.error(`[deploy] ERROR: suffix must be hex [0-9a-f], got "${suffix}"`);
    process.exit(1);
  }

  return {
    tokenName: tokenName.toUpperCase(),
    moduleName: tokenName.toLowerCase(),
    suffix: suffix.toLowerCase(),
    supply: BigInt(opt("--supply", "1000000000")),
    decimals: Number(opt("--decimals", "9")),
    description: opt("--desc", `${tokenName.toUpperCase()} token deployed with vanity package ID`),
    dryRun: flag("--dry"),
    testnet: flag("--testnet"),
  };
}

// ---------------------------------------------------------------------------
// Generate Move source, write to disk, compile with sui move build
// ---------------------------------------------------------------------------

function generateMoveSource(cfg: ReturnType<typeof parseArgs>): string {
  const rawSupply = cfg.supply * (10n ** BigInt(cfg.decimals));
  return `module vanity_token::${cfg.moduleName} {
    use sui::coin;
    use sui::url;

    const DECIMALS: u8 = ${cfg.decimals};
    const TOTAL_SUPPLY: u64 = ${rawSupply}; // ${cfg.supply} * 10^${cfg.decimals}

    public struct ${cfg.tokenName} has drop {}

    #[allow(deprecated_usage)]
    fun init(witness: ${cfg.tokenName}, ctx: &mut TxContext) {
        let (mut treasury_cap, metadata) = coin::create_currency<${cfg.tokenName}>(
            witness,
            DECIMALS,
            b"${cfg.tokenName}",
            b"${cfg.tokenName}",
            b"${cfg.description}",
            option::some(url::new_unsafe_from_bytes(b"")),
            ctx,
        );

        // Mint entire supply to deployer
        let supply_coin = coin::mint(&mut treasury_cap, TOTAL_SUPPLY, ctx);
        transfer::public_transfer(supply_coin, ctx.sender());

        // Freeze metadata (immutable)
        transfer::public_freeze_object(metadata);

        // Transfer treasury cap to deployer
        transfer::public_transfer(treasury_cap, ctx.sender());
    }
}
`;
}

function buildMovePackage(cfg: ReturnType<typeof parseArgs>): Uint8Array {
  // Write the generated Move source
  const srcDir = "./token/sources";
  const srcPath = `${srcDir}/${cfg.moduleName}.move`;
  const moveSource = generateMoveSource(cfg);

  // Remove old .move files (except Move.toml related)
  const existing = readdirSync(srcDir).filter(f => f.endsWith(".move"));
  for (const f of existing) {
    unlinkSync(`${srcDir}/${f}`);
  }

  writeFileSync(srcPath, moveSource);
  console.log(`[deploy] wrote ${srcPath}`);

  // Build
  console.log("[deploy] building Move package...");
  execSync("sui move build", { cwd: "./token", stdio: "pipe" });

  // Read compiled bytecode
  const mvPath = `./token/build/vanity_token/bytecode_modules/${cfg.moduleName}.mv`;
  if (!existsSync(mvPath)) {
    throw new Error(`Build succeeded but ${mvPath} not found`);
  }
  const mvBytes = readFileSync(mvPath);
  console.log(`[deploy] compiled ${cfg.tokenName}: ${mvBytes.length} bytes`);
  return mvBytes;
}

import { readdirSync, unlinkSync } from "fs";

// ---------------------------------------------------------------------------
// Main deploy flow
// ---------------------------------------------------------------------------

async function main() {
  const cfg = parseArgs();

  const rpcUrl = cfg.testnet
    ? "https://fullnode.testnet.sui.io:443"
    : "https://fullnode.mainnet.sui.io:443";
  const network = cfg.testnet ? "testnet" : "mainnet";

  console.log(`[deploy] token: $${cfg.tokenName}`);
  console.log(`[deploy] suffix: ...${cfg.suffix}`);
  console.log(`[deploy] network: ${network}`);
  console.log(`[deploy] supply: ${cfg.supply} (${cfg.decimals} decimals)`);

  // 1. Load keypair
  const configPath = `${process.env.HOME}/.sui/sui_config/sui.keystore`;
  const keystore: string[] = JSON.parse(readFileSync(configPath, "utf-8"));
  const privKeyBytes = fromBase64(keystore[0]);
  const keypair = Ed25519Keypair.fromSecretKey(privKeyBytes.slice(1));
  const sender = keypair.toSuiAddress();
  console.log(`[deploy] sender: ${sender}`);

  // 2. Connect
  const client = new SuiClient({ url: rpcUrl });
  const balance = await client.getBalance({ owner: sender });
  console.log(`[deploy] balance: ${BigInt(balance.totalBalance) / 1_000_000_000n} SUI`);

  // 3. Generate + compile Move module
  const mvBytes = buildMovePackage(cfg);
  const compiledModules = [toBase64(mvBytes)];

  const dependencies = [
    "0x0000000000000000000000000000000000000000000000000000000000000001",
    "0x0000000000000000000000000000000000000000000000000000000000000002",
  ];

  // 4. Fetch gas price + epoch
  const gasPrice = BigInt(await client.getReferenceGasPrice());
  const systemState = await client.getLatestSuiSystemState();
  const currentEpoch = Number(systemState.epoch);
  const expirationEpoch = currentEpoch + EPOCH_BUFFER;
  console.log(`[deploy] gasPrice: ${gasPrice}, epoch: ${currentEpoch}`);

  // 5. Get gas coin
  const coins = await client.getCoins({ owner: sender, coinType: "0x2::sui::SUI" });
  if (coins.data.length === 0) throw new Error("No SUI coins — send some SUI first");
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
    target: cfg.suffix,
  };

  // 6. GRIND
  console.log(`[deploy] grinding for ...${cfg.suffix} package ID...`);
  const grindResult = grindPackageId(grindParams);

  console.log(`[deploy] package ID: ${grindResult.packageId}`);
  console.log(`[deploy] gasBudget: ${grindResult.gasBudget}`);
  console.log(`[deploy] iterations: ${grindResult.iterations} (${Math.round(grindResult.elapsedMs)}ms)`);

  const coinType = `${grindResult.packageId}::${cfg.moduleName}::${cfg.tokenName}`;
  console.log(`[deploy] coin type: ${coinType}`);

  if (cfg.dryRun) {
    console.log("[deploy] --dry flag set, not publishing.");
    return;
  }

  // 7. Sign raw BCS bytes
  const txDataBytes = serializePublishTxData(grindParams, grindResult.gasBudget);
  const txDataB64 = toBase64(txDataBytes);
  const { signature } = await keypair.signTransaction(txDataBytes);
  console.log(`[deploy] signed, submitting to ${network}...`);

  // 8. Execute
  const result = await client.executeTransactionBlock({
    transactionBlock: txDataB64,
    signature: [signature],
    options: { showEffects: true, showObjectChanges: true },
  });

  console.log(`[deploy] tx digest: ${result.digest}`);
  console.log(`[deploy] status: ${result.effects?.status?.status}`);

  if (result.effects?.status?.status === "failure") {
    console.log(`[deploy] error: ${result.effects.status.error}`);
    process.exit(1);
  }

  if (result.objectChanges) {
    for (const change of result.objectChanges) {
      if (change.type === "published") {
        const pkg = change.packageId;
        console.log(`\n[deploy] PUBLISHED: ${pkg}`);
        console.log(`[deploy] coin type: ${pkg}::${cfg.moduleName}::${cfg.tokenName}`);
        if (pkg.endsWith(cfg.suffix)) {
          console.log(`[deploy] VANITY SUFFIX CONFIRMED: ...${cfg.suffix}`);
        } else {
          console.log(`[deploy] WARNING: suffix mismatch!`);
        }
      }
    }
  }

  const explorer = cfg.testnet
    ? `https://suiscan.xyz/testnet/tx/${result.digest}`
    : `https://suiscan.xyz/mainnet/tx/${result.digest}`;
  console.log(`[deploy] explorer: ${explorer}`);
}

main().catch((err) => {
  console.error("[deploy] FATAL:", err);
  process.exit(1);
});
