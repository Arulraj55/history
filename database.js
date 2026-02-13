const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'data.json');

// Default DB structure
const DEFAULT_DB = {
  users: [],
  quizHistory: [],
  nextUserId: 1,
  nextQuizId: 1
};

function readDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error reading DB:', err);
  }
  return { ...DEFAULT_DB };
}

function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

function initializeDatabase() {
  if (!fs.existsSync(DB_PATH)) {
    writeDB(DEFAULT_DB);
  }
  console.log('Database initialized successfully');
}

// ==================== USER FUNCTIONS ====================

function createUser(username, userClass, password) {
  const db = readDB();
  const existing = db.users.find(u => u.username === username);
  if (existing) {
    return { success: false, error: 'Username already exists' };
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  const user = {
    id: db.nextUserId++,
    username,
    class: userClass,
    password: hashedPassword,
    syllabus: null,
    created_at: new Date().toISOString()
  };

  db.users.push(user);
  writeDB(db);
  return { success: true, userId: user.id };
}

function loginUser(username, password) {
  const db = readDB();
  const user = db.users.find(u => u.username === username);
  if (!user) {
    return { success: false, error: 'User not found' };
  }
  if (!bcrypt.compareSync(password, user.password)) {
    return { success: false, error: 'Invalid password' };
  }
  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      class: user.class,
      syllabus: user.syllabus
    }
  };
}

function updateSyllabus(userId, syllabus) {
  const db = readDB();
  const user = db.users.find(u => u.id === userId);
  if (user) {
    user.syllabus = syllabus;
    writeDB(db);
  }
  return { success: true };
}

function getUserById(userId) {
  const db = readDB();
  const user = db.users.find(u => u.id === userId);
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    class: user.class,
    syllabus: user.syllabus
  };
}

// ==================== QUIZ HISTORY FUNCTIONS ====================

function saveQuizResult(userId, chapterName, chapterNumber, syllabus, term, score, total, questions) {
  const db = readDB();
  const entry = {
    id: db.nextQuizId++,
    user_id: userId,
    chapter_name: chapterName,
    chapter_number: chapterNumber,
    syllabus,
    term: term || null,
    score,
    total,
    questions,
    created_at: new Date().toISOString()
  };
  db.quizHistory.push(entry);
  writeDB(db);
  return { success: true };
}

function getQuizHistory(userId) {
  const db = readDB();
  return db.quizHistory
    .filter(q => q.user_id === userId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
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
