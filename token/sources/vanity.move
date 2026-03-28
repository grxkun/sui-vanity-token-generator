module vanity_token::vanity {
    use sui::coin;
    use sui::url;

    const DECIMALS: u8 = 9;
    const TOTAL_SUPPLY: u64 = 1_000_000_000_000_000_000; // 1B * 10^9

    public struct VANITY has drop {}

    #[allow(deprecated_usage)]
    fun init(witness: VANITY, ctx: &mut TxContext) {
        let (mut treasury_cap, metadata) = coin::create_currency<VANITY>(
            witness,
            DECIMALS,
            b"VANITY",
            b"Vanity",
            b"Vanity token deployed via Sui Vanity Token Generator",
            option::some(url::new_unsafe_from_bytes(b"")),
            ctx,
        );

        // Mint entire supply to deployer
        let supply_coin = coin::mint(&mut treasury_cap, TOTAL_SUPPLY, ctx);
        transfer::public_transfer(supply_coin, ctx.sender());

        // Freeze metadata (immutable)
        transfer::public_freeze_object(metadata);

        // Transfer treasury cap to deployer, then they can destroy/discard
        // (TreasuryCap cannot be destructured outside sui::coin)
        transfer::public_transfer(treasury_cap, ctx.sender());
    }
}
