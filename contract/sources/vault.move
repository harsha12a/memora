module digital_vault_addr::vault_v13 {
    use aptos_framework::account;
    use aptos_framework::event::{Self, EventHandle};
    use aptos_framework::timestamp;
    use aptos_std::table::{Self, Table};
    use std::signer;
    use std::vector;
    use std::error;

    // Error codes
    const E_NOT_OWNER: u64 = 1;
    const E_NOT_UNLOCKED: u64 = 2;
    const E_NOT_AUTHORIZED: u64 = 3;
    const E_CAPSULE_NOT_FOUND: u64 = 4;
    const E_GEO_NOT_VERIFIED: u64 = 5;
    const E_MAX_CONTRIBUTORS: u64 = 6;
    const E_INVALID_CAPSULE_TYPE: u64 = 7;
    const E_CONTRIBUTOR_ALREADY_EXISTS: u64 = 8;
    const E_BAD_CODE: u64 = 9;
    const E_NO_CAPSULES: u64 = 10;
    const E_CHUNK_TOO_LARGE: u64 = 11;
    const E_INVALID_CHUNK: u64 = 12;

    // Capsule types
    const TYPE_TIME_LOCK: u8 = 1;
    const TYPE_COLLAB: u8 = 2;
    const TYPE_FILE_LOCKER: u8 = 3;
    const TYPE_GEO_LOCK: u8 = 4;

    // Maximum chunk size (50KB to stay well under transaction limits)
    const MAX_CHUNK_SIZE: u64 = 51200;

    struct FileChunk has store {
        chunk_index: u64,
        data: vector<u8>,
    }

    struct Capsule has store {
        id: u64,
        capsule_type: u8,
        owner: address,
        unlock_time: u64,
        geo_lat: u128,
        geo_long: u128,
        geo_radius: u64,
        max_contributors: u64,
        is_geo_verified: bool,
        is_unlocked: bool,
        contributors: vector<address>,
        contributor_files: Table<address, vector<u8>>,
        access_list: Table<address, bool>,
        file_chunks: Table<u64, FileChunk>,
        total_chunks: u64,
        file_size: u64,
        encrypted_key: vector<u8>,
        file_mime_type: vector<u8>,
        is_complete: bool,
    }

    struct UserCapsules has key {
        capsules: Table<u64, Capsule>,
        next_id: u64,
        unlock_events: EventHandle<UnlockEvent>,
    }

    struct UnlockEvent has drop, store {
        capsule_id: u64,
        unlocker: address,
        timestamp: u64,
    }

    public entry fun init_user(account: &signer) {
        let addr = signer::address_of(account);
        if (!exists<UserCapsules>(addr)) {
            move_to(account, UserCapsules {
                capsules: table::new<u64, Capsule>(),
                next_id: 0,
                unlock_events: account::new_event_handle<UnlockEvent>(account),
            });
        }
    }

    public entry fun create_capsule(
        account: &signer,
        capsule_type: u8,
        file_mime_type: vector<u8>,
        encrypted_key: vector<u8>,
        unlock_time: u64,
        geo_lat: u128,
        geo_long: u128,
        geo_radius: u64,
        max_contributors: u64,
        total_file_size: u64
    ) acquires UserCapsules {
        assert!(
            capsule_type >= TYPE_TIME_LOCK && capsule_type <= TYPE_GEO_LOCK,
            error::invalid_argument(E_INVALID_CAPSULE_TYPE)
        );

        let addr = signer::address_of(account);
        if (!exists<UserCapsules>(addr)) { 
            init_user(account); 
        };
        
        let uc = borrow_global_mut<UserCapsules>(addr);
        let id = uc.next_id;
        uc.next_id = id + 1;

        let cap = Capsule {
            id,
            capsule_type,
            owner: addr,
            unlock_time,
            geo_lat,
            geo_long,
            geo_radius,
            max_contributors,
            is_geo_verified: geo_radius == 0,
            is_unlocked: false,
            contributors: vector::empty<address>(),
            contributor_files: table::new<address, vector<u8>>(),
            access_list: table::new<address, bool>(),
            file_chunks: table::new<u64, FileChunk>(),
            total_chunks: 0,
            file_size: total_file_size,
            encrypted_key,
            file_mime_type,
            is_complete: false,
        };

        table::add(&mut cap.access_list, addr, true);
        table::add(&mut uc.capsules, id, cap);
    }

    public entry fun upload_chunk(
        account: &signer,
        capsule_id: u64,
        chunk_index: u64,
        chunk_data: vector<u8>,
        is_final_chunk: bool
    ) acquires UserCapsules {
        assert!(
            vector::length(&chunk_data) <= MAX_CHUNK_SIZE,
            error::invalid_argument(E_CHUNK_TOO_LARGE)
        );

        let addr = signer::address_of(account);
        let uc = borrow_global_mut<UserCapsules>(addr);
        assert!(table::contains(&uc.capsules, capsule_id), error::not_found(E_CAPSULE_NOT_FOUND));
        
        let cap = table::borrow_mut(&mut uc.capsules, capsule_id);
        assert!(cap.owner == addr, error::permission_denied(E_NOT_OWNER));

        let chunk = FileChunk {
            chunk_index,
            data: chunk_data,
        };

        table::add(&mut cap.file_chunks, chunk_index, chunk);
        
        if (chunk_index + 1 > cap.total_chunks) {
            cap.total_chunks = chunk_index + 1;
        };

        if (is_final_chunk) {
            cap.is_complete = true;
        };
    }

    public entry fun add_contributor_file(
        account: &signer,
        owner_addr: address,
        capsule_id: u64,
        file_bytes: vector<u8>
    ) acquires UserCapsules {
        assert!(
            vector::length(&file_bytes) <= MAX_CHUNK_SIZE,
            error::invalid_argument(E_CHUNK_TOO_LARGE)
        );

        let uc = borrow_global_mut<UserCapsules>(owner_addr);
        assert!(table::contains(&uc.capsules, capsule_id), error::not_found(E_CAPSULE_NOT_FOUND));
        
        let cap = table::borrow_mut(&mut uc.capsules, capsule_id);
        assert!(cap.capsule_type == TYPE_COLLAB, error::invalid_argument(E_INVALID_CAPSULE_TYPE));
        assert!((vector::length(&cap.contributors) as u64) < cap.max_contributors, error::invalid_argument(E_MAX_CONTRIBUTORS));

        let sender = signer::address_of(account);
        assert!(!table::contains(&cap.contributor_files, sender), error::invalid_argument(E_CONTRIBUTOR_ALREADY_EXISTS));

        vector::push_back(&mut cap.contributors, sender);
        table::add(&mut cap.contributor_files, sender, file_bytes);
        table::upsert(&mut cap.access_list, sender, true);
    }

    public entry fun grant_access(
        account: &signer,
        capsule_id: u64,
        grantee: address
    ) acquires UserCapsules {
        let owner_addr = signer::address_of(account);
        let uc = borrow_global_mut<UserCapsules>(owner_addr);
        assert!(table::contains(&uc.capsules, capsule_id), error::not_found(E_CAPSULE_NOT_FOUND));
        
        let cap = table::borrow_mut(&mut uc.capsules, capsule_id);
        assert!(cap.owner == owner_addr, error::permission_denied(E_NOT_OWNER));
        assert!(cap.capsule_type == TYPE_FILE_LOCKER, error::invalid_argument(E_INVALID_CAPSULE_TYPE));

        table::upsert(&mut cap.access_list, grantee, true);
    }

    public entry fun revoke_access(
        account: &signer,
        capsule_id: u64,
        revokee: address
    ) acquires UserCapsules {
        let owner_addr = signer::address_of(account);
        let uc = borrow_global_mut<UserCapsules>(owner_addr);
        assert!(table::contains(&uc.capsules, capsule_id), error::not_found(E_CAPSULE_NOT_FOUND));
        
        let cap = table::borrow_mut(&mut uc.capsules, capsule_id);
        assert!(cap.owner == owner_addr, error::permission_denied(E_NOT_OWNER));
        assert!(revokee != owner_addr, error::invalid_argument(E_NOT_OWNER));

        if (table::contains(&cap.access_list, revokee)) {
            table::remove(&mut cap.access_list, revokee);
        };
    }

    public entry fun request_unlock(
        account: &signer,
        owner_addr: address,
        capsule_id: u64,
        provided_key: vector<u8>
    ) acquires UserCapsules {
        let now = timestamp::now_seconds();
        let uc = borrow_global_mut<UserCapsules>(owner_addr);
        assert!(table::contains(&uc.capsules, capsule_id), error::not_found(E_CAPSULE_NOT_FOUND));
        
        let cap = table::borrow_mut(&mut uc.capsules, capsule_id);
        let requester = signer::address_of(account);

        assert!(cap.is_complete, error::invalid_state(E_INVALID_CHUNK));
        assert!(table::contains(&cap.access_list, requester) && *table::borrow(&cap.access_list, requester), error::permission_denied(E_NOT_AUTHORIZED));
        assert!(cap.encrypted_key == provided_key, error::invalid_argument(E_BAD_CODE));

        if (cap.unlock_time > 0) {
            assert!(now >= cap.unlock_time, error::permission_denied(E_NOT_UNLOCKED));
        };

        if (cap.geo_radius > 0) {
            assert!(cap.is_geo_verified, error::permission_denied(E_GEO_NOT_VERIFIED));
        };

        cap.is_unlocked = true;

        event::emit_event(&mut uc.unlock_events, UnlockEvent { 
            capsule_id, 
            unlocker: requester,
            timestamp: now
        });
    }

    public entry fun oracle_geo_callback(
        _oracle: &signer,
        owner_addr: address,
        capsule_id: u64,
        user_lat: u128,
        user_long: u128
    ) acquires UserCapsules {
        let uc = borrow_global_mut<UserCapsules>(owner_addr);
        assert!(table::contains(&uc.capsules, capsule_id), error::not_found(E_CAPSULE_NOT_FOUND));
        
        let cap = table::borrow_mut(&mut uc.capsules, capsule_id);
        if (cap.geo_radius > 0) {
            let lat_diff = if (user_lat > cap.geo_lat) { user_lat - cap.geo_lat } else { cap.geo_lat - user_lat };
            let long_diff = if (user_long > cap.geo_long) { user_long - cap.geo_long } else { cap.geo_long - user_long };
            let approx_distance = (lat_diff + long_diff) / 1000;
            if (approx_distance <= (cap.geo_radius as u128)) {
                cap.is_geo_verified = true;
            };
        };
    }

    #[view]
    public fun get_capsule_info(
        owner_addr: address,
        capsule_id: u64
    ): (u8, address, u64, bool, bool, bool, u64, u64) acquires UserCapsules {
        let uc = borrow_global<UserCapsules>(owner_addr);
        assert!(table::contains(&uc.capsules, capsule_id), error::not_found(E_CAPSULE_NOT_FOUND));
        let cap = table::borrow(&uc.capsules, capsule_id);
        (cap.capsule_type, cap.owner, cap.unlock_time, cap.is_unlocked, cap.is_geo_verified, cap.is_complete, cap.total_chunks, cap.file_size)
    }

    #[view]
    public fun has_access(
        requester: address,
        owner_addr: address,
        capsule_id: u64
    ): bool acquires UserCapsules {
        let uc = borrow_global<UserCapsules>(owner_addr);
        if (!table::contains(&uc.capsules, capsule_id)) { return false };
        let cap = table::borrow(&uc.capsules, capsule_id);
        table::contains(&cap.access_list, requester) && *table::borrow(&cap.access_list, requester)
    }

    #[view]
    public fun get_file_chunk(
        requester: address,
        owner_addr: address,
        capsule_id: u64,
        chunk_index: u64
    ): vector<u8> acquires UserCapsules {
        let uc = borrow_global<UserCapsules>(owner_addr);
        assert!(table::contains(&uc.capsules, capsule_id), error::not_found(E_CAPSULE_NOT_FOUND));
        let cap = table::borrow(&uc.capsules, capsule_id);
        assert!(cap.is_unlocked, error::permission_denied(E_NOT_UNLOCKED));
        assert!(table::contains(&cap.access_list, requester) && *table::borrow(&cap.access_list, requester), error::permission_denied(E_NOT_AUTHORIZED));
        assert!(table::contains(&cap.file_chunks, chunk_index), error::not_found(E_INVALID_CHUNK));
        
        let chunk = table::borrow(&cap.file_chunks, chunk_index);
        chunk.data
    }

    #[view]
    public fun get_file_info(
        owner_addr: address,
        capsule_id: u64
    ): (u64, vector<u8>, u64) acquires UserCapsules {
        let uc = borrow_global<UserCapsules>(owner_addr);
        assert!(table::contains(&uc.capsules, capsule_id), error::not_found(E_CAPSULE_NOT_FOUND));
        let cap = table::borrow(&uc.capsules, capsule_id);
        (cap.file_size, cap.file_mime_type, cap.total_chunks)
    }

    #[view]
    public fun get_contributor_count(
        owner_addr: address,
        capsule_id: u64
    ): u64 acquires UserCapsules {
        let uc = borrow_global<UserCapsules>(owner_addr);
        assert!(table::contains(&uc.capsules, capsule_id), error::not_found(E_CAPSULE_NOT_FOUND));
        let cap = table::borrow(&uc.capsules, capsule_id);
        vector::length(&cap.contributors)
    }

    #[view]
    public fun get_latest_capsule_id(owner_addr: address): u64 acquires UserCapsules {
        let uc = borrow_global<UserCapsules>(owner_addr);
        assert!(uc.next_id > 0, error::not_found(E_NO_CAPSULES));
        uc.next_id - 1
    }
}