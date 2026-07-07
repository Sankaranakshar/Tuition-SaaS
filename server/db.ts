import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const dbPath = path.resolve(process.cwd(), "database.sqlite");
export const db = new Database(dbPath);

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT,
      role TEXT NOT NULL, -- 'tutor', 'parent', 'student'
      name TEXT NOT NULL,
      phone TEXT,
      timezone TEXT,
      google_refresh_token TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tutor_id TEXT NOT NULL,
      name TEXT NOT NULL,
      grade TEXT,
      subject TEXT,
      fee_structure TEXT, -- 'hourly', 'monthly'
      fee_amount REAL,
      parent_id TEXT,
      student_user_id TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(tutor_id) REFERENCES users(id),
      FOREIGN KEY(parent_id) REFERENCES users(id),
      FOREIGN KEY(student_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tutor_id TEXT NOT NULL,
      student_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      is_online BOOLEAN DEFAULT 0,
      meet_link TEXT,
      status TEXT DEFAULT 'scheduled', -- 'scheduled', 'completed', 'no_show', 'cancelled'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(tutor_id) REFERENCES users(id),
      FOREIGN KEY(student_id) REFERENCES students(id)
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tutor_id TEXT NOT NULL,
      student_id INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      category TEXT NOT NULL, -- 'homework', 'notes', 'tests'
      notes TEXT,
      uploaded_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(tutor_id) REFERENCES users(id),
      FOREIGN KEY(student_id) REFERENCES students(id),
      FOREIGN KEY(uploaded_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tutor_id TEXT NOT NULL,
      student_id INTEGER NOT NULL,
      parent_id TEXT,
      amount REAL NOT NULL,
      issue_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT DEFAULT 'unpaid', -- 'paid', 'unpaid', 'overdue'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(tutor_id) REFERENCES users(id),
      FOREIGN KEY(student_id) REFERENCES students(id),
      FOREIGN KEY(parent_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id TEXT NOT NULL,
      receiver_id TEXT NOT NULL,
      content TEXT NOT NULL,
      read_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sender_id) REFERENCES users(id),
      FOREIGN KEY(receiver_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_classes_tutor_date ON classes(tutor_id, date, start_time);
    CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver ON messages(sender_id, receiver_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_students_tutor ON students(tutor_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_tutor_date ON invoices(tutor_id, issue_date);
    CREATE INDEX IF NOT EXISTS idx_documents_tutor_date ON documents(tutor_id, created_at);
  `);
}
