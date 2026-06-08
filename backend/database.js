const path = require("path");
const sqlite3 = require("sqlite3").verbose();
// Keep DB file beside server code under backend/
const dbName = path.join(__dirname, "zstore.db");

const db = new sqlite3.Database(dbName, (err) => {
  if (err) {
    console.error(err.message);
  } else {
    console.log("Connected to the SQLite database.");
    initDb();
  }
});

function seedDefaultUsers() {
  const bcrypt = require("bcryptjs");
  const adminHash = bcrypt.hashSync("AdminPass2024!", 10);
  const userHash = bcrypt.hashSync("UserPass2024!", 10);
  db.run(
    `INSERT OR IGNORE INTO users (userid, email, password, is_admin, display_name) VALUES (?, ?, ?, ?, ?)`,
    [1, "admin@zstore.local", adminHash, 1, "Admin"],
  );
  db.run(
    `INSERT OR IGNORE INTO users (userid, email, password, is_admin, display_name) VALUES (?, ?, ?, ?, ?)`,
    [2, "user@zstore.local", userHash, 0, "Demo User"],
  );
}

function initDb() {
  db.run(
    `CREATE TABLE IF NOT EXISTS users (
      userid INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      display_name TEXT
    )`,
    (e) => {
      if (e) console.error("users table:", e.message);
      else seedDefaultUsers();
    },
  );

  // create Categories table
  db.run(
    `CREATE TABLE IF NOT EXISTS categories (
        catid INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
    )`,
    (err) => {
      if (!err) {
        // insert some initial data
        db.run(
          `INSERT OR IGNORE INTO categories (catid, name) VALUES (1, 'Electronics')`,
        );
        db.run(
          `INSERT OR IGNORE INTO categories (catid, name) VALUES (2, 'Fashion')`,
        );
        db.run(
          `INSERT OR IGNORE INTO categories (catid, name) VALUES (3, 'Home & Garden')`,
        );
        db.run(
          `INSERT OR IGNORE INTO categories (catid, name) VALUES (4, 'Books')`,
        );
        db.run(
          `INSERT OR IGNORE INTO categories (catid, name) VALUES (5, 'Sports')`,
        );
      }
    },
  );

  // create Products table
  db.run(
    `CREATE TABLE IF NOT EXISTS products (
        pid INTEGER PRIMARY KEY AUTOINCREMENT,
        catid INTEGER,
        name TEXT NOT NULL,
        price REAL,
        description TEXT,
        image_path TEXT,
        thumb_path TEXT,
        FOREIGN KEY (catid) REFERENCES categories (catid)
    )`,
    (err) => {
      if (!err) {
        //insert at least two sample products for each category (if not already exists)
        db.run(
          `INSERT OR IGNORE INTO products (pid, catid, name, price, description, image_path, thumb_path)
           VALUES (
             1,
             1,
             'Sony Alpha Camera',
             500.0,
             'High-end mirrorless camera suitable for professionals and enthusiasts.',
             'assets/images/Sony_Alpha_Camera.jpeg',
             'assets/images/Sony_Alpha_Camera.jpeg'
           )`,
        );

        db.run(
          `INSERT OR IGNORE INTO products (pid, catid, name, price, description, image_path, thumb_path)
           VALUES (
             2,
             1,
             'Logitech G Pro Mouse',
             120.0,
             'Lightweight gaming mouse with high precision sensor.',
             'assets/images/Logitech_G_Pro.jpeg',
             'assets/images/Logitech_G_Pro.jpeg'
           )`,
        );

        db.run(
          `INSERT OR IGNORE INTO products (pid, catid, name, price, description, image_path, thumb_path)
           VALUES (
             3,
             2,
             '128GB SD Card',
             40.0,
             'High-speed 128GB SD card for cameras and other devices.',
             'assets/images/128GB_SD_Card.jpeg',
             'assets/images/128GB_SD_Card.jpeg'
           )`,
        );

        db.run(
          `INSERT OR IGNORE INTO products (pid, catid, name, price, description, image_path, thumb_path)
           VALUES (
             4,
             2,
             'Carbon Fiber Tripod',
             120.0,
             'Lightweight carbon fiber tripod ideal for travel photography.',
             'assets/images/Carbon_Tripod.jpeg',
             'assets/images/Carbon_Tripod.jpeg'
           )`,
        );


        // Category 3: Home & Garden
        db.run(
          `INSERT OR IGNORE INTO products (pid, catid, name, price, description, image_path, thumb_path)
           VALUES (
             5,
             3,
             'Cozy Sofa',
             800.0,
             'Comfortable three-seat fabric sofa for your living room.',
             'assets/images/Cozy_Sofa.png',
             'assets/images/Cozy_Sofa.png'
           )`,
        );

        db.run(
          `INSERT OR IGNORE INTO products (pid, catid, name, price, description, image_path, thumb_path)
           VALUES (
             6,
             3,
             'Modern Floor Lamp',
             120.0,
             'Minimalist floor lamp providing warm ambient light.',
             'assets/images/Modern_Floor_Lamp.png',
             'assets/images/Modern_Floor_Lamp.png'
           )`,
        );

        // Category 4: Books
        db.run(
          `INSERT OR IGNORE INTO products (pid, catid, name, price, description, image_path, thumb_path)
           VALUES (
             7,
             4,
             'JavaScript Essentials',
             45.0,
             'Introductory book covering modern JavaScript features and best practices.',
             'assets/images/JavaScript_Essentials.png',
             'assets/images/JavaScript_Essentials.png'
           )`,
        );

        db.run(
          `INSERT OR IGNORE INTO products (pid, catid, name, price, description, image_path, thumb_path)
           VALUES (
             8,
             4,
             'Web Security Handbook',
             60.0,
             'Practical guide to securing modern web applications.',
             'assets/images/Web_Security_Handbook.png',
             'assets/images/Web_Security_Handbook.png'
           )`,
        );

        // Category 5: Sports
        db.run(
          `INSERT OR IGNORE INTO products (pid, catid, name, price, description, image_path, thumb_path)
           VALUES (
             9,
             5,
             'Running Shoes',
             150.0,
             'Lightweight running shoes suitable for daily training.',
             'assets/images/Running_Shoes.png',
             'assets/images/Running_Shoes.png'
           )`,
        );

        db.run(
          `INSERT OR IGNORE INTO products (pid, catid, name, price, description, image_path, thumb_path)
           VALUES (
             10,
             5,
             'Yoga Mat',
             35.0,
             'Non-slip yoga mat with comfortable cushioning.',
            'assets/images/Yoga_Mat.png',
            'assets/images/Yoga_Mat.png'
           )`,
        );

      }
    },
  );

  // order lifecycle + tamper-evident digest + idempotent webhook processing.
  db.run(
    `CREATE TABLE IF NOT EXISTS orders (
      order_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      user_email TEXT NOT NULL,
      currency TEXT NOT NULL,
      merchant_email TEXT NOT NULL,
      salt TEXT NOT NULL,
      digest TEXT NOT NULL,
      total_price REAL NOT NULL,
      subtotal_price REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      voucher_code TEXT,
      payment_status TEXT NOT NULL DEFAULT 'pending',
      gateway_order_id TEXT,
      paid_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (userid)
    )`,
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      pid INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      product_name TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders (order_id),
      FOREIGN KEY (pid) REFERENCES products (pid)
    )`,
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS processed_webhooks (
      event_id TEXT PRIMARY KEY,
      processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS transactions (
      transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      order_id INTEGER NOT NULL,
      gateway_order_id TEXT,
      payment_status TEXT NOT NULL,
      currency TEXT NOT NULL,
      total_price REAL NOT NULL,
      raw_payload TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders (order_id)
    )`,
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS transaction_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      pid INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      product_name TEXT,
      FOREIGN KEY (transaction_id) REFERENCES transactions (transaction_id)
    )`,
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      discount_amount REAL NOT NULL,
      quota INTEGER NOT NULL DEFAULT 0,
      used_count INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    (err) => {
      if (!err) {
        db.run(
          `INSERT OR IGNORE INTO vouchers (code, discount_amount, quota, used_count, is_active)
           VALUES ('EASTER12', 5.0, 100, 0, 1)`,
        );
        db.run(
          `INSERT OR IGNORE INTO vouchers (code, discount_amount, quota, used_count, is_active)
           VALUES ('WELCOME10', 10.0, 100, 0, 1)`,
        );
      }
    },
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (userid)
    )`,
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS product_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      pid INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders (order_id),
      FOREIGN KEY (user_id) REFERENCES users (userid),
      FOREIGN KEY (pid) REFERENCES products (pid),
      UNIQUE (order_id, user_id, pid)
    )`,
  );

  db.run(
    `CREATE INDEX IF NOT EXISTS idx_product_reviews_pid_created
     ON product_reviews (pid, created_at DESC)`,
  );

  // Backward compatible migration for databases created before phase 6/7 updates.
  db.all(`PRAGMA table_info(orders)`, [], (err, rows) => {
    if (err || !Array.isArray(rows)) return;
    const colSet = new Set(rows.map((r) => r.name));
    if (!colSet.has("subtotal_price")) {
      db.run(`ALTER TABLE orders ADD COLUMN subtotal_price REAL NOT NULL DEFAULT 0`);
    }
    if (!colSet.has("discount_amount")) {
      db.run(`ALTER TABLE orders ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0`);
    }
    if (!colSet.has("voucher_code")) {
      db.run(`ALTER TABLE orders ADD COLUMN voucher_code TEXT`);
    }
  });
}

module.exports = db;
