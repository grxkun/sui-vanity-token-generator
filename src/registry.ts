import { SuiClient } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { Signer } from "@mysten/sui/cryptography";
import { REGISTRY_PACKAGE } from "./constants.js";

export interface RegistryEntry {
  packageId: string;
  creator: string;
  registeredAtEpoch: string;
}

/**
 * Read all launches registered in the on-chain Registry object.
 */
export async function getRegistryEntries(
  client: SuiClient,
  registryObjectId: string,
): Promise<RegistryEntry[]> {
  const obj = await client.getObject({
    id: registryObjectId,
    options: { showContent: true },
  });

  if (obj.data?.content?.dataType !== "moveObject") {
    throw new Error("Registry object not found or not a Move object");
  }

  const fields = obj.data.content.fields as Record<string, unknown>;
  return (fields["entries"] as RegistryEntry[]) ?? [];
}

/**
 * Register a newly published token package in the on-chain registry.
 * The on-chain module asserts the package ID ends with the configured suffix.
 */
export async function registerLaunch(
  client: SuiClient,
  signer: Signer,
  registryObjectId: string,
  packageId: string,
): Promise<string> {
  const tx = new Transaction();

  tx.moveCall({
    target: `${REGISTRY_PACKAGE}::registry::register_launch`,
    arguments: [
      tx.object(registryObjectId),
      tx.pure.address(packageId),
    ],
  });

  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
  });

  return result.digest;
}
