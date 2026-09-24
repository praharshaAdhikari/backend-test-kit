import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

export interface Note {
  id: number;
  title: string;
  body: string;
}

/** Reads and writes notes with plain SQL (mysql2). The same ideas apply to TypeORM or Prisma. */
export class NotesRepository {
  constructor(private readonly pool: Pool) {}

  async create(title: string, body: string): Promise<Note> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      'INSERT INTO example_notes (title, body) VALUES (?, ?)',
      [title, body]
    );
    return { id: result.insertId, title, body };
  }

  async list(): Promise<Note[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT id, title, body FROM example_notes ORDER BY id'
    );
    return rows as Note[];
  }

  /** Saves all the notes or none of them. */
  async createAll(notes: { title: string; body: string }[]): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const note of notes) {
        await conn.execute('INSERT INTO example_notes (title, body) VALUES (?, ?)', [
          note.title,
          note.body
        ]);
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }
}
