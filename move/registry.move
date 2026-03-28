module vanity::registry {
    use sui::bcs;
    use std::vector;

    const EInvalidSuffix: u64 = 4;

    /// Central registry that tracks every token launched through the vanity grinder.
    public struct Registry has key, store {
        id: UID,
        /// The required trailing bytes every package ID must match.
        /// e.g. [0x0b, 0xub] won't work — hex only — so for \"bub\" → [0x0b, 0xub] is invalid.
        /// Stored as raw bytes; the deployer sets this once at init.
        required_suffix: vector<u8>,
        entries: vector<LaunchEntry>,
    }

    public struct LaunchEntry has store, copy, drop {
        package_id: address,
        creator: address,
        registered_at_epoch: u64,
    }

    /// Deploy with a configurable suffix. For \"8888\" pass vector[0x88, 0x88].
    /// For \"bub\" (3 hex chars) you would pass the appropriate byte pattern.
    public fun create_registry(
        required_suffix: vector<u8>,
        ctx: &mut TxContext,
    ) {
        transfer::share_object(Registry {
            id: object::new(ctx),
            required_suffix,
            entries: vector::empty<LaunchEntry>(),
        });
    }

    /// Assert the trailing bytes of `package_id` match the registry's required suffix.
    fun assert_vanity_suffix(registry: &Registry, package_id: address) {
        let id_bytes = bcs::to_bytes(&package_id);
        let id_len = vector::length(&id_bytes);
        let suffix_len = vector::length(&registry.required_suffix);
        let start = id_len - suffix_len;
        let i = 0;
        while (i < suffix_len) {
            assert!(
                *vector::borrow(&id_bytes, start + i) == *vector::borrow(&registry.required_suffix, i),
                EInvalidSuffix
            );
            i = i + 1;
        };
    }

    /// Register a newly published token package.
    /// Aborts with EInvalidSuffix if the package ID does not end with the required suffix.
    public fun register_launch(
        registry: &mut Registry,
        package_id: address,
        ctx: &mut TxContext,
    ) {
        assert_vanity_suffix(registry, package_id);

        let entry = LaunchEntry {
            package_id,
            creator: ctx.sender(),
            registered_at_epoch: ctx.epoch(),
        };
        vector::push_back(&mut registry.entries, entry);
    }
}
