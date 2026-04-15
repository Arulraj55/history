const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required. Set your Neon PostgreSQL connection string in environment variables.');
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(80) UNIQUE NOT NULL,
      user_class VARCHAR(20) NOT NULL,
      password_hash TEXT NOT NULL,
      syllabus VARCHAR(40),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS quiz_history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      chapter_name TEXT NOT NULL,
      chapter_number INTEGER NOT NULL DEFAULT 0,
      syllabus VARCHAR(40) NOT NULL DEFAULT '',
      term VARCHAR(40),
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      questions JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  console.log('Database initialized successfully (PostgreSQL)');
}

// ==================== USER FUNCTIONS ====================

async function createUser(username, userClass, password) {
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    const result = await pool.query(
      `
        INSERT INTO users (username, user_class, password_hash)
        VALUES ($1, $2, $3)
        RETURNING id
      `,
      [username, userClass, hashedPassword]
    );
    return { success: true, userId: result.rows[0].id };
  } catch (err) {
    if (err.code === '23505') {
      return { success: false, error: 'Username already exists' };
    }
    throw err;
  }
}

async function loginUser(username, password) {
  const result = await pool.query(
    `
      SELECT id, username, user_class, password_hash, syllabus
      FROM users
      WHERE username = $1
      LIMIT 1
    `,
    [username]
  );

  const user = result.rows[0];
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return { success: false, error: 'Invalid password' };
  }

  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      class: user.user_class,
      syllabus: user.syllabus
    }
  };
}

async function updateSyllabus(userId, syllabus) {
  await pool.query(
    'UPDATE users SET syllabus = $1 WHERE id = $2',
    [syllabus, userId]
  );
  return { success: true };
}

async function getUserById(userId) {
  const result = await pool.query(
    `
      SELECT id, username, user_class, syllabus
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );
  const user = result.rows[0];
  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    class: user.user_class,
    syllabus: user.syllabus
  };
}

// ==================== QUIZ HISTORY FUNCTIONS ====================

async function saveQuizResult(userId, chapterName, chapterNumber, syllabus, term, score, total, questions) {
  await pool.query(
    `
      INSERT INTO quiz_history (
        user_id,
        chapter_name,
        chapter_number,
        syllabus,
        term,
        score,
        total,
        questions
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    `,
    [userId, chapterName, chapterNumber, syllabus, term || null, score, total, JSON.stringify(questions || [])]
  );
  return { success: true };
}

async function getQuizHistory(userId) {
  const result = await pool.query(
    `
      SELECT
        id,
        user_id,
        chapter_name,
        chapter_number,
        syllabus,
        term,
        score,
        total,
        questions,
        created_at
      FROM quiz_history
      WHERE user_id = $1
      ORDER BY created_at DESC
    `,
    [userId]
  );
  return result.rows;
}

module.exports = {
  initializeDatabase,
  createUser,
  loginUser,
  updateSyllabus,
  getUserById,
  saveQuizResult,
  getQuizHistory
};
