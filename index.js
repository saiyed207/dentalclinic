require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const adminPage = require('./admin.js');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// --- Security Headers ---
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// --- MongoDB Serverless Connection Management ---
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not defined in the environment variables.');
  }

  const client = new MongoClient(process.env.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000
  });

  await client.connect();
  const dbName = process.env.MONGODB_DB_NAME || 'sparkle_dental_care';
  const db = client.db(dbName);

  // Initialize DB and Bootstrap Admin safely
  await initializeDatabase(db);
  
  cachedClient = client;
  cachedDb = db;
  return db;
}

async function initializeDatabase(db) {
  // Create Indexes
  await db.collection('admins').createIndex({ username: 1 }, { unique: true });
  await db.collection('appointments').createIndex({ reference: 1 }, { unique: true });
  await db.collection('appointments').createIndex({ createdAt: -1 });
  await db.collection('inquiries').createIndex({ createdAt: -1 });

  // Bootstrap initial admin if configured
  const adminCount = await db.collection('admins').countDocuments();
  if (adminCount === 0 && process.env.ADMIN_BOOTSTRAP_USERNAME && process.env.ADMIN_BOOTSTRAP_PASSWORD) {
    const passwordHash = await bcrypt.hash(process.env.ADMIN_BOOTSTRAP_PASSWORD, 10);
    await db.collection('admins').insertOne({
      username: process.env.ADMIN_BOOTSTRAP_USERNAME.toLowerCase(),
      passwordHash,
      role: 'superadmin',
      createdAt: new Date(),
      disabled: false
    });
    console.log('Bootstrap administrator created successfully.');
  }

  // Ensure default settings exist
  const settingsCount = await db.collection('settings').countDocuments();
  if (settingsCount === 0) {
    await db.collection('settings').insertOne({
      displayName: 'Sparkle Dental Care',
      hindiName: 'स्पार्कल डेंटल केयर',
      phone: '+91 98693 41311',
      address: 'Milan Building, 189, Perin Nariman Street, near Paras Guest House, Borabazar Precinct, Fort, Mumbai, Maharashtra 400001, India',
      hours: 'Open until 8:00 PM (Please confirm)',
      bookingHorizonDays: 30,
      timeSlots: ['10:00 AM', '11:00 AM', '12:00 PM', '02:00 PM', '04:00 PM', '06:00 PM', '07:00 PM'],
      services: [
        'General Dentistry & Checkups', 'Root Canal Treatment', 'Tooth Extraction', 
        'Dental Implants', 'Dental X-rays & OPG', 'Teeth Cleaning', 
        'Restorative Dentistry', 'Cosmetic Dentistry', 'Gum Care', 'Consultation'
      ]
    });
  }
}

// --- Rate Limiting (In-Memory Fallback for Serverless) ---
const rateLimits = new Map();
function rateLimiter(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  const windowMs = 60000; 
  const limit = 20;

  if (!rateLimits.has(ip)) rateLimits.set(ip, []);
  const requests = rateLimits.get(ip).filter(time => now - time < windowMs);
  
  if (requests.length >= limit) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  
  requests.push(now);
  rateLimits.set(ip, requests);
  next();
}

// --- Authentication Middleware ---
const jwtSecret = process.env.JWT_SECRET || 'fallback_secret_do_not_use_in_prod';

async function authenticateAdmin(req, res, next) {
  const token = req.cookies.admin_token;
  if (!token) return res.status(401).json({ error: 'Unauthorized. Please log in.' });

  try {
    const decoded = jwt.verify(token, jwtSecret);
    const db = await connectToDatabase();
    const admin = await db.collection('admins').findOne({ _id: new ObjectId(decoded.id) });
    
    if (!admin || admin.disabled) return res.status(403).json({ error: 'Account disabled or not found.' });
    
    req.admin = admin;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired session.' });
  }
}

// ==========================================
// API ROUTES: PUBLIC
// ==========================================

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/public/config', async (req, res) => {
  try {
    const db = await connectToDatabase();
    const settings = await db.collection('settings').findOne({});
    delete settings._id;
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load configuration.' });
  }
});

app.post('/api/appointments', rateLimiter, async (req, res) => {
  try {
    const { patientName, phone, email, service, preferredDate, preferredTime, firstVisit, message } = req.body;
    
    // Server-side validation
    if (!patientName || patientName.length > 100) return res.status(400).json({ error: 'Valid patient name is required.' });
    if (!phone || phone.length < 8 || phone.length > 20) return res.status(400).json({ error: 'Valid phone number is required.' });
    if (!preferredDate) return res.status(400).json({ error: 'Preferred date is required.' });

    // Ensure date is not in the past (using basic validation)
    const requestDate = new Date(preferredDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (requestDate < today) return res.status(400).json({ error: 'Appointment date cannot be in the past.' });

    const db = await connectToDatabase();
    const reference = 'SPK-' + Math.random().toString(36).substring(2, 8).toUpperCase();

    const appointment = {
      reference,
      patientName: patientName.trim(),
      phone: phone.trim(),
      email: email ? email.trim() : null,
      service,
      preferredDate,
      preferredTime,
      firstVisit,
      message: message ? message.substring(0, 500) : '',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      adminNotes: ''
    };

    await db.collection('appointments').insertOne(appointment);
    res.status(201).json({ success: true, reference });
  } catch (error) {
    console.error('Appointment Error:', error);
    res.status(500).json({ error: 'Failed to submit appointment request.' });
  }
});

app.post('/api/contact', rateLimiter, async (req, res) => {
  try {
    const { name, contactInfo, subject, message } = req.body;
    
    if (!name || !contactInfo || !message) {
      return res.status(400).json({ error: 'Name, contact info, and message are required.' });
    }

    const db = await connectToDatabase();
    await db.collection('inquiries').insertOne({
      name: name.trim().substring(0, 100),
      contactInfo: contactInfo.trim().substring(0, 100),
      subject: subject ? subject.trim().substring(0, 150) : 'General Inquiry',
      message: message.trim().substring(0, 1000),
      status: 'new',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit inquiry.' });
  }
});

// ==========================================
// API ROUTES: ADMIN
// ==========================================

app.post('/api/admin/login', rateLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Credentials required.' });

    const db = await connectToDatabase();
    const admin = await db.collection('admins').findOne({ username: username.toLowerCase() });
    
    if (!admin || admin.disabled) return res.status(401).json({ error: 'Invalid credentials.' });

    const isMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials.' });

    await db.collection('admins').updateOne({ _id: admin._id }, { $set: { lastLoginAt: new Date() } });

    const token = jwt.sign({ id: admin._id, username: admin.username }, jwtSecret, { expiresIn: '12h' });
    
    res.cookie('admin_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 12 * 60 * 60 * 1000 
    });

    res.json({ success: true, username: admin.username });
  } catch (error) {
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ success: true });
});

app.get('/api/admin/me', authenticateAdmin, (req, res) => {
  res.json({ username: req.admin.username, role: req.admin.role });
});

app.get('/api/admin/dashboard', authenticateAdmin, async (req, res) => {
  try {
    const db = await connectToDatabase();
    const [totalAppointments, pendingAppointments, confirmedAppointments, newInquiries] = await Promise.all([
      db.collection('appointments').countDocuments(),
      db.collection('appointments').countDocuments({ status: 'pending' }),
      db.collection('appointments').countDocuments({ status: 'confirmed' }),
      db.collection('inquiries').countDocuments({ status: 'new' })
    ]);
    res.json({ totalAppointments, pendingAppointments, confirmedAppointments, newInquiries });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load dashboard statistics.' });
  }
});

app.get('/api/admin/appointments', authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;
    
    const db = await connectToDatabase();
    const appointments = await db.collection('appointments')
      .find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
      
    const total = await db.collection('appointments').countDocuments();
    
    res.json({ appointments, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch appointments.' });
  }
});

app.patch('/api/admin/appointments/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;
    
    const allowedStatuses = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];
    const updateDoc = { updatedAt: new Date() };
    
    if (status && allowedStatuses.includes(status)) updateDoc.status = status;
    if (adminNotes !== undefined) updateDoc.adminNotes = adminNotes;

    const db = await connectToDatabase();
    const result = await db.collection('appointments').updateOne(
      { _id: new ObjectId(id) },
      { $set: updateDoc }
    );
    
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Not found.' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Update failed.' });
  }
});

app.get('/api/admin/inquiries', authenticateAdmin, async (req, res) => {
  try {
    const db = await connectToDatabase();
    const inquiries = await db.collection('inquiries').find({}).sort({ createdAt: -1 }).limit(50).toArray();
    res.json({ inquiries });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch inquiries.' });
  }
});

app.patch('/api/admin/inquiries/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const db = await connectToDatabase();
    await db.collection('inquiries').updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } }
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Update failed.' });
  }
});

// ==========================================
// VIEWS
// ==========================================

app.get('/', (req, res) => {
  res.send(renderPublicPage());
});

app.get('/admin', (req, res) => {
  res.send(adminPage.renderAdminPage());
});

// Start Server locally or Export for Vercel
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

module.exports = app;

// ==========================================
// PUBLIC FRONTEND HTML/CSS/JS (embedded)
// ==========================================
function renderPublicPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sparkle Dental Care | Fort, Mumbai</title>
    <meta name="description" content="Sparkle Dental Care (स्पार्कल डेंटल केयर) in Fort, Mumbai. Providing comprehensive dental care, root canals, extractions, and more.">
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
        :root {
            --bg-primary: #F7F9FC;
            --primary-blue: #5687F5;
            --deep-navy: #203451;
            --sky-blue: #E5EEFF;
            --mint-accent: #CFF4E5;
            --secondary-mint: #E7F8F0;
            --surface-white: #FFFFFF;
            --text-body: #536178;
            --text-muted: #8290A5;
            --border-light: #E4EAF2;
            --success: #198754;
            --error: #C62828;
            --radius-sm: 12px;
            --radius-md: 20px;
            --radius-lg: 32px;
            --clay-shadow: 10px 10px 28px rgba(35, 65, 105, 0.08), -8px -8px 24px rgba(255, 255, 255, 0.95);
            --clay-inset: inset 2px 2px 5px rgba(255,255,255,0.8), inset -3px -3px 7px rgba(0,0,0,0.06);
            --clay-hover: 6px 6px 18px rgba(35, 65, 105, 0.1), -6px -6px 18px rgba(255, 255, 255, 0.9);
            --btn-shadow: 5px 5px 15px rgba(86,135,245,0.3), inset 2px 2px 5px rgba(255,255,255,0.3), inset -3px -3px 7px rgba(0,0,0,0.1);
        }

        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
        body { background-color: var(--bg-primary); color: var(--text-body); line-height: 1.6; overflow-x: hidden; }
        h1, h2, h3, h4 { color: var(--deep-navy); font-weight: 700; }
        a { text-decoration: none; color: inherit; }
        ul { list-style: none; }
        img { max-width: 100%; height: auto; display: block; }
        
        .container { max-width: 1200px; margin: 0 auto; padding: 0 20px; }
        
        /* Elements */
        .clay-card {
            background: var(--surface-white);
            border-radius: var(--radius-md);
            box-shadow: var(--clay-shadow);
            padding: 30px;
            transition: all 0.3s ease;
            border: 1px solid rgba(255,255,255,0.5);
        }
        .clay-card:hover { transform: translateY(-3px); }
        
        .btn {
            display: inline-flex; align-items: center; justify-content: center; gap: 8px;
            padding: 14px 28px; font-weight: 600; border-radius: 100px; cursor: pointer;
            transition: all 0.2s ease; border: none; font-size: 1rem;
        }
        .btn-primary { background: var(--primary-blue); color: #fff; box-shadow: var(--btn-shadow); }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 6px 6px 18px rgba(86,135,245,0.4), inset 2px 2px 5px rgba(255,255,255,0.3); }
        .btn-secondary { background: var(--surface-white); color: var(--primary-blue); box-shadow: var(--clay-shadow); }
        
        /* Header */
        .top-strip { background: var(--primary-blue); color: white; text-align: center; padding: 8px; font-size: 0.9rem; }
        header { background: rgba(247, 249, 252, 0.9); backdrop-filter: blur(10px); position: sticky; top: 0; z-index: 100; border-bottom: 1px solid var(--border-light); }
        .nav-container { display: flex; justify-content: space-between; align-items: center; height: 80px; }
        .logo { display: flex; align-items: center; gap: 10px; font-size: 1.4rem; font-weight: 700; color: var(--deep-navy); }
        .logo i { color: var(--primary-blue); }
        .nav-links { display: flex; gap: 30px; align-items: center; }
        .nav-links a { font-weight: 500; transition: color 0.2s; }
        .nav-links a:hover { color: var(--primary-blue); }
        .mobile-menu-btn { display: none; background: none; border: none; cursor: pointer; color: var(--deep-navy); }

        /* Hero */
        .hero { padding: 80px 0; position: relative; overflow: hidden; }
        .hero::before { content: ''; position: absolute; top: -10%; right: -5%; width: 500px; height: 500px; background: var(--sky-blue); border-radius: 50%; filter: blur(80px); z-index: -1; }
        .hero-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; align-items: center; }
        .hero-pill { background: var(--sky-blue); color: var(--primary-blue); padding: 8px 16px; border-radius: 100px; font-size: 0.9rem; font-weight: 600; display: inline-block; margin-bottom: 20px; }
        .hero h1 { font-size: 3.5rem; line-height: 1.2; margin-bottom: 20px; }
        .hero p { font-size: 1.1rem; color: var(--text-body); margin-bottom: 30px; max-width: 90%; }
        .hero-actions { display: flex; gap: 15px; }
        .hero-trust { margin-top: 30px; display: flex; align-items: center; gap: 15px; font-size: 0.9rem; color: var(--text-muted); }
        .hero-trust img { height: 24px; }
        .hero-image-wrapper { position: relative; }
        .hero-image { border-radius: var(--radius-lg); box-shadow: var(--clay-shadow); width: 100%; aspect-ratio: 4/3; object-fit: cover; }
        .floating-card { position: absolute; bottom: 30px; left: -30px; background: rgba(255,255,255,0.9); backdrop-filter: blur(10px); padding: 15px 20px; border-radius: var(--radius-md); box-shadow: var(--clay-shadow); display: flex; align-items: center; gap: 15px; }
        .floating-card i { color: var(--success); background: var(--secondary-mint); padding: 10px; border-radius: 50%; }

        /* Trust Highlights */
        .trust-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-top: -30px; position: relative; z-index: 2; padding-bottom: 60px; }
        .trust-card { text-align: center; padding: 25px 15px; }
        .trust-card i { color: var(--primary-blue); margin-bottom: 15px; width: 32px; height: 32px; }
        .trust-card h4 { font-size: 1.1rem; margin-bottom: 8px; }
        .trust-card p { font-size: 0.9rem; color: var(--text-muted); }

        /* About Section */
        .section-padding { padding: 80px 0; }
        .about-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; align-items: center; }
        .about-images { position: relative; }
        .img-main { border-radius: var(--radius-lg); box-shadow: var(--clay-shadow); width: 80%; }
        .img-overlap { position: absolute; bottom: -30px; right: 0; width: 50%; border-radius: var(--radius-md); box-shadow: var(--clay-shadow); border: 8px solid var(--bg-primary); }
        .section-tag { color: var(--primary-blue); font-weight: 600; text-transform: uppercase; letter-spacing: 1px; font-size: 0.9rem; margin-bottom: 10px; display: block; }
        .about-content h2 { font-size: 2.5rem; margin-bottom: 20px; }
        .about-content p { margin-bottom: 20px; }

        /* Services */
        .bg-mint { background: linear-gradient(135deg, #F7F9FC 0%, var(--secondary-mint) 100%); }
        .section-header { text-align: center; max-width: 600px; margin: 0 auto 50px; }
        .services-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 30px; }
        .service-card { padding: 30px; display: flex; flex-direction: column; height: 100%; }
        .service-icon { background: var(--sky-blue); color: var(--primary-blue); width: 60px; height: 60px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; margin-bottom: 20px; box-shadow: var(--clay-inset); }
        .service-card h3 { margin-bottom: 10px; font-size: 1.3rem; }
        .service-card p { color: var(--text-muted); margin-bottom: 20px; flex-grow: 1; }
        .service-link { color: var(--primary-blue); font-weight: 600; display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }

        /* Testimonials */
        .reviews-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 30px; }
        .review-card { position: relative; }
        .stars { color: #FFC107; display: flex; gap: 4px; margin-bottom: 15px; }
        .stars i { fill: #FFC107; width: 18px; height: 18px; }
        .review-text { font-style: italic; margin-bottom: 20px; color: var(--deep-navy); }
        .reviewer { font-weight: 600; color: var(--primary-blue); }

        /* FAQ */
        .faq-container { max-width: 800px; margin: 0 auto; }
        .faq-item { background: var(--surface-white); border-radius: var(--radius-md); margin-bottom: 15px; box-shadow: var(--clay-shadow); overflow: hidden; }
        .faq-question { padding: 20px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-weight: 600; color: var(--deep-navy); }
        .faq-answer { padding: 0 20px; max-height: 0; overflow: hidden; transition: all 0.3s ease; color: var(--text-body); }
        .faq-item.active .faq-answer { padding: 0 20px 20px; max-height: 300px; }
        .faq-item.active .faq-question i { transform: rotate(180deg); }

        /* Contact & Map */
        .contact-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 50px; }
        .contact-info-card { display: flex; gap: 15px; margin-bottom: 20px; align-items: flex-start; }
        .contact-info-card i { background: var(--sky-blue); color: var(--primary-blue); padding: 12px; border-radius: 50%; box-shadow: var(--clay-inset); }
        .map-container { border-radius: var(--radius-md); overflow: hidden; box-shadow: var(--clay-shadow); height: 100%; min-height: 300px; }
        .form-group { margin-bottom: 20px; }
        .form-control { width: 100%; padding: 14px 20px; border-radius: var(--radius-sm); border: 1px solid var(--border-light); background: var(--bg-primary); box-shadow: inset 2px 2px 5px rgba(0,0,0,0.02); font-family: inherit; font-size: 1rem; color: var(--deep-navy); outline: none; transition: border 0.3s; }
        .form-control:focus { border-color: var(--primary-blue); }
        textarea.form-control { resize: vertical; min-height: 120px; }

        /* Footer */
        footer { background: var(--deep-navy); color: #fff; padding: 60px 0 30px; border-top-left-radius: 40px; border-top-right-radius: 40px; }
        .footer-grid { display: grid; grid-template-columns: 2fr 1fr 1fr 1.5fr; gap: 40px; margin-bottom: 40px; }
        .footer-logo { display: flex; align-items: center; gap: 10px; font-size: 1.5rem; font-weight: 700; margin-bottom: 20px; }
        .footer-col h4 { color: #fff; margin-bottom: 20px; }
        .footer-links li { margin-bottom: 12px; }
        .footer-links a { color: var(--text-muted); transition: color 0.2s; }
        .footer-links a:hover { color: var(--mint-accent); }
        .footer-bottom { text-align: center; padding-top: 30px; border-top: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); font-size: 0.9rem; }

        /* Modal */
        .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(32, 52, 81, 0.6); backdrop-filter: blur(5px); z-index: 1000; display: none; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.3s; }
        .modal-overlay.active { display: flex; opacity: 1; }
        .modal-content { background: var(--surface-white); width: 90%; max-width: 600px; border-radius: var(--radius-lg); box-shadow: 0 20px 40px rgba(0,0,0,0.2); max-height: 90vh; overflow-y: auto; position: relative; transform: translateY(20px); transition: transform 0.3s; padding: 40px; }
        .modal-overlay.active .modal-content { transform: translateY(0); }
        .modal-close { position: absolute; top: 20px; right: 20px; background: var(--bg-primary); border: none; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text-body); }
        
        .alert { padding: 15px 20px; border-radius: var(--radius-sm); margin-bottom: 20px; display: none; }
        .alert-success { background: var(--secondary-mint); color: var(--success); border: 1px solid var(--success); }
        .alert-error { background: #ffebee; color: var(--error); border: 1px solid var(--error); }

        /* Responsive */
        @media (max-width: 992px) {
            .hero-grid, .about-grid, .contact-grid { grid-template-columns: 1fr; }
            .hero h1 { font-size: 2.8rem; }
            .trust-grid { grid-template-columns: 1fr 1fr; }
            .footer-grid { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 768px) {
            .nav-links, .btn-header { display: none; }
            .mobile-menu-btn { display: block; }
            .hero h1 { font-size: 2.2rem; }
            .trust-grid { grid-template-columns: 1fr; }
            .footer-grid { grid-template-columns: 1fr; }
            .img-overlap { display: none; }
            .img-main { width: 100%; }
        }
    </style>
</head>
<body>

    <div class="top-strip">
        <div class="container">
            📍 Fort, Mumbai | <span id="headerPhone">+91 98693 41311</span> | Open until 8:00 PM
        </div>
    </div>

    <header>
        <div class="container nav-container">
            <a href="#" class="logo">
                <i data-lucide="sparkles"></i> Sparkle Dental Care
            </a>
            <nav class="nav-links">
                <a href="#home">Home</a>
                <a href="#about">About</a>
                <a href="#services">Treatments</a>
                <a href="#reviews">Reviews</a>
                <a href="#contact">Contact</a>
            </nav>
            <button class="btn btn-primary btn-header" onclick="openBookingModal()">Book Appointment</button>
            <button class="mobile-menu-btn"><i data-lucide="menu"></i></button>
        </div>
    </header>

    <section id="home" class="hero">
        <div class="container hero-grid">
            <div class="hero-content">
                <div class="hero-pill">Your Smile, Our Priority</div>
                <h1>A Healthier Smile Starts With a Little Sparkle.</h1>
                <p>Experience comfortable, personalized dental care in the heart of Fort, Mumbai. From routine checkups to specialized treatments.</p>
                <div class="hero-actions">
                    <button class="btn btn-primary" onclick="openBookingModal()">Book an Appointment</button>
                    <a href="tel:+919869341311" class="btn btn-secondary"><i data-lucide="phone"></i> Call Clinic</a>
                </div>
                <div class="hero-trust">
                    <div style="display:flex; color:#FFC107;"><i data-lucide="star" fill="#FFC107" width="16"></i><i data-lucide="star" fill="#FFC107" width="16"></i><i data-lucide="star" fill="#FFC107" width="16"></i><i data-lucide="star" fill="#FFC107" width="16"></i><i data-lucide="star" fill="#FFC107" width="16"></i></div>
                    <span><strong>4.9/5</strong> · 833 Google Reviews</span>
                </div>
            </div>
            <div class="hero-image-wrapper">
                <img src="https://lh3.googleusercontent.com/gps-cs-s/ANWiy9SpEM_k7u13i94RPSSHxVohYVzxpyj0ljRJRoZNGsRqAhkn936tO-RjSWRVu5G2dpSNjDCEeiY4tlYRtSq2owM1dqGKLHvId5buyyYr4ZoTJbRi5btO7eOjl7tmpZh6KikJWt_8Ig=w402-h298-k-no" alt="Sparkle Dental Care Overview" class="hero-image">
                <div class="floating-card">
                    <i data-lucide="shield-check"></i>
                    <div>
                        <strong>Safe & Hygienic</strong>
                        <div style="font-size:0.8rem; color:var(--text-muted)">Premium Clinic Standards</div>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <section class="container trust-grid">
        <div class="clay-card trust-card">
            <i data-lucide="heart-pulse"></i>
            <h4>Patient-Focused Care</h4>
            <p>Your comfort is our top priority.</p>
        </div>
        <div class="clay-card trust-card">
            <i data-lucide="users"></i>
            <h4>Friendly Team</h4>
            <p>Welcoming staff ready to assist.</p>
        </div>
        <div class="clay-card trust-card">
            <i data-lucide="sparkles"></i>
            <h4>Clean Environment</h4>
            <p>Strict hygiene protocols followed.</p>
        </div>
        <div class="clay-card trust-card">
            <i data-lucide="map-pin"></i>
            <h4>Fort Location</h4>
            <p>Convenient access in Mumbai.</p>
        </div>
    </section>

    <section id="about" class="section-padding">
        <div class="container about-grid">
            <div class="about-images">
                <img src="https://lh3.googleusercontent.com/grass-cs/AABkmLeiJR1sKnika8JUPjdtq-Oh9HBz4zy-fQ9zpcctVcgNtrUkXo_0wnI8G-ZdavegaJJuP2HY9KX3kLL5nyiVHOwq6TPrmDYxT4afaUju7s5uJbJjP1_60FqBKqJCLjHa4M8i4QQS4Q=w408-h302-k-no" alt="Clinic Exterior" class="img-main">
                <img src="https://lh3.googleusercontent.com/gps-cs-s/ANWiy9TAkRrn_NeZA3u3-Pp9K-tb51E0Ymv1W7UQa5TEQ65Q-M704Ce29ZocWimDSYDzGIWldfEOwHsj9lFanzpg0MwK4IHpYtpxyXThR5On43vdNAsL1q95XZqh7mCkfNbw1-_5AznPHg=w224-h302-k-no" alt="Clinic Interior" class="img-overlap">
            </div>
            <div class="about-content">
                <span class="section-tag">About Us</span>
                <h2>Welcome to Sparkle Dental Care (स्पार्कल डेंटल केयर)</h2>
                <p>Located in the historic Borabazar Precinct of Fort, Mumbai, Sparkle Dental Care provides a welcoming and professional environment for all your dental needs.</p>
                <p>Dr. Kiran and our dedicated team believe in clear communication, respectful patient care, and maintaining a spotless clinical setting. Whether you need a simple checkup or a complex procedure, we ensure you understand your options and feel supported throughout your visit.</p>
                <button class="btn btn-secondary mt-3" onclick="openBookingModal('Consultation')">Arrange a Consultation</button>
            </div>
        </div>
    </section>

    <section id="services" class="section-padding bg-mint">
        <div class="container">
            <div class="section-header">
                <span class="section-tag">Our Treatments</span>
                <h2>Comprehensive Dental Services</h2>
                <p>We offer a wide range of procedures tailored to your oral health requirements.</p>
            </div>
            <div class="services-grid" id="servicesContainer">
                <!-- Injected via JS -->
            </div>
        </div>
    </section>

    <section id="reviews" class="section-padding">
        <div class="container">
            <div class="section-header">
                <span class="section-tag">Patient Experience</span>
                <h2>What Our Patients Say</h2>
                <p>Feedback themes verified from our Google Business Profile.</p>
            </div>
            <div class="reviews-grid">
                <div class="clay-card review-card">
                    <div class="stars"><i data-lucide="star"></i><i data-lucide="star"></i><i data-lucide="star"></i><i data-lucide="star"></i><i data-lucide="star"></i></div>
                    <p class="review-text">"Excellent experience with Dr. Kiran. The tooth extraction was handled professionally, and the staff was extremely reassuring throughout the process."</p>
                    <div class="reviewer">— Patient Feedback</div>
                </div>
                <div class="clay-card review-card">
                    <div class="stars"><i data-lucide="star"></i><i data-lucide="star"></i><i data-lucide="star"></i><i data-lucide="star"></i><i data-lucide="star"></i></div>
                    <p class="review-text">"Very clean and hygienic clinic. Had a smooth OPG X-ray visit and root canal treatment. Clear explanations given for every step."</p>
                    <div class="reviewer">— Patient Feedback</div>
                </div>
                <div class="clay-card review-card">
                    <div class="stars"><i data-lucide="star"></i><i data-lucide="star"></i><i data-lucide="star"></i><i data-lucide="star"></i><i data-lucide="star"></i></div>
                    <p class="review-text">"Friendly team and welcoming environment. They prioritize patient comfort and ensure the clinical surroundings are perfectly maintained."</p>
                    <div class="reviewer">— Patient Feedback</div>
                </div>
            </div>
        </div>
    </section>

    <section class="section-padding bg-mint">
        <div class="container">
            <div class="section-header">
                <span class="section-tag">Patient Journey</span>
                <h2>How It Works</h2>
            </div>
            <div class="trust-grid" style="margin-top: 0; padding-bottom: 0;">
                <div class="trust-card">
                    <div style="font-size:2rem; font-weight:700; color:var(--sky-blue); margin-bottom:10px;">1</div>
                    <h4>Request</h4>
                    <p>Submit an online appointment request.</p>
                </div>
                <div class="trust-card">
                    <div style="font-size:2rem; font-weight:700; color:var(--sky-blue); margin-bottom:10px;">2</div>
                    <h4>Confirm</h4>
                    <p>We contact you to confirm availability.</p>
                </div>
                <div class="trust-card">
                    <div style="font-size:2rem; font-weight:700; color:var(--sky-blue); margin-bottom:10px;">3</div>
                    <h4>Consult</h4>
                    <p>Attend your consultation.</p>
                </div>
                <div class="trust-card">
                    <div style="font-size:2rem; font-weight:700; color:var(--sky-blue); margin-bottom:10px;">4</div>
                    <h4>Plan</h4>
                    <p>Discuss an appropriate treatment plan.</p>
                </div>
            </div>
        </div>
    </section>

    <section class="section-padding container">
        <div class="section-header">
            <h2>Frequently Asked Questions</h2>
        </div>
        <div class="faq-container">
            <div class="faq-item">
                <div class="faq-question">How do I request a dental appointment? <i data-lucide="chevron-down"></i></div>
                <div class="faq-answer"><p>You can use our online booking form. Once submitted, our team will review the request and contact you to confirm the exact date and time.</p></div>
            </div>
            <div class="faq-item">
                <div class="faq-question">Are online appointments instantly confirmed? <i data-lucide="chevron-down"></i></div>
                <div class="faq-answer"><p>No, online requests are pending until accepted by the clinic based on doctor availability.</p></div>
            </div>
            <div class="faq-item">
                <div class="faq-question">How do I reach the clinic in Fort, Mumbai? <i data-lucide="chevron-down"></i></div>
                <div class="faq-answer"><p>We are located in Milan Building, 189, Perin Nariman Street, near Paras Guest House. Please see the map below for exact directions.</p></div>
            </div>
        </div>
    </section>

    <section id="contact" class="section-padding bg-mint">
        <div class="container contact-grid">
            <div>
                <span class="section-tag">Contact Us</span>
                <h2>Get In Touch</h2>
                <p style="margin-bottom: 30px;">Reach out for inquiries. Note: This form is not for medical emergencies.</p>
                
                <div class="clay-card">
                    <form id="contactForm" onsubmit="submitContact(event)">
                        <div id="contactAlert" class="alert"></div>
                        <div class="form-group">
                            <input type="text" class="form-control" id="cName" placeholder="Your Name" required>
                        </div>
                        <div class="form-group">
                            <input type="text" class="form-control" id="cContact" placeholder="Phone or Email" required>
                        </div>
                        <div class="form-group">
                            <textarea class="form-control" id="cMessage" placeholder="Your Message" required></textarea>
                        </div>
                        <button type="submit" class="btn btn-primary" style="width: 100%;">Send Message</button>
                    </form>
                </div>
            </div>
            <div>
                <div class="contact-info-card">
                    <i data-lucide="map-pin"></i>
                    <div>
                        <h4>Clinic Address</h4>
                        <p id="footerAddress">Milan Building, 189, Perin Nariman Street, near Paras Guest House, Borabazar Precinct, Fort, Mumbai, Maharashtra 400001, India.</p>
                    </div>
                </div>
                <div class="contact-info-card">
                    <i data-lucide="phone"></i>
                    <div>
                        <h4>Phone</h4>
                        <p>+91 98693 41311</p>
                    </div>
                </div>
                <div class="map-container">
                    <iframe src="https://maps.google.com/maps?q=Milan%20Building,%20189,%20Perin%20Nariman%20Street,%20Fort,%20Mumbai&t=&z=15&ie=UTF8&iwloc=&output=embed" width="100%" height="100%" style="border:0;" allowfullscreen="" loading="lazy"></iframe>
                </div>
            </div>
        </div>
    </section>

    <footer>
        <div class="container footer-grid">
            <div class="footer-col">
                <div class="footer-logo"><i data-lucide="sparkles"></i> Sparkle Dental Care</div>
                <p style="color: var(--text-muted); margin-bottom: 20px;">स्पार्कल डेंटल केयर - Your trusted partner for comprehensive and comfortable dental treatments in Mumbai.</p>
                <p style="font-size:0.8rem; color: var(--text-muted);">Disclaimer: Treatment recommendations require a professional clinical assessment.</p>
            </div>
            <div class="footer-col">
                <h4>Quick Links</h4>
                <ul class="footer-links">
                    <li><a href="#home">Home</a></li>
                    <li><a href="#about">About Clinic</a></li>
                    <li><a href="#services">Treatments</a></li>
                    <li><a href="#reviews">Patient Reviews</a></li>
                </ul>
            </div>
            <div class="footer-col">
                <h4>Legal</h4>
                <ul class="footer-links">
                    <li><a href="#">Privacy Policy</a></li>
                    <li><a href="#">Terms of Use</a></li>
                    <li><a href="/admin">Admin Login</a></li>
                </ul>
            </div>
            <div class="footer-col">
                <h4>Contact</h4>
                <ul class="footer-links">
                    <li>+91 98693 41311</li>
                    <li>Fort, Mumbai 400001</li>
                    <li style="margin-top:15px;"><button class="btn btn-secondary" onclick="openBookingModal()" style="padding: 8px 16px; font-size: 0.9rem;">Book Visit</button></li>
                </ul>
            </div>
        </div>
        <div class="footer-bottom">
            &copy; <span id="year"></span> Sparkle Dental Care. All rights reserved.
        </div>
    </footer>

    <!-- Booking Modal -->
    <div class="modal-overlay" id="bookingModal">
        <div class="clay-card modal-content">
            <button class="modal-close" onclick="closeBookingModal()"><i data-lucide="x"></i></button>
            <h2 style="margin-bottom: 20px;">Request Appointment</h2>
            <div id="bookingAlert" class="alert"></div>
            
            <form id="bookingForm" onsubmit="submitBooking(event)">
                <div class="form-group">
                    <label style="display:block; margin-bottom:8px; font-weight:500;">Patient Name *</label>
                    <input type="text" id="bName" class="form-control" required maxlength="100">
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px;">
                    <div class="form-group">
                        <label style="display:block; margin-bottom:8px; font-weight:500;">Phone Number *</label>
                        <input type="tel" id="bPhone" class="form-control" required minlength="8" maxlength="20">
                    </div>
                    <div class="form-group">
                        <label style="display:block; margin-bottom:8px; font-weight:500;">Email (Optional)</label>
                        <input type="email" id="bEmail" class="form-control">
                    </div>
                </div>
                <div class="form-group">
                    <label style="display:block; margin-bottom:8px; font-weight:500;">Treatment Inquiry *</label>
                    <select id="bService" class="form-control" required>
                        <option value="">Select a service...</option>
                    </select>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px;">
                    <div class="form-group">
                        <label style="display:block; margin-bottom:8px; font-weight:500;">Preferred Date *</label>
                        <input type="date" id="bDate" class="form-control" required>
                    </div>
                    <div class="form-group">
                        <label style="display:block; margin-bottom:8px; font-weight:500;">Preferred Time *</label>
                        <select id="bTime" class="form-control" required>
                            <option value="">Select time...</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label style="display:block; margin-bottom:8px; font-weight:500;">First Visit? *</label>
                    <select id="bFirst" class="form-control" required>
                        <option value="Yes">Yes, first time</option>
                        <option value="No">No, returning patient</option>
                    </select>
                </div>
                <div class="form-group">
                    <label style="display:block; margin-bottom:8px; font-weight:500;">Message (Optional)</label>
                    <textarea id="bMessage" class="form-control" style="min-height:80px;" maxlength="500"></textarea>
                </div>
                <div class="form-group" style="display:flex; gap:10px; align-items:flex-start;">
                    <input type="checkbox" id="bConsent" required style="margin-top:5px;">
                    <label style="font-size:0.85rem; color:var(--text-muted)">I understand this is a request and the appointment is not confirmed until the clinic contacts me. I agree to the privacy notice.</label>
                </div>
                <button type="submit" class="btn btn-primary" style="width:100%;" id="bSubmitBtn">Submit Request</button>
            </form>
            
            <div id="bookingSuccess" style="display:none; text-align:center; padding: 20px 0;">
                <i data-lucide="check-circle" style="color:var(--success); width:64px; height:64px; margin:0 auto 20px;"></i>
                <h3 style="margin-bottom:10px;">Request Received</h3>
                <p>Your reference number is: <strong id="bRefNumber" style="font-size:1.2rem; color:var(--primary-blue);"></strong></p>
                <p style="color:var(--text-muted); margin-top:15px;">We will contact you shortly to confirm the appointment based on availability.</p>
                <button class="btn btn-secondary mt-3" style="margin-top:20px;" onclick="closeBookingModal()">Close</button>
            </div>
        </div>
    </div>

    <script>
        lucide.createIcons();
        document.getElementById('year').textContent = new Date().getFullYear();

        // Min Date for picker
        const dateInput = document.getElementById('bDate');
        const today = new Date().toISOString().split('T')[0];
        dateInput.min = today;

        // FAQ Toggle
        document.querySelectorAll('.faq-question').forEach(el => {
            el.addEventListener('click', () => {
                const parent = el.parentElement;
                parent.classList.toggle('active');
            });
        });

        // Config Load
        fetch('/api/public/config')
            .then(res => res.json())
            .then(data => {
                // Populate Services
                const sContainer = document.getElementById('servicesContainer');
                const bService = document.getElementById('bService');
                
                const icons = ['stethoscope', 'activity', 'x', 'shield', 'scan', 'sparkles', 'tool', 'star', 'heart', 'clipboard-list'];
                
                if(data.services && data.services.length) {
                    data.services.forEach((s, i) => {
                        // Modal Dropdown
                        const opt = document.createElement('option');
                        opt.value = s;
                        opt.textContent = s;
                        bService.appendChild(opt);

                        // Cards
                        const card = document.createElement('div');
                        card.className = 'clay-card service-card';
                        card.innerHTML = \`
                            <div class="service-icon"><i data-lucide="\${icons[i % icons.length]}"></i></div>
                            <h3>\${s}</h3>
                            <p>Professional assessment and treatment tailored for your needs.</p>
                            <span class="service-link" onclick="openBookingModal('\${s}')">Learn More <i data-lucide="arrow-right" style="width:16px;"></i></span>
                        \`;
                        sContainer.appendChild(card);
                    });
                    lucide.createIcons();
                }

                // Populate Times
                const bTime = document.getElementById('bTime');
                if(data.timeSlots) {
                    data.timeSlots.forEach(t => {
                        const opt = document.createElement('option');
                        opt.value = t;
                        opt.textContent = t;
                        bTime.appendChild(opt);
                    });
                }
            }).catch(e => console.error('Error loading config'));

        // Modals
        const modal = document.getElementById('bookingModal');
        function openBookingModal(serviceName = '') {
            modal.classList.add('active');
            document.getElementById('bookingForm').style.display = 'block';
            document.getElementById('bookingSuccess').style.display = 'none';
            document.getElementById('bookingAlert').style.display = 'none';
            if (serviceName) document.getElementById('bService').value = serviceName;
        }
        function closeBookingModal() {
            modal.classList.remove('active');
            document.getElementById('bookingForm').reset();
        }

        // Submissions
        async function submitBooking(e) {
            e.preventDefault();
            const btn = document.getElementById('bSubmitBtn');
            const alertBox = document.getElementById('bookingAlert');
            btn.disabled = true;
            btn.textContent = 'Submitting...';

            const payload = {
                patientName: document.getElementById('bName').value,
                phone: document.getElementById('bPhone').value,
                email: document.getElementById('bEmail').value,
                service: document.getElementById('bService').value,
                preferredDate: document.getElementById('bDate').value,
                preferredTime: document.getElementById('bTime').value,
                firstVisit: document.getElementById('bFirst').value,
                message: document.getElementById('bMessage').value
            };

            try {
                const res = await fetch('/api/appointments', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                
                if (res.ok) {
                    document.getElementById('bookingForm').style.display = 'none';
                    document.getElementById('bookingSuccess').style.display = 'block';
                    document.getElementById('bRefNumber').textContent = data.reference;
                } else {
                    throw new Error(data.error || 'Submission failed');
                }
            } catch (err) {
                alertBox.className = 'alert alert-error';
                alertBox.textContent = err.message;
                alertBox.style.display = 'block';
            } finally {
                btn.disabled = false;
                btn.textContent = 'Submit Request';
            }
        }

        async function submitContact(e) {
            e.preventDefault();
            const alertBox = document.getElementById('contactAlert');
            
            const payload = {
                name: document.getElementById('cName').value,
                contactInfo: document.getElementById('cContact').value,
                message: document.getElementById('cMessage').value
            };

            try {
                const res = await fetch('/api/contact', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (res.ok) {
                    alertBox.className = 'alert alert-success';
                    alertBox.textContent = 'Message sent successfully. We will get back to you soon.';
                    alertBox.style.display = 'block';
                    e.target.reset();
                } else {
                    throw new Error(data.error || 'Submission failed');
                }
            } catch (err) {
                alertBox.className = 'alert alert-error';
                alertBox.textContent = err.message;
                alertBox.style.display = 'block';
            }
        }
    </script>
</body>
</html>`;
}
