import { SuiClient } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { Signer } from "@mysten/sui/cryptography";
import { grindPackageId } from "./grinder.js";
import {
  DEFAULT_GRIND_TARGET,
  EPOCH_BUFFER,
  REGISTRY_PACKAGE,
} from "./constants.js";

export interface LaunchParams {
  symbol: string;
  name: string;
  description: string;
  compiledModules: string[];
  dependencies: string[];
  /** Vanity hex suffix for the package ID (e.g. "b00b", "8888", "9999"). Defaults to DEFAULT_GRIND_TARGET. */
  vanitySuffix?: string;
}

export interface LaunchResult {
  packageId: string;
  txDigest: string;
  coinType: string;
}

export async function launchToken(
  params: LaunchParams,
  signer: Signer,
  client: SuiClient,
): Promise<LaunchResult> {
  const sender = signer.toSuiAddress();

  // 1. Fetch reference gas price
  const gasPrice = BigInt(await client.getReferenceGasPrice());

  // 2. Fetch current epoch
  const systemState = await client.getLatestSuiSystemState();
  const currentEpoch = Number(systemState.epoch);
  const expirationEpoch = currentEpoch + EPOCH_BUFFER;

  // 3. Select gas coin — pick largest SUI coin
  const coins = await client.getCoins({
    owner: sender,
    coinType: "0x2::sui::SUI",
  });
  if (coins.data.length === 0) {
    throw new Error("No SUI coins found for sender");
  }
  const gasCoin = coins.data.reduce((max, coin) =>
    BigInt(coin.balance) > BigInt(max.balance) ? coin : max,
  );

  // 4. Grind for a package ID ending in the target suffix
  const grindResult = grindPackageId({
    sender,
    compiledModules: params.compiledModules,
    dependencies: params.dependencies,
    gasCoinObjectId: gasCoin.coinObjectId,
    gasCoinVersion: Number(gasCoin.version),
    gasCoinDigest: gasCoin.digest,
    gasPrice,
    expirationEpoch,
    target: params.vanitySuffix ?? DEFAULT_GRIND_TARGET,
  });

  // 5. Build the real transaction with the exact gasBudget from the grinder
  const tx = new Transaction();

  tx.setSender(sender);
  tx.setGasPrice(gasPrice);
  tx.setGasBudget(grindResult.gasBudget);
  tx.setExpiration({ Epoch: expirationEpoch });
  tx.setGasPayment([
    {
      objectId: gasCoin.coinObjectId,
      version: gasCoin.version,
      digest: gasCoin.digest,
    },
  ]);

  const upgradeCap = tx.publish({
    modules: params.compiledModules,
    dependencies: params.dependencies,
  });

  // UpgradeCap is auto-transferred to sender by the Sui runtime

  // 6. Sign and execute
  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
  });

  // 7. Register in registry (if deployed)
  if (REGISTRY_PACKAGE !== "0x") {
    const regTx = new Transaction();
    regTx.moveCall({
      target: `${REGISTRY_PACKAGE}::registry::register_launch`,
      arguments: [
        regTx.object(
          `${REGISTRY_PACKAGE}::registry::Registry`,
        ),
        regTx.pure.address(grindResult.packageId),
      ],
    });
    await client.signAndExecuteTransaction({
      signer,
      transaction: regTx,
    });
  }

  // 8. Derive coin type
  const moduleName = params.symbol.toLowerCase();
  const coinType = `${grindResult.packageId}::${moduleName}::${moduleName.toUpperCase()}`;

  return {
    packageId: grindResult.packageId,
    txDigest: result.digest,
    coinType,
  };
}
