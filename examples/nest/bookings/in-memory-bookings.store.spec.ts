import { bookingsStoreContract } from './bookings-store.contract.js';
import { InMemoryBookingsStore } from './in-memory-bookings.store.js';

// The fake store, held to the same tests as the real one (examples/nest/typeorm runs this
// contract against MySQL). Every unit test that uses the fake relies on it behaving like the
// database; without this, a fake that is wrong makes those tests pass for the wrong reason.

bookingsStoreContract('InMemoryBookingsStore', () => {
  const store = new InMemoryBookingsStore();
  return { store, addHall: capacity => Promise.resolve(store.addHall({ capacity })) };
});
