module vanity_token::foiled {
    use sui::coin;
    use sui::url;

    const DECIMALS: u8 = 9;
    const TOTAL_SUPPLY: u64 = 1000000000000000000; // 1000000000 * 10^9

    public struct FOILED has drop {}

    #[allow(deprecated_usage)]
    fun init(witness: FOILED, ctx: &mut TxContext) {
        let (mut treasury_cap, metadata) = coin::create_currency<FOILED>(
            witness,
            DECIMALS,
            b"FOILED",
            b"FOILED",
            b"FOILED token deployed with vanity package ID",
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
