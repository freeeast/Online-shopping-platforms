-- Phase 4 Section B: users table (password column stores bcrypt hash; salt is embedded in the hash string).
-- Default seed rows are inserted by backend/database.js on first run (INSERT OR IGNORE).
-- To rebuild manually, run this file then start the server once so seedDefaultUsers runs, or insert users via app register API.

CREATE TABLE IF NOT EXISTS users (
  userid INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  display_name TEXT
);
