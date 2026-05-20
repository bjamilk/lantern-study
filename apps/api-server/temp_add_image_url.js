const { Client } = require('pg');

(async () => {
  const client = new Client({
    host: '127.0.0.1',
    port: 54322,
    user: 'postgres',
    password: 'postgres',
    database: 'postgres',
  });

  try {
    await client.connect();
    console.log('Connected to Postgres');
    await client.query('ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS image_url TEXT');
    const res = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='flashcards' ORDER BY column_name");
    console.log('flashcards columns:', res.rows.map(r => r.column_name).join(', '));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
})();
