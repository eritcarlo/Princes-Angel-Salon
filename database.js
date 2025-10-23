const Database = require('better-sqlite3');
const db = new Database('salon.db');

// Helper to safely add new columns
function ensureColumnExists(table, column, definition) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = existing.some(col => col.name === column);
  if (!exists) {
    console.log(`🟡 Adding missing column '${column}' to '${table}'...`);
    try {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
      console.log(`✅ Column '${column}' added to '${table}'.`);
    } catch (err) {
      console.error(`⚠️ Failed to add column '${column}' to '${table}':`, err.message);
    }
  }
}

// ------------------- TABLES -------------------

// Users table
db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT NOT NULL,
    password TEXT NOT NULL,
    role TEXT CHECK(role IN ('user','admin','superadmin')) NOT NULL DEFAULT 'user'
  )
`).run();

// Stylists table
db.prepare(`
  CREATE TABLE IF NOT EXISTS stylists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    specialty TEXT NOT NULL,
    image TEXT
  )
    
`).run();




// Appointments table
db.prepare(`
  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    service TEXT NOT NULL,
    stylist_id INTEGER,
    stylist TEXT,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending',
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (stylist_id) REFERENCES stylists(id)
  )
`).run();

// Stylist availability table
db.prepare(`
  CREATE TABLE IF NOT EXISTS stylist_availability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stylist_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    time_slot TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Available',
    FOREIGN KEY (stylist_id) REFERENCES stylists(id)
  )
`).run();

// ------------------- MIGRATE FEEDBACK TABLE -------------------
// If old table exists with NOT NULL stylist_id, migrate to new table
const feedbackExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='feedback'").get();
if (feedbackExists) {
  // Rename old table
  db.prepare("ALTER TABLE feedback RENAME TO feedback_old").run();
}

// Create new feedback table with optional stylist_id
db.prepare(`
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    stylist_id INTEGER,
    stylist TEXT,
    comment TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (stylist_id) REFERENCES stylists(id)
  )
`).run();

// Copy old data if exists
const oldFeedbackExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='feedback_old'").get();
if (oldFeedbackExists) {
  db.prepare(`
    INSERT INTO feedback (id, user_id, stylist_id, stylist, comment, rating, created_at)
    SELECT id, user_id, stylist_id, stylist, comment, rating, created_at
    FROM feedback_old
  `).run();
  db.prepare("DROP TABLE feedback_old").run();
  console.log("✅ Feedback table migrated with optional stylist_id");
}



// Create services table
db.prepare(`
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    duration INTEGER NOT NULL,
    status TEXT,
    image TEXT
  )
`).run();




// System configuration table
db.prepare(`
  CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    salon_hours TEXT NOT NULL,
    max_daily_bookings INTEGER NOT NULL,
    maintenance_schedule TEXT NOT NULL
  )
`).run();


// Ensure notifications table exists before routes
db.prepare(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER, -- nullable, NULL = global notification
    message TEXT NOT NULL,
    type TEXT DEFAULT 'success',
    is_read BOOLEAN DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS otp (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    otp TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS security_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0
  )
`).run();

db.prepare(`
  UPDATE security_settings
  SET enabled = 0
`).run();

// Drop old table


// Insert default setting
// Recreate table
db.prepare(`
  CREATE TABLE IF NOT EXISTS security_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0
  )
`).run();
// Check if 2FA setting exists
const existing = db
  .prepare("SELECT * FROM security_settings WHERE name = 'Two-Factor Authentication'")
  .get();

if (!existing) {
  // Insert default value (disabled)
  db.prepare(`
    INSERT INTO security_settings (name, enabled)
    VALUES ('Two-Factor Authentication', 0)
  `).run();
}


// ------------------- DEFAULT DATA -------------------
const config = db.prepare("SELECT * FROM system_config LIMIT 1").get();
if (!config) {
  db.prepare(`
    INSERT INTO system_config (salon_hours, max_daily_bookings, maintenance_schedule)
    VALUES (?, ?, ?)
  `).run('10:00 AM - 8:00 PM', 40, 'Sundays 9:00 PM');
  console.log("✅ Default system configuration inserted");
}

// Default superadmin
const superadmin = db.prepare("SELECT * FROM users WHERE role = 'superadmin'").get();
if (!superadmin) {
  const name = "Princess Angel";
  const email = "owner@princesssalon.com";
  const phone = "09123456789";
  const password = "mypassword123"; // ⚠️ should hash in production

  db.prepare("INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, 'superadmin')")
    .run(name, email, phone, password);
  console.log(`✅ Default superadmin created: ${email} / ${password}`);
}


// ------------------- AUTO FIX MISSING COLUMNS -------------------
ensureColumnExists('appointments', 'stylist_id', 'INTEGER');
ensureColumnExists('appointments', 'stylist', 'TEXT');
ensureColumnExists('users', 'created_at', 'TEXT');
ensureColumnExists('feedback', 'stylist_id', 'INTEGER');
ensureColumnExists('feedback', 'stylist', 'TEXT');

module.exports = db;
