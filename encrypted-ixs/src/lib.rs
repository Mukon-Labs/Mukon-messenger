use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    /// Maximum number of contacts (fixed-size for MPC compatibility)
    const MAX_CONTACTS: usize = 2;

    /// Relationship status pair for MPC verification
    #[derive(Debug, Clone, Copy)]
    pub struct RelationshipStatus {
        pub status_a: u8,
        pub status_b: u8,
    }

    /// Check if both sides of a relationship have Accepted status (3)
    /// Used to verify mutual contact status without revealing individual states
    #[instruction]
    pub fn is_mutual_contact(
        status: Enc<Shared, RelationshipStatus>,
    ) -> Enc<Shared, bool> {
        let s = status.to_arcis();
        let result = s.status_a == 3 && s.status_b == 3; // 3 = Accepted
        status.owner.from_arcis(result)
    }

    /// Encrypted contact entry (used by count_accepted)
    #[derive(Debug, Clone, Copy)]
    pub struct ContactEntry {
        pub pubkey: [u8; 32],
        pub status: u8, // 0=empty, 1=pending, 2=accepted, 3=rejected, 4=blocked
    }

    /// Encrypted contact list with fixed size (used by count_accepted)
    #[derive(Debug, Clone, Copy)]
    pub struct ContactList {
        pub contacts: [ContactEntry; MAX_CONTACTS],
        pub count: u32,
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
