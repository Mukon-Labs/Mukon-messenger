use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    /// Maximum number of contacts (fixed-size for MPC compatibility)
    const MAX_CONTACTS: usize = 2;

    /// Encrypted contact entry
    #[derive(Debug, Clone, Copy)]
    pub struct ContactEntry {
        pub pubkey: [u8; 32],
        pub status: u8, // 0=empty, 1=pending, 2=accepted, 3=rejected, 4=blocked
    }

    /// Encrypted contact list with fixed size
    #[derive(Debug, Clone, Copy)]
    pub struct ContactList {
        pub contacts: [ContactEntry; MAX_CONTACTS],
        pub count: u32,
    }

    /// Check if a wallet is in the contact list with accepted status
    #[instruction]
    pub fn is_accepted_contact(
        list: Enc<Shared, ContactList>,
        query_pubkey: Enc<Shared, [u8; 32]>,
    ) -> Enc<Shared, bool> {
        let contacts = list.to_arcis();
        let pubkey = query_pubkey.to_arcis();

        let mut is_contact = false;

        // Scan through all contacts to find accepted match
        for i in 0..MAX_CONTACTS {
            if i < contacts.count as usize {
                let contact = contacts.contacts[i];
                if contact.pubkey == pubkey && contact.status == 2 {
                    is_contact = true;
                }
            }
        }

        list.owner.from_arcis(is_contact)
    }

    /// Count accepted contacts
    #[instruction]
    pub fn count_accepted(
        list: Enc<Shared, ContactList>,
    ) -> Enc<Shared, u32> {
        let contacts = list.to_arcis();
        let mut count = 0u32;

        for i in 0..MAX_CONTACTS {
            if i < contacts.count as usize {
                if contacts.contacts[i].status == 2 {
                    count += 1;
                }
            }
        }

        list.owner.from_arcis(count)
    }

    /// Simple example: add two numbers (for testing Arcium integration)
    pub struct AddInput {
        pub a: u32,
        pub b: u32,
    }

    #[instruction]
    pub fn add_two_numbers(input: Enc<Shared, AddInput>) -> Enc<Shared, u32> {
        let data = input.to_arcis();
        let sum = data.a + data.b;
        input.owner.from_arcis(sum)
    }
}
