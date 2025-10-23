const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const db = require('./database');
const app = express();
const PORT = process.env.PORT || 3000;
const nodemailer = require('nodemailer');
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Register
app.post('/api/register', (req, res) => {
  const { name, email, phone, password } = req.body; // ❌ don't take role from frontend
  try {
    const stmt = db.prepare(
      'INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)'
    );
    stmt.run(name, email, phone, password, 'user'); // ✅ always "registered" for customers
    res.json({ success: true });
  } catch (err) {
    console.error('[Register Error]', err.message);

    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.json({ success: false, message: 'Registration failed. Email already exists.' });
    } else {
      console.log(error);
      res.json({ success: false, message: 'Registration failed. Server error.' });
    }
  }
});


/*/ Login
app.post('/api/login', (req, res) => {
  console.log(req.body);
  const { email, password } = req.body;
  try {
    const stmt = db.prepare('SELECT * FROM users WHERE email = ? AND password = ?');
    const user = stmt.get(email, password);
    if (user) {
      const { id, name, email, phone, role } = user;
      res.json({ success: true, user: { id, name, email, phone, role } });
    } else {
      res.json({ success: false, message: 'Invalid credentials' });
    }
  } catch (err) {
    console.error('[Login Error]', err.message);
    res.json({ success: false, message: 'Login failed' });
  }
});*/
// Book Appointment (with past-date + config checks)
app.post('/api/book-appointment', (req, res) => {
  const { userId, service, stylist, date, time } = req.body;

  try {
    const appointmentDateTime = new Date(`${date}T${time}`);
    const now = new Date();

    // 1️⃣ Block booking past dates or times
    if (appointmentDateTime <= now) {
      return res.json({ success: false, message: "You cannot book an appointment in the past." });
    }

    // 2️⃣ Get system config
    const config = db.prepare(`SELECT * FROM system_config WHERE id = 1`).get();

    if (!config) {
      return res.json({ success: false, message: "System configuration not found." });
    }


// Check daily booking limit (ignores cancelled ones)
if (config.max_daily_bookings) {
  const countStmt = db.prepare(`
    SELECT COUNT(*) as count 
    FROM appointments 
    WHERE date = ? AND status != 'Cancelled'
  `);
  const { count } = countStmt.get(date);

  if (count >= config.max_daily_bookings) {
    return res.json({ success: false, message: "Daily booking limit reached. Please choose another date." });
  }
}


// 5️⃣ Check salon hours (full HH:mm check)
if (config.salon_hours) {
  const [open, close] = config.salon_hours.split('-').map(t => t.trim());

  // Convert times into Date objects for comparison
  const bookingTime = new Date(`${date}T${time}`);
  const openTime = new Date(`${date}T${open}`);
  const closeTime = new Date(`${date}T${close}`);

  if (bookingTime < openTime || bookingTime >= closeTime) {
    return res.json({ success: false, message: "Selected time is outside salon hours." });
  }
}


    // 6️⃣ Insert booking if all checks pass
    const stmt = db.prepare(`
      INSERT INTO appointments (user_id, service, stylist, date, time, status)
      VALUES (?, ?, ?, ?, ?, 'Pending')
    `);
    stmt.run(userId, service, stylist, date, time);

    res.json({ success: true, message: "Booking created successfully" });

  } catch (err) {
    console.error('[Booking Error]', err.message);
    res.json({ success: false, message: 'Error booking appointment' });
  }
});




// Admin: Get All Appointments
app.get('/api/admin/appointments', (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT a.id, a.date, a.time, a.service, a.stylist, a.status, u.name AS customer_name
      FROM appointments a
      JOIN users u ON a.user_id = u.id
      ORDER BY a.date ASC, a.time ASC
    `);
    const appointments = stmt.all();
    res.json({ success: true, appointments });
  } catch (err) {
    console.error('[Admin Fetch Appointments Error]', err.message);
    res.json({ success: false, message: 'Failed to fetch appointments' });
  }
});

// Appointment Actions
app.patch('/api/cancel-appointment/:id', (req, res) => {
  try {
    const stmt = db.prepare("UPDATE appointments SET status = 'Cancelled' WHERE id = ?");
    const result = stmt.run(req.params.id);
    res.json({ success: result.changes > 0 });
  } catch (err) {
    console.error('[Cancel Error]', err.message);
    res.json({ success: false, message: 'Error cancelling appointment' });
  }
});

// Reschedule Appointment (with strict past-date check)
app.patch('/api/reschedule-appointment/:id', (req, res) => {
  const { date, time } = req.body;

  try {
    // Ensure format: YYYY-MM-DD + HH:mm
    const appointmentDateTime = new Date(`${date}T${time}:00`);
    const now = new Date();

    if (isNaN(appointmentDateTime.getTime())) {
      return res.json({ success: false, message: "Invalid date or time format." });
    }

    // 🚫 Block rescheduling into the past
    if (appointmentDateTime <= now) {
      return res.json({ success: false, message: "You cannot reschedule to a past date or time." });
    }

    const stmt = db.prepare(`
      UPDATE appointments
      SET date = ?, time = ?, status = 'Rescheduled'
      WHERE id = ?
    `);
    const result = stmt.run(date, time, req.params.id);

    res.json({ success: result.changes > 0 });
  } catch (err) {
    console.error('[Reschedule Error]', err.message);
    res.json({ success: false, message: 'Error rescheduling appointment' });
  }
});





// Customer Management
app.get('/api/admin/customers', (req, res) => {
  try {
    const stmt = db.prepare("SELECT id, name, email, phone FROM users WHERE role = 'user'");
    const customers = stmt.all();
    res.json({ success: true, customers });
  } catch (err) {
    console.error('[Admin Get Customers Error]', err.message);
    res.json({ success: false, message: 'Error retrieving customers' });
  }
});

app.delete('/api/admin/delete-user/:id', (req, res) => {
  try {
    const stmt = db.prepare("DELETE FROM users WHERE id = ? AND role = 'registered'");
    const result = stmt.run(req.params.id);
    res.json({ success: result.changes > 0 });
  } catch (err) {
    console.error('[Delete Customer Error]', err.message);
    res.json({ success: false, message: 'Error deleting user' });
  }
});

// Profile and Password
app.patch('/api/update-profile/:id', (req, res) => {
  const { name, email, phone } = req.body;
  try {
    const stmt = db.prepare("UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ?");
    const result = stmt.run(name, email, phone, req.params.id);
    res.json({ success: result.changes > 0 });
  } catch (err) {
    console.error('[Update Profile Error]', err.message);
    res.json({ success: false, message: 'Error updating profile' });
  }
});

app.patch('/api/change-password/:id', (req, res) => {
  const { currentPassword, newPassword } = req.body;
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND password = ?').get(req.params.id, currentPassword);
    if (!user) return res.json({ success: false, message: 'Current password is incorrect' });
    const stmt = db.prepare('UPDATE users SET password = ? WHERE id = ?');
    const result = stmt.run(newPassword, req.params.id);
    res.json({ success: result.changes > 0 });
  } catch (err) {
    console.error('[Change Password Error]', err.message);
    res.json({ success: false, message: 'Error changing password' });
  }
});

// Stylist Management
app.get('/api/admin/stylists', (req, res) => {
  try {
    const stylists = db.prepare('SELECT * FROM stylists').all();
    res.json({ success: true, stylists });
  } catch (err) {
    console.error('[Get Stylists Error]', err.message);
    res.json({ success: false, message: 'Error fetching stylists' });
  }
});

app.post('/api/admin/add-stylist', (req, res) => {
  const { name, specialty } = req.body;
  try {
    const stmt = db.prepare('INSERT INTO stylists (name, specialty) VALUES (?, ?)');
    stmt.run(name, specialty);
    res.json({ success: true });
  } catch (err) {
    console.error('[Add Stylist Error]', err.message);
    res.json({ success: false, message: 'Error adding stylist' });
  }
});

app.patch('/api/admin/update-stylist/:id', (req, res) => {
  const { name, specialty } = req.body;
  try {
    const stmt = db.prepare('UPDATE stylists SET name = ?, specialty = ? WHERE id = ?');
    const result = stmt.run(name, specialty, req.params.id);
    res.json({ success: result.changes > 0 });
  } catch (err) {
    console.error('[Update Stylist Error]', err.message);
    res.json({ success: false, message: 'Error updating stylist' });
  }
});

app.delete('/api/admin/delete-stylist/:id', (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM stylists WHERE id = ?');
    const result = stmt.run(req.params.id);
    res.json({ success: result.changes > 0 });
  } catch (err) {
    console.error('[Delete Stylist Error]', err.message);
    res.json({ success: false, message: 'Error deleting stylist' });
  }
});

// Public: Get stylists for booking
app.get('/api/stylists', (req, res) => {
  try {
    const stylists = db.prepare("SELECT * FROM stylists").all();
    res.json({ success: true, stylists });
  } catch (err) {
    console.error('[Public Get Stylists Error]', err.message);
    res.json({ success: false, message: 'Error fetching stylists' });
  }
});

// Stylist Availability
app.get('/api/admin/availability', (req, res) => {
  try {
    const availability = db.prepare('SELECT sa.id, sa.stylist_id, s.name AS stylist, sa.day, sa.time_slot, sa.status FROM stylist_availability sa JOIN stylists s ON sa.stylist_id = s.id').all();
    res.json({ success: true, availability });
  } catch (err) {
    console.error('[Get Availability Error]', err.message);
    res.json({ success: false, message: 'Error fetching availability' });
  }
});

app.post('/api/admin/add-availability', (req, res) => {
  const { stylist_id, day, time_slot } = req.body;
  try {
const stmt = db.prepare('INSERT INTO stylist_availability (stylist_id, day, time_slot, status) VALUES (?, ?, ?, ?)');
stmt.run(stylist_id, day, time_slot, 'Available');
    res.json({ success: true });
  } catch (err) {
    console.error('[Add Availability Error]', err.message);
    res.json({ success: false, message: 'Error adding availability' });
  }
});

app.patch('/api/admin/update-availability/:id', (req, res) => {
  const { stylist_id, day, time_slot } = req.body;
  try {
    const stmt = db.prepare('UPDATE stylist_availability SET stylist_id = ?, day = ?, time_slot = ? WHERE id = ?');
    const result = stmt.run(stylist_id, day, time_slot, req.params.id);
    res.json({ success: result.changes > 0 });
  } catch (err) {
    console.error('[Update Availability Error]', err.message);
    res.json({ success: false, message: 'Error updating availability' });
  }
});

app.delete('/api/admin/delete-availability/:id', (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM stylist_availability WHERE id = ?');
    const result = stmt.run(req.params.id);
    res.json({ success: result.changes > 0 });
  } catch (err) {
    console.error('[Delete Availability Error]', err.message);
    res.json({ success: false, message: 'Error deleting availability' });
  }
});
// ---------------- SERVICE MANAGEMENT ----------------
// ✅ Get all services (admin)
app.get('/api/admin/services', (req, res) => {
  try {
    const services = db.prepare('SELECT * FROM services ORDER BY id DESC').all();
    res.json({ success: true, services });
  } catch (err) {
    console.error('[Get Services Error]', err.message);
    res.json({ success: false, message: 'Failed to fetch services' });
  }
});

// ✅ Add new service
app.post('/api/admin/add-service', (req, res) => {
  const { name, description, price, duration, image } = req.body;
  try {
    const stmt = db.prepare('INSERT INTO services (name, description, price, duration, image, status) VALUES (?, ?, ?, ?, ?, ?)');
    stmt.run(name, description, price, duration, image || '', 'Active');
    res.json({ success: true });
  } catch (err) {
    console.error('[Add Service Error]', err.message);
    res.json({ success: false, message: 'Error adding service' });
  }
});

// ✅ Update service
app.patch('/api/admin/update-service/:id', (req, res) => {
  const { name, description, price, duration, status, image } = req.body;
  try {
    const stmt = db.prepare('UPDATE services SET name = ?, description = ?, price = ?, duration = ?, status = ?, image = ? WHERE id = ?');
    const result = stmt.run(name, description, price, duration, status || 'Active', image || '', req.params.id);
    res.json({ success: result.changes > 0 });
  } catch (err) {
    console.error('[Update Service Error]', err.message);
    res.json({ success: false, message: 'Error updating service' });
  }
});

// ✅ Delete service
app.delete('/api/admin/delete-service/:id', (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM services WHERE id = ?');
    const result = stmt.run(req.params.id);
    res.json({ success: result.changes > 0 });
  } catch (err) {
    console.error('[Delete Service Error]', err.message);
    res.json({ success: false, message: 'Error deleting service' });
  }
});

// ✅ Public route: Get available services (for customers)
app.get('/api/services', (req, res) => {
  try {
    const services = db.prepare("SELECT id, name, description, price, duration, image FROM services WHERE status = 'Active'").all();
    res.json({ success: true, services });
  } catch (err) {
    console.error('[Public Get Services Error]', err.message);
    res.json({ success: false, message: 'Error fetching services' });
  }
});

// Submit Feedback
app.post('/api/submit-feedback', (req, res) => {
  const { userId, stylist, rating, comments } = req.body;
  try {
    const stmt = db.prepare('INSERT INTO feedback (user_id, stylist, comment, rating) VALUES (?, ?, ?, ?)');
    stmt.run(userId, stylist, comments, rating);
    res.json({ success: true });
  } catch (err) {
    console.error('[Feedback Error]', err.message);
    res.json({ success: false, message: 'Failed to submit feedback' });
  }
});

// Admin: Get All Feedback
app.get('/api/admin/feedback', (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT 
        f.id,
        f.user_id,
        u.name AS customer_name,
        f.stylist,
        f.rating,
        f.comment,
        f.created_at
      FROM feedback f
      JOIN users u ON f.user_id = u.id
      ORDER BY f.id DESC
    `);
    const feedback = stmt.all();
    res.json({ success: true, feedback });
  } catch (err) {
    console.error('[Admin Feedback Fetch Error]', err.message);
    res.json({ success: false, message: 'Failed to retrieve feedback' });
  }
});

// Admin: Delete feedback (useful for admin UI delete button)
app.delete('/api/admin/feedback/:id', (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM feedback WHERE id = ?');
    const result = stmt.run(req.params.id);
    res.json({ success: result.changes > 0 });
  } catch (err) {
    console.error('[Delete Feedback Error]', err.message);
    res.json({ success: false, message: 'Error deleting feedback' });
  }
});

// ✅ NEW: Admin - Get Total Feedback Count
app.get('/api/admin/total-feedback', (req, res) => {
  try {
    const result = db.prepare('SELECT COUNT(*) AS total FROM feedback').get();
    res.json({ success: true, total: result.total });
  } catch (err) {
    console.error('[Total Feedback Count Error]', err.message);
    res.json({ success: false, message: 'Failed to count feedback' });
  }
});


// ---------------- SUPERADMIN ROUTES ----------------

// Get system overview
app.get('/superadmin/overview', (req, res) => {
  try {
    const admins = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE role = 'admin'`).get().count;
    const customers = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE role = 'user'`).get().count;
    const stylists = db.prepare(`SELECT COUNT(*) AS count FROM stylists`).get().count;
    const appointments = db.prepare(`SELECT COUNT(*) AS count FROM appointments`).get().count;

    // ✅ Compute total
    const total = admins + customers + stylists + appointments;

    res.json({ admins, customers, stylists, appointments, total });
  } catch (err) {
    console.error('[Superadmin Overview Error]', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch overview' });
  }
});

// Get all roles
app.get('/superadmin/roles', (req, res) => {
  try {
    const roles = db.prepare(`SELECT * FROM roles`).all();
    res.json(roles);
  } catch (err) {
    console.error('[Superadmin Roles Error]', err.message);
    res.json([]);
  }
});

// Add new role
app.post('/superadmin/roles', (req, res) => {
  const { name, permissions } = req.body;
  try {
    db.prepare(`INSERT INTO roles (name, permissions) VALUES (?, ?)`).run(name, permissions);
    res.json({ success: true });
  } catch (err) {
    console.error('[Superadmin Add Role Error]', err.message);
    res.json({ success: false, message: 'Failed to add role' });
  }
});

// Update role
app.put('/superadmin/roles/:id', (req, res) => {
  const { id } = req.params;
  const { name, permissions } = req.body;
  try {
    db.prepare(`UPDATE roles SET name = ?, permissions = ? WHERE id = ?`).run(name, permissions, id);
    res.json({ success: true });
  } catch (err) {
    console.error('[Superadmin Update Role Error]', err.message);
    res.json({ success: false, message: 'Failed to update role' });
  }
});

// 📌 Get all admins
app.get("/superadmin/admins", (req, res) => {
  try {
    const admins = db.prepare(`SELECT id, name, email, phone FROM users WHERE role = 'admin'`).all();
    res.json(admins);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 📌 Add admin with password validation
app.post("/superadmin/admins", (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    // Gmail check
    if (!/^[\w.%+-]+@gmail\.com$/i.test(email)) {
      return res.status(400).json({ success: false, error: 'Email must be a Gmail address' });
    }

    // Phone check
    if (!/^09\d{9}$/.test(phone)) {
      return res.status(400).json({ success: false, error: 'Phone must be 11 digits starting with 09' });
    }

    // Password strength check
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/.test(password)) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters long, contain uppercase, lowercase, number, and special character'
      });
    }

    // 🚫 No hashing — directly storing plain text password (for testing only!)
    const stmt = db.prepare(`
      INSERT INTO users (name, email, phone, password, role)
      VALUES (?, ?, ?, ?, 'admin')
    `);
    const result = stmt.run(name, email, phone, password);

    res.json({
      success: true,
      message: 'Admin added successfully',
      admin: { id: result.lastInsertRowid, name, email, phone, password }
    });
  } catch (err) {
    console.error('Error adding admin:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});


// 📌 Update an admin
// ✅ Update Admin (with password validation)
app.put('/superadmin/admins/:id', (req, res) => {
  const { name, email, phone, password } = req.body;

  // --- Password strength check ---
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
  if (!passwordRegex.test(password)) {
    return res.json({
      success: false,
      message:
        'Password must be at least 8 characters long and include uppercase, lowercase, number, and special character'
    });
  }

  try {
    const stmt = db.prepare(`
      UPDATE users 
      SET name = ?, email = ?, phone = ?, password = ?
      WHERE id = ? AND role = 'admin'
    `);
    const result = stmt.run(name, email, phone, password, req.params.id);

    if (result.changes > 0) {
      res.json({ success: true, message: 'Admin updated successfully' });
    } else {
      res.json({ success: false, message: 'Admin not found or no changes made' });
    }
  } catch (err) {
    console.error('[Update Admin Error]', err.message);
    res.json({ success: false, message: 'Error updating admin' });
  }
});


// 📌 Delete an admin
app.delete("/superadmin/admins/:id", (req, res) => {
  try {
    db.prepare(`DELETE FROM users WHERE id = ? AND role = 'admin'`).run(req.params.id);
    res.json({ success: true, message: "Admin deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get security settings
app.get('/superadmin/security', (req, res) => {
  try {
    const settings = db.prepare(`SELECT * FROM security_settings`).all();
    res.json(settings);
  } catch (err) {
    console.error('[Superadmin Security Error]', err.message);
    res.json([]);
  }
});

// Update security setting
app.put('/superadmin/security/:id', (req, res) => {
  const { id } = req.params;
  const { value } = req.body;
  try {
    db.prepare(`UPDATE security_settings SET value = ? WHERE id = ?`).run(value, id);
    res.json({ success: true });
  } catch (err) {
    console.error('[Superadmin Update Security Error]', err.message);
    res.json({ success: false });
  }
});

//  Get system configuration (always only 1 row)
app.get('/superadmin/config', (req, res) => {
  try {
    const config = db.prepare(`SELECT * FROM system_config LIMIT 1`).get();
    res.json({ success: true, config });
  } catch (err) {
    console.error('[Superadmin Config Error]', err.message);
    res.json({ success: false, message: 'Failed to fetch system config' });
  }
});

//  Update system configuration
app.put('/superadmin/config/:id', (req, res) => {
  const { id } = req.params;
  const { salon_hours, max_daily_bookings, maintenance_schedule } = req.body;

  try {
    const stmt = db.prepare(`
      UPDATE system_config
      SET salon_hours = ?, max_daily_bookings = ?, maintenance_schedule = ?
      WHERE id = ?
    `);
    const result = stmt.run(salon_hours, max_daily_bookings, maintenance_schedule, id);

    res.json({ success: result.changes > 0 });
  } catch (err) {
    console.error('[Superadmin Update Config Error]', err.message);
    res.json({ success: false, message: 'Failed to update system config' });
  }
});
// ---------------- SYSTEM REPORTS (PDF EXPORT) ----------------
const PDFDocument = require('pdfkit');

// Helper to draw a table-like rows with page breaks
function drawTable(doc, headers, rows, options = {}) {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startX = doc.x;
  let startY = doc.y;
  const rowHeight = options.rowHeight || 18;
  const headerHeight = options.headerHeight || 20;

  // compute column widths proportionally if not provided
  let colWidths = options.colWidths;
  if (!colWidths) {
    const colCount = headers.length;
    const w = Math.floor(pageWidth / colCount);
    colWidths = new Array(colCount).fill(w);
  }

  function renderHeader() {
    doc.font('Helvetica-Bold').fontSize(10);
    let x = startX;
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i], x, startY, { width: colWidths[i], continued: false });
      x += colWidths[i];
    }
    startY += headerHeight;
    doc.moveTo(doc.x, startY - 4).lineTo(doc.x + pageWidth, startY - 4).stroke();
  }

  renderHeader();

  doc.font('Helvetica').fontSize(9);
  for (const r of rows) {
    // page break check
    if (startY + rowHeight > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage();
      startY = doc.y;
      renderHeader();
    }

    let x = startX;
    for (let i = 0; i < r.length; i++) {
      const text = (r[i] === null || r[i] === undefined) ? '' : String(r[i]);
      doc.text(text, x, startY, { width: colWidths[i] });
      x += colWidths[i];
    }
    startY += rowHeight;
  }

  // move doc.y to after table
  doc.y = startY + 10;
}

// Unified route: /superadmin/reports/:type
app.get('/superadmin/reports/:type', (req, res) => {
  const type = (req.params.type || '').toLowerCase();

  try {
    let title = '';
    let headers = [];
    let rows = [];

    if (type === 'appointments' || type === 'bookings') {
      title = 'Appointments Report';
      headers = ['#', 'Customer', 'Service', 'Stylist', 'Date', 'Time', 'Status'];
      const data = db.prepare(`
        SELECT a.id, u.name AS customer, a.service, s.name AS stylist, a.date, a.time, a.status
        FROM appointments a
        LEFT JOIN users u ON a.user_id = u.id
        LEFT JOIN stylists s ON a.stylist_id = s.id
        ORDER BY a.date DESC, a.time DESC
      `).all();

      rows = data.map((r, i) => [i + 1, r.customer || '', r.service || '', r.stylist || '', r.date || '', r.time || '', r.status || '']);
    } else if (type === 'users') {
      title = 'Users Report';
      headers = ['#', 'Name', 'Email', 'Phone', 'Role', 'Joined'];
      const data = db.prepare(`SELECT id, name, email, phone, role, created_at FROM users ORDER BY created_at DESC`).all();
      rows = data.map((r, i) => [i + 1, r.name || '', r.email || '', r.phone || '', r.role || '', r.created_at || '']);
    } else if (type === 'services') {
      title = 'Services Report';
      headers = ['#', 'Name', 'Price', 'Duration (min)', 'Status', 'Description'];
      const data = db.prepare(`SELECT id, name, price, duration, status, description FROM services ORDER BY id DESC`).all();
      rows = data.map((r, i) => [i + 1, r.name || '', (r.price != null ? Number(r.price).toFixed(2) : ''), r.duration || '', r.status || '', r.description || '']);
    } else {
      return res.status(400).json({ success: false, message: 'Invalid report type' });
    }

    // set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${type}_report.pdf`);

    // create PDF and stream directly to response
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    // Header
    doc.fontSize(18).font('Helvetica-Bold').text('Princess Angel Salon', { align: 'center' });
    doc.moveDown(0.2);
    doc.fontSize(12).font('Helvetica').text(title, { align: 'center' });
    doc.moveDown(0.2);
    doc.fontSize(9).text(`Generated: ${new Date().toLocaleString()}`, { align: 'right' });
    doc.moveDown(0.5);

    // Draw table
    // choose column widths reasonably for A4 (sum must fit page width)
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    // simple widths: first column small, last wide
    let colWidths;
    if (headers.length === 7) { // appointments
      colWidths = [30, 120, 110, 90, 60, 45, 60];
    } else if (headers.length === 6 && type === 'users') {
      colWidths = [30, 140, 140, 90, 50, 70];
    } else if (headers.length === 6 && type === 'services') {
      colWidths = [30, 180, 60, 70, 60, pageWidth - (30+180+60+70+60)];
    } else {
      // fallback equal columns
      colWidths = new Array(headers.length).fill(Math.floor(pageWidth / headers.length));
    }

    drawTable(doc, headers, rows, { colWidths });

    // Footer
    doc.moveDown(1);
    doc.fontSize(9).text('Generated by Super Admin', { align: 'left' });
    doc.end();

    // piping completes response when doc.end() is called
  } catch (err) {
    console.error('[Report Error]', err.message);
    // if headers not yet sent, send json error
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Error generating report' });
    } else {
      res.end();
    }
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server is running on http://localhost:${PORT}`);
});



/*
// Get all notifications
app.get('/api/notifications', (req, res) => {
  try {
    const notifications = db.prepare('SELECT * FROM notifications ORDER BY created_at DESC').all();
    res.json({ success: true, notifications });
  } catch (err) {
    console.error('[Get Notifications Error]', err.message);
    res.json({ success: false, message: 'Failed to fetch notifications' });
  }
});*/

// Mark notification as read
app.patch('/api/notifications/:id/read', (req, res) => {
  try {
    const stmt = db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?');
    const result = stmt.run(req.params.id);
    res.json({ success: result.changes > 0 });
  } catch (err) {
    console.error('[Mark Notification Read Error]', err.message);
    res.json({ success: false, message: 'Failed to mark as read' });
  }
});


app.delete('/api/complete-appointment/:id', (req, res) => {
  try {
    const stmt = db.prepare("DELETE FROM appointments WHERE id = ?");
    const result = stmt.run(req.params.id);

    if (result.changes > 0) {
      res.json({ success: true, message: 'Appointment deleted successfully' });
    } else {
      res.json({ success: false, message: 'Appointment not found' });
    }
  } catch (err) {
    console.error('[Delete Appointment Error]', err.message);
    res.json({ success: false, message: 'Error deleting appointment' });
  }
});

// Get User Appointments
app.get('/api/user-appointments/:userId', (req, res) => {
  try {
    const stmt = db.prepare('SELECT id, user_id, service, stylist, date, time, status FROM appointments WHERE user_id = ? ORDER BY date ASC, time ASC');
    const appointments = stmt.all(req.params.userId);
    res.json({ success: true, appointments });
  } catch (err) {
    console.error('[Get Appointments Error]', err.message);
    res.json({ success: false, message: 'Failed to retrieve appointments' });
  }
});

// Get Appointment by ID
app.get('/api/appointment/:id', (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT id, user_id, service, stylist, date, time, status
      FROM appointments
      WHERE id = ?
    `);
    const appointment = stmt.get(req.params.id); // .get returns a single row

    if (appointment) {
      res.json({ success: true, appointment });
    } else {
      res.json({ success: false, message: 'Appointment not found' });
    }
  } catch (err) {
    console.error('[Get Appointment Error]', err.message);
    res.json({ success: false, message: 'Failed to retrieve appointment' });
  }
});

// Get user by ID
app.get('/api/user/:id', (req, res) => {
  try {
    const stmt = db.prepare('SELECT id, name, email, phone, role, created_at FROM users WHERE id = ?');
    const user = stmt.get(req.params.id); // get() returns a single row

    if (!user) {
      return res.json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, user });
  } catch (err) {
    console.error('[Get User Error]', err.message);
    res.json({ success: false, message: 'Failed to fetch user' });
  }
});




app.post('/api/send-notification', (req, res) => {
  try {
    const { user_id, message, type } = req.body;

    const notifStmt = db.prepare(`
      INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)
    `);
    const info = notifStmt.run(user_id, message, type || 'success');

    res.json({ success: true, rowid: info.lastInsertRowid });
  } catch (err) {
    console.error('[Send Notification Error]', err.message);
    res.json({ success: false, message: 'Failed to send notification' });
  }
});

// Get notifications for a specific user (including global notifications)
app.get('/api/notificationss/:userId', (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    // Fetch notifications for the user or for all users (user_id IS NULL)
    const stmt = db.prepare(`
      SELECT id, user_id, message, created_at
      FROM notifications
      WHERE user_id = ? OR user_id IS NULL
      ORDER BY created_at DESC
    `);

    const notifications = stmt.all(userId);

    res.json({ success: true, notifications });
  } catch (err) {
    console.error('[Get Notifications Error]', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
  }
});



// Update appointment status
app.patch('/api/update-appointment-status/:id', (req, res) => {
  try {
    const { status } = req.body;
    const stmt = db.prepare("UPDATE appointments SET status = ? WHERE id = ?");
    const result = stmt.run(status, req.params.id);

    if (result.changes > 0) {
      res.json({ success: true, message: `Appointment status updated to '${status}'` });
    } else {
      res.json({ success: false, message: 'Appointment not found or status unchanged' });
    }
  } catch (err) {
    console.error('[Update Appointment Status Error]', err.message);
    res.json({ success: false, message: 'Failed to update appointment status' });
  }
});


// Admin: Count Today's Approved Appointments
app.get('/api/admin/appointments/today/approved/count', (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const stmt = db.prepare('SELECT COUNT(*) AS totalTodayApproved FROM appointments WHERE date = ? AND status = ?');
    const result = stmt.get(today, 'Approved'); // only approved appointments
    res.json({ success: true, totalTodayApproved: result.totalTodayApproved });
  } catch (err) {
    console.error('[Admin Count Today Approved Appointments Error]', err.message);
    res.json({ success: false, message: 'Failed to count today\'s approved appointments' });
  }
});


// Send global notification (reminders, feedback responses, promotions)
app.post('/api/notifications/send-all', (req, res) => {
  try {
    const { message, type } = req.body;

    if (!message) return res.json({ success: false, message: 'Message is required' });

    const stmt = db.prepare(`
      INSERT INTO notifications (user_id, message, type)
      VALUES (NULL, ?, ?)
    `);
    const info = stmt.run(message, type || 'info');

    res.json({ success: true, notificationId: info.lastInsertRowid, message: 'Notification sent to all users.' });
  } catch (err) {
    console.error('[Send Global Notification Error]', err);
    res.json({ success: false, message: 'Failed to send notification.' });
  }
});


// POST add stylist
app.post("/api/stylists", (req, res) => {
  try {
    const { name, specialty, image } = req.body;
    const stmt = db.prepare("INSERT INTO stylists (name, specialty, image) VALUES (?, ?, ?)");
    const info = stmt.run(name, specialty, image);
    res.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to add stylist", error: err.message });
  }
});

// PATCH update stylist
app.patch("/api/stylists/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { name, specialty, image } = req.body;
    db.prepare("UPDATE stylists SET name=?, specialty=?, image=? WHERE id=?").run(name, specialty, image, id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to update stylist", error: err.message });
  }
});

// DELETE stylist
app.delete("/api/stylists/:id", (req, res) => {
  try {
    const { id } = req.params;
    db.prepare("DELETE FROM stylists WHERE id=?").run(id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to delete stylist", error: err.message });
  }
});

// ENABLE DISABLE 2FA
app.post("/update-security-setting", (req, res) => {
  const { id, enabled } = req.body;
  try {
    db.prepare("UPDATE security_settings SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
    res.json({ success: true });
  } catch (err) {
    console.error("Update failed:", err);
    res.json({ success: false });
  }
});

// Create reusable transporter
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  auth: {
    user: "princessangelsalon123@gmail.com", // Gmail
    pass: "rfng fyqn wrif ihjl", // App Password
  },
});

// Helper function to send OTP
function sendOTPEmail(to, otp) {
  const mailOptions = {
    from: '"Princess Angel Salon" <princessangelsalon123@gmail.com>',
    to,
    subject: "Your OTP Code",
    text: `Your OTP code is ${otp}. Please do not share this with anyone. It expires in 5 minutes.`,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending OTP email:", error);
    else console.log("OTP email sent:", info.response);
  });
}
/*
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  // 1️⃣ Check user credentials
  const user = db
    .prepare("SELECT * FROM users WHERE email = ? AND password = ?")
    .get(email, password);

  if (!user) {
    return res.json({ success: false, message: "Invalid credentials" });
  }

  // 2️⃣ Check if two-factor authentication is enabled
  const setting = db
    .prepare("SELECT enabled FROM security_settings WHERE name = 'Two-Factor Authentication'")
    .get();

  const is2FAEnabled = setting && setting.enabled === 1;

  // 3️⃣ If 2FA is disabled, log the user in directly
  if (!is2FAEnabled) {
    return res.json({
      success: true,
      requireOTP: false,
      user,
      message: "Login successful (2FA disabled)."
    });
  }

  // 4️⃣ If 2FA is enabled → generate OTP and send email
 const otp = Math.floor(1000 + Math.random() * 9000);
  const createdAt = new Date().toISOString();

  db.prepare("INSERT INTO otp (user_id, otp, created_at) VALUES (?, ?, ?)")
    .run(user.id, otp, createdAt);

  sendOTPEmail(email, otp);

  res.json({
    success: true,
    requireOTP: true,
    message: "OTP sent to your email."
  });
});*/

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  // 1️⃣ Check user credentials
  const user = db
    .prepare("SELECT * FROM users WHERE email = ? AND password = ?")
    .get(email, password);

  if (!user) {
    return res.json({ success: false, message: "Invalid credentials" });
  }

  // 2️⃣ Check if two-factor authentication is enabled
  const setting = db
    .prepare("SELECT enabled FROM security_settings WHERE name = 'Two-Factor Authentication'")
    .get();

  const is2FAEnabled = setting && setting.enabled === 1;

  // 3️⃣ If 2FA is disabled, log the user in directly
  if (!is2FAEnabled) {
    return res.json({
      success: true,
      requireOTP: false,
      user,
      message: "Login successful (2FA disabled)."
    });
  }

  // 4️⃣ Generate OTP
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const createdAt = new Date().toISOString();

  // 5️⃣ Check if OTP already exists for this user
  const existingOTP = db
    .prepare("SELECT * FROM otp WHERE user_id = ?")
    .get(user.id);

  if (existingOTP) {
    // Update existing OTP
    db.prepare("UPDATE otp SET otp = ?, created_at = ? WHERE user_id = ?")
      .run(otp, createdAt, user.id);
  } else {
    // Insert new OTP
    db.prepare("INSERT INTO otp (user_id, otp, created_at) VALUES (?, ?, ?)")
      .run(user.id, otp, createdAt);
  }

  // 6️⃣ Send OTP via email
  sendOTPEmail(email, otp);

  res.json({
    success: true,
    requireOTP: true,
    message: "OTP sent to your email."
  });
});
app.post("/api/forgot-password", (req, res) => {
  const { email } = req.body;

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user) {
    return res.json({ success: false, message: "Email not found." });
  }

  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const createdAt = new Date().toISOString();

  const existingOTP = db.prepare("SELECT * FROM otp WHERE user_id = ?").get(user.id);
  if (existingOTP) {
    db.prepare("UPDATE otp SET otp = ?, created_at = ? WHERE user_id = ?").run(otp, createdAt, user.id);
  } else {
    db.prepare("INSERT INTO otp (user_id, otp, created_at) VALUES (?, ?, ?)").run(user.id, otp, createdAt);
  }

  // send otp to email
  sendOTPEmail(email, otp);

  res.json({
    success: true,
    requireOTP: true,
    message: "OTP sent successfully!",
  });
});

app.post("/api/update-password", (req, res) => {
  const { email, newPassword } = req.body;
  if (!email || !newPassword)
    return res.json({ success: false, message: "Email and new password required." });

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user) return res.json({ success: false, message: "User not found." });

  db.prepare("UPDATE users SET password = ? WHERE id = ?").run(newPassword, user.id);

  // delete old OTPs
  db.prepare("DELETE FROM otp WHERE user_id = ?").run(user.id);

  res.json({ success: true, message: "Password updated successfully." });
});


// VERIFY OTP (Step 2)
app.post("/api/verify-otp", (req, res) => {
  const { email, otp } = req.body;
  console.log(email,otp);
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user) return res.json({ success: false, message: "User not found." });

  const otpRecord = db
    .prepare(
      `SELECT * FROM otp WHERE user_id = ? AND otp = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(user.id, otp);

  if (!otpRecord) return res.json({ success: false, message: "Invalid OTP." });

  // Check expiration (5 mins)
  const now = new Date();
  const createdAt = new Date(otpRecord.created_at);
  const diffMins = (now - createdAt) / 1000 / 60;
  if (diffMins > 5) {
    return res.json({
      success: false,
      message: "OTP expired. Please request a new one.",
    });
  }

  res.json({ success: true, user });
});

// RESEND OTP
app.post("/api/resend-otp", (req, res) => {
  const { email } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user) return res.json({ success: false, message: "User not found." });

  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const createdAt = new Date().toISOString();

  db.prepare(
    "INSERT INTO otp (user_id, otp, created_at) VALUES (?, ?, ?)"
  ).run(user.id, otp, createdAt);

  sendOTPEmail(email, otp);

  res.json({ success: true, message: "OTP resent successfully." });
});


// Check 2FA security setting
app.get('/api/security-status', (req, res) => {
  const setting = db.prepare("SELECT enabled FROM security_settings WHERE name = 'Two-Factor Authentication'").get();
  res.json({ enabled: setting ? setting.enabled : 0 });
});