// ---------- Grinder defaults ----------
// The vanity suffix to grind for. Examples: "b00b", "8888", "9999", "dead"
export const DEFAULT_GRIND_TARGET = "b00b";
export const CREATION_INDEX = 0;
export const GAS_BUDGET_FLOOR = 500_000_000n;
export const EPOCH_BUFFER = 10;

// ---------- Standard token defaults ----------
export const DEFAULT_TOKEN_DECIMALS = 9;
export const DEFAULT_TOKEN_SUPPLY = 1_000_000_000n; // 1 B tokens (before decimals)

// ---------- Fee split (basis points, must total 10 000) ----------
export const FEE_BPS = {
  CREATOR: 4000,   // 40%
  STAKERS: 3500,   // 35%
  PROTOCOL: 2000,  // 20%
  PARTNER: 500,    //  5%
};

// ---------- On-chain package IDs (fill after deploy) ----------
export const REGISTRY_PACKAGE = "0x";
export const FACTORY_PACKAGE = "0x";
