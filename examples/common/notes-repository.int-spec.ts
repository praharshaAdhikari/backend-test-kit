import { resetDatabase, testDb } from '../../../test/helpers/database.js';
import { NotesRepository } from './notes-repository.js';

// An integration test: real SQL against the real MySQL that `npm run test:integration` starts.
// It checks what only the database can: the queries, the constraints, the transaction.
//
// In your project the migrations create the tables. This example creates its own, so it runs
// in any project; delete it along with the rest of the examples folder.

describe('NotesRepository (real MySQL)', () => {
  const notes = new NotesRepository(testDb());

  beforeAll(async () => {
    await testDb().query(`CREATE TABLE IF NOT EXISTS example_notes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(100) NOT NULL UNIQUE,
      body TEXT NOT NULL
    )`);
  });

  afterAll(async () => {
    await testDb().query('DROP TABLE IF EXISTS example_notes');
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('saves a note and lists it back', async () => {
    const saved = await notes.create('Groceries', 'Milk, rice');

    expect(await notes.list()).toEqual([{ id: saved.id, title: 'Groceries', body: 'Milk, rice' }]);
  });

  it('lists notes in the order they were saved', async () => {
    await notes.create('First', 'a');
    await notes.create('Second', 'b');

    expect((await notes.list()).map(note => note.title)).toEqual(['First', 'Second']);
  });

  it('refuses a second note with the same title (the UNIQUE constraint)', async () => {
    await notes.create('Groceries', 'Milk');

    await expect(notes.create('Groceries', 'Rice')).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
  });

  it('saves none of the notes when one of them fails', async () => {
    await expect(
      notes.createAll([
        { title: 'One', body: 'a' },
        { title: 'One', body: 'duplicate title, so this insert fails' }
      ])
    ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });

    expect(await notes.list()).toEqual([]);
  });

  it('starts every test with an empty table (resetDatabase)', async () => {
    expect(await notes.list()).toEqual([]);
  });
});
