const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config(); // Load environment variables from .env file
const jwt = require('jsonwebtoken');
const http = require('http');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { Server } = require('socket.io');

// 1. Prevent silent crashes: Log and gracefully handle process-level exceptions
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('[FATAL] Unhandled Rejection:', err);
  process.exit(1);
});

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY || 1); // Dynamic trust proxy for different load balancers
const server = http.createServer(app);

const corsOptions = {
  origin: function(origin, callback) {
    // Explicitly whitelist Vercel production and local development origins
    const allowedOrigins = [
      'https://wattzen.vercel.app',
      'http://localhost:5173',
      'http://127.0.0.1:5173'
    ];
    const isLocalNetwork = /^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)\d{1,3}(:\d+)?$/.test(origin);
    const isVercelPreview = /^https:\/\/.*\.vercel\.app$/.test(origin); // 1. Support dynamic Vercel Preview Branch URLs
    const isRenderPreview = /^https:\/\/.*\.onrender\.com$/.test(origin); // Support Render Preview Branches
    if (!origin || allowedOrigins.includes(origin) || isLocalNetwork || isVercelPreview || isRenderPreview) {
      callback(null, true);
    } else {
      callback(new Error('Blocked by CORS policy'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
};
// Configure Socket.io and CORS
const io = new Server(server, { cors: corsOptions });
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Explicitly handle CORS preflight for serverless hosting
// 1. Prevent OOM Crashes: Restrict incoming JSON payloads to 100kb max
app.use(express.json({ limit: '100kb' }));

// Apply strict Security Headers to prevent Clickjacking and Framework Fingerprinting
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload'); // Enforce HTTPS at proxy level
  next();
});

// 10. Global Error Handler for all Express errors to prevent leaking HTML stack traces
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) return res.status(400).json({ message: 'Invalid JSON payload format' });
  console.error('[Server Error]', err);
  res.status(err.status || 500).json({ message: 'Internal Server Error' });
});

// Add a request logger to verify if the frontend is reaching the backend
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Origin: ${req.headers.origin}`);
  next();
});

let criticalSystemError = null;
let isDbConnected = false;

const PORT = process.env.PORT || 5000;
// Fallback to live credentials to ensure zero downtime even if Render environment variables are missing
const JWT_SECRET = process.env.JWT_SECRET || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://barber:iamninja@cluster0.y4kvgub.mongodb.net/wattzen?appName=Cluster0';

if (process.env.NODE_ENV === 'production' && (!process.env.MONGO_URI || !process.env.JWT_SECRET)) {
  criticalSystemError = 'Backend misconfigured: Missing MONGO_URI or JWT_SECRET on Render.';
  console.error(`\n[FATAL ERROR] ${criticalSystemError}\n`);
}

// Prevent the server from crashing, instead returning a clean JSON error to the frontend so CORS doesn't break
app.use('/api', (req, res, next) => {
  if (criticalSystemError) {
    return res.status(503).json({ message: criticalSystemError });
  }
  if (!isDbConnected) {
    return res.status(503).json({ message: 'Server is starting and connecting to the database. Please wait a moment.' });
  }
  next();
});

// ==========================================
// 1. MONGODB SCHEMAS & MODELS
// ==========================================
mongoose.set('strictQuery', false); // Silence strictQuery deprecation warnings on Mongoose 7+

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB disconnected! Auto-reconnecting...');
  isDbConnected = false;
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected successfully!');
  isDbConnected = true;
  criticalSystemError = null;
});

const connectDB = async (retries = 5) => {
  if (criticalSystemError && criticalSystemError.includes('misconfigured')) return;
  // Serverless DB caching: Prevent connection pool exhaustion by reusing active connections
  if (mongoose.connection.readyState >= 1) {
    isDbConnected = true;
    return;
  }
  try {
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
    });
    isDbConnected = true;
    criticalSystemError = null;
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error(`Could not connect to MongoDB. Retries left: ${retries} -`, err.message);
    if (retries > 0) {
      setTimeout(() => connectDB(retries - 1), 5000); // Wait 5 seconds and retry
    } else {
      criticalSystemError = 'Database connection failed. Check your MongoDB Atlas Network Access.';
    }
  }
};

// START THE SERVER IMMEDIATELY so Render doesn't throw a 502 Bad Gateway during DB connection delays
if (!process.env.VERCEL) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}
connectDB(); // Initiate DB connection asynchronously

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['customer', 'electrician', 'admin'], required: true },
  totalReviews: { type: Number, default: 0, min: 0 },
  averageRating: { type: Number, default: 0, min: 0, max: 5 },
  walletBalance: { type: Number, default: 0, min: 0 }, // DB-level lock against negative balances
  jobsCompleted: { type: Number, default: 0, min: 0 }
}, { timestamps: true });

const jobSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  electricians: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  serviceType: { type: String, required: true },
  address: { type: String, required: true },
  location: {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: { 
      type: [Number], 
      required: true,
      validate: {
        validator: function(v) { return v.length === 2 && v[0] >= -180 && v[0] <= 180 && v[1] >= -90 && v[1] <= 90; },
        message: 'Invalid GPS coordinates format'
      }
    }
  },
  estimatedPrice: { type: Number, default: 299, min: 0, max: 1000000 },
  currentTeamSize: { type: Number, default: 0, min: 0 }, 
  teamSize: { type: Number, default: 1, min: 1 },
  jobOTP: { type: String },
  paymentStatus: { type: String, enum: ['pending', 'verifying', 'paid'], default: 'pending' },
  status: { type: String, enum: ['verifying_payment', 'searching', 'assigned', 'in_progress', 'payment', 'completed', 'cancelled'], default: 'verifying_payment' },
  isRated: { type: Boolean, default: false }, // Kept for backwards compatibility
  ratedElectricians: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  messages: [{
    senderId: String,
    senderName: String,
    text: { type: String, maxlength: 1000 }, // Prevent giant chat payload attacks
    time: String
  }]
}, { timestamps: true });

jobSchema.index({ location: '2dsphere' });
jobSchema.index({ status: 1 }); // Optimize high-frequency status queries made by electricians
// Missing Indexes for Job History queries (prevents fatal Full Collection Scans)
jobSchema.index({ customer: 1 });
jobSchema.index({ electricians: 1 });
jobSchema.index({ status: 1, location: '2dsphere' }); // Compound index for the geospatial matching query
jobSchema.index({ customer: 1, electricians: 1, status: 1 }); // 6. Optimize rating authorization lookups
jobSchema.index({ createdAt: -1 }); // Optimize job history and available jobs sorting

const withdrawalSchema = new mongoose.Schema({
  electrician: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true, min: 1 }, // Prevent negative withdrawal hacks
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' } // Added rejected state
}, { timestamps: true });

withdrawalSchema.index({ status: 1 }); // Optimize admin pending withdrawals query
withdrawalSchema.index({ electrician: 1, createdAt: -1 }); // Optimize future user history lookups

const User = mongoose.model('User', userSchema);
const Job = mongoose.model('Job', jobSchema);
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

// ==========================================
// 2. SOCKET.IO SETUP
// ==========================================

// Security: JWT Authentication Middleware for WebSockets to prevent eavesdropping
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication error: Missing token'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET, { issuer: 'wattzen-api' });
    next();
  } catch (err) {
    next(new Error('Authentication error: Invalid token'));
  }
});

const socketRateLimits = new Map();

io.on('connection', (socket) => {
  // Security: Validate payload types to prevent socket-based crashes or prototype pollution
  socket.on('joinJobRoom', async (jobId) => {
    // Enforce valid MongoDB ObjectId regex to prevent RAM poisoning via arbitrary room names
    if (typeof jobId === 'string' && /^[0-9a-fA-F]{24}$/.test(jobId)) {
      // 1. Security: WebSocket IDOR Protection - Verify membership before joining
      try {
        const job = await Job.findById(jobId).select('customer electricians');
        if (!job) return;
        const userId = socket.user.userId;
        const isAuth = socket.user.role === 'admin' || job.customer.toString() === userId || job.electricians.some(e => e.toString() === userId);
        if (isAuth) socket.join(jobId);
      } catch (err) { console.error('Socket join error:', err); }
    }
  });
  socket.on('updateLocation', (data) => {
    // Enforce Role: Only electricians are allowed to broadcast location data
    if (socket.user?.role !== 'electrician') return;

    // 5. WebSocket Location DDoS protection (Max 1 update per second)
    const now = Date.now();
    if (now - (socketRateLimits.get(socket.id) || 0) < 1000) return;
    socketRateLimits.set(socket.id, now);

    // 6. Socket JWT Zombie Connections Check
    if (socket.user.exp && now >= socket.user.exp * 1000) {
      socket.emit('auth-expired');
      return socket.disconnect(true);
    }

    // 2. Security: Validate updateLocation payload to prevent client-side crash/XSS injection
    if (data && typeof data.jobId === 'string' && data.jobId.length < 50 && Array.isArray(data.coordinates) && data.coordinates.length === 2) {
      // 2b. Cross-room spamming protection: Must be in the room to broadcast to it
      if (!socket.rooms.has(data.jobId)) return;
      if (data.coordinates[0] === 0 && data.coordinates[1] === 0) return; // 7. Security: Null Island Bypass Protection
      io.to(data.jobId).emit('electricianLocationChanged', {
        jobId: data.jobId,
        coordinates: [Number(data.coordinates[0]) || 0, Number(data.coordinates[1]) || 0],
        distance: String(data.distance).substring(0, 10),
        eta: Number(data.eta) || 0
      });
    }
  });
  socket.on('sendMessage', async (data) => {
    // 6. Socket JWT Zombie Connections Check
    if (socket.user.exp && Date.now() >= socket.user.exp * 1000) {
      socket.emit('auth-expired');
      return socket.disconnect(true);
    }

    if (data && typeof data.jobId === 'string' && data.jobId.length < 50) {
      if (!socket.rooms.has(data.jobId)) return;
      // Security: Enforce types and truncate lengths to prevent NoSQL/payload injection attacks
      data.text = String(data.text || '').substring(0, 1000);
      data.senderName = String(data.senderName || 'User').substring(0, 50);
      data.senderId = String(data.senderId || '');
      socket.to(data.jobId).emit('receiveMessage', data);
      // Prevent MongoDB Document Bloat (>16MB) by keeping only the latest 500 messages
      try { await Job.findByIdAndUpdate(data.jobId, { $push: { messages: { $each: [data], $slice: -500 } } }); } catch (err) { console.error('Failed to save message:', err); }
    }
  });
  socket.on('typing', (data) => {
    if (data && typeof data.jobId === 'string' && data.jobId.length < 50) {
      if (socket.rooms.has(data.jobId)) socket.to(data.jobId).emit('userTyping', data);
    }
  });
  socket.on('stopTyping', (data) => {
    if (data && typeof data.jobId === 'string' && data.jobId.length < 50) {
      if (socket.rooms.has(data.jobId)) socket.to(data.jobId).emit('userStopTyping', data);
    }
  });

  socket.on('disconnect', () => socketRateLimits.delete(socket.id));
});

// ==========================================
// 3. EXPRESS ROUTING & MIDDLEWARE
// ==========================================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'Unauthorized: Missing token' });

  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized: Invalid or expired token' });
  }
};

const api = express.Router();

// In-memory store for admin login attempts to prevent brute-force
const adminLoginAttempts = new Map();
// Rate limiter for standard user logins to prevent credential stuffing
const userLoginAttempts = new Map();
// Rate limiter for account creation
const signupRateLimits = new Map();
// Rate limiter for job OTP verification
const jobOtpAttempts = new Map();

// In-memory OTP store (Use Redis for multi-instance production)
const otpStore = new Map();
// Rate limiter to prevent SMS API abuse and spam
const otpRateLimits = new Map();

// Security/Performance: Periodically clean up the admin login attempts map to prevent memory leaks (OOM)
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of adminLoginAttempts.entries()) {
    if (now > record.lockUntil) {
      adminLoginAttempts.delete(ip);
    }
  }
  for (const [ip, record] of userLoginAttempts.entries()) {
    if (now > record.lockUntil) {
      userLoginAttempts.delete(ip);
    }
  }
  for (const [ip, record] of signupRateLimits.entries()) {
    if (now > record.lockUntil) {
      signupRateLimits.delete(ip);
    }
  }
  
  // Clean up expired OTPs and Rate Limits to prevent memory leaks (OOM)
  for (const [phone, record] of otpStore.entries()) {
    if (now > record.expiresAt) {
      otpStore.delete(phone);
    }
  }
  for (const [phone, expTime] of otpRateLimits.entries()) {
    if (now > expTime) {
      otpRateLimits.delete(phone);
    }
  }

  // Emergency DDoS flush: Prevent Heap OOM if botnet floods the Maps
  if (otpStore.size > 10000) otpStore.clear();
  if (otpRateLimits.size > 10000) otpRateLimits.clear();
  if (jobOtpAttempts.size > 10000) jobOtpAttempts.clear();
}, 60 * 60 * 1000); // Clean up every hour

// Background Job Sweeper: Auto-cancel "ghost jobs" searching for > 2 hours to refund customers
setInterval(async () => {
  if (!isDbConnected) return;
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const stuckJobs = await Job.find({ status: 'searching', updatedAt: { $lt: twoHoursAgo } });
    for (const job of stuckJobs) {
      job.status = 'cancelled';
      await job.save();
      if (job.paymentStatus === 'paid') {
        await User.findByIdAndUpdate(job.customer, { $inc: { walletBalance: job.estimatedPrice } });
      }
      io.to(job._id.toString()).emit('jobCancelled');
    }
  } catch (err) { console.error('Ghost job cleanup failed:', err); }
}, 30 * 60 * 1000);

// 8. Stuck Job Payout Lockup Sweeper (Auto-complete after 24h)
setInterval(async () => {
  if (!isDbConnected) return;
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const stuckJobs = await Job.find({ status: 'in_progress', updatedAt: { $lt: oneDayAgo } });
    for (const job of stuckJobs) {
      job.status = 'completed';
      await job.save({ validateModifiedOnly: true }); // 12. Robust ghost saving
      
      if (job.electricians && job.electricians.length > 0) {
        const uniqueElectricians = [...new Set(job.electricians.map(e => e.toString()))];
        const earningsPerElectrician = Math.floor(((job.estimatedPrice * 0.8) / Math.max(1, uniqueElectricians.length)) * 100) / 100;
        await User.updateMany(
          { _id: { $in: uniqueElectricians } },
          { $inc: { walletBalance: earningsPerElectrician, jobsCompleted: 1 } }
        );
      }
      io.to(job._id.toString()).emit('jobCompleted');
    }
  } catch (err) { console.error('Stuck job auto-complete failed:', err); }
}, 60 * 60 * 1000); // Check every hour

// Graceful shutdown for MongoDB connection pool
const shutdown = async () => {
  if (isDbConnected) await mongoose.connection.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGUSR2', shutdown); // Handle nodemon/PM2 hot-reloads to prevent zombie DB connections

// POST /api/admin/secret-login - Hidden backdoor login
api.post('/admin/secret-login', async (req, res) => {
  try {
    // FIX: Better IP detection to prevent 'undefined' from sharing a single rate-limit pool behind proxies
    const clientIp = getClientIp(req);
    const now = Date.now();
    const attemptRecord = adminLoginAttempts.get(clientIp) || { count: 0, lockUntil: 0 };

    if (now < attemptRecord.lockUntil) {
      const waitTime = Math.ceil((attemptRecord.lockUntil - now) / 60000);
      return res.status(429).json({ message: `Too many failed attempts. Please try again in ${waitTime} minutes.` });
    }

    // FIX: Trim the environment variable to prevent silent space/newline characters in .env files from breaking the master password
    const ADMIN_PIN = (process.env.ADMIN_SECRET_PIN || '79827').trim();
    if (!ADMIN_PIN) {
      console.error(`[SECURITY ALERT] Admin login attempt at ${new Date().toISOString()} but ADMIN_SECRET_PIN is not configured.`);
      return res.status(500).json({ message: 'Internal server error: Admin access misconfigured' });
    }

    const providedPin = Buffer.from(String(req.body.password || ''));
    const actualPin = Buffer.from(ADMIN_PIN);

    // FIX: Use timingSafeEqual to prevent side-channel timing attacks on the Master PIN
    if (providedPin.length === actualPin.length && crypto.timingSafeEqual(providedPin, actualPin)) {
      adminLoginAttempts.delete(clientIp); // Clear attempts on success
      console.log(`[AUDIT] Successful Admin Login from IP: ${clientIp} at ${new Date().toISOString()}`);
      let admin = await User.findOne({ role: 'admin' });
      if (!admin) {
        // Use a non-numeric string to guarantee no collision with regular user phone numbers
        try {
          admin = await User.create({ name: 'System Admin', phone: 'ADMIN_MASTER', password: await bcrypt.hash(ADMIN_PIN, 10), role: 'admin' });
        } catch(e) {
          // Catch race condition if 2 admins trigger this simultaneously
          if (e.code === 11000) admin = await User.findOne({ role: 'admin' });
        }
      }
      const token = jwt.sign({ userId: admin._id, role: 'admin' }, JWT_SECRET, { expiresIn: '7d', issuer: 'wattzen-api' });
      
      // FIX: Secure the payload to prevent leaking the hashed PIN back to the frontend
      return res.json({ token, user: { _id: admin._id, name: admin.name, phone: admin.phone, role: admin.role } });
    }

    console.warn(`[AUDIT] Failed Admin Login attempt from IP: ${clientIp} at ${new Date().toISOString()}`);
    attemptRecord.count += 1;
    if (attemptRecord.count >= 5) {
      attemptRecord.lockUntil = now + 15 * 60 * 1000; // 15-minute lockout after 5 failures
      attemptRecord.count = 0; // Reset counter for after lockout expires
    }
    adminLoginAttempts.set(clientIp, attemptRecord);

    res.status(403).json({ 
      message: attemptRecord.lockUntil > now 
        ? 'Too many failed attempts. Access locked for 15 minutes.' 
        : 'Invalid Admin PIN' 
    });
  } catch (error) {
    console.error('[ERROR] Admin login failed:', error);
    res.status(500).json({ message: 'Internal server error during admin authentication' });
  }
});

// POST /api/signup
api.post('/signup', async (req, res) => {
  try {
    // 3. Signup DDoS Rate Limiter
    const clientIp = getClientIp(req);
    const now = Date.now();
    const signupRecord = signupRateLimits.get(clientIp) || { count: 0, lockUntil: 0 };
    if (now < signupRecord.lockUntil) {
      const waitTime = Math.ceil((signupRecord.lockUntil - now) / 60000);
      return res.status(429).json({ message: `Too many signups from this IP. Try again in ${waitTime} minutes.` });
    }

    // 3. Security: Typecast inputs to prevent NoSQL Injection & Parameter Pollution
    const name = String(req.body.name || '').replace(/[<>]/g, '').trim().substring(0, 50); // 4. Stored XSS Prevention
    const phone = String(req.body.phone || '').trim().substring(0, 15);
    const password = String(req.body.password || '');
    const role = String(req.body.role || '').trim();
    if (!name || !phone || !password || !role) return res.status(400).json({ message: 'All fields are required' });

    // Security: Prevent unauthorized creation of admin accounts
    if (role === 'admin') {
      return res.status(403).json({ message: 'Unauthorized: Admin role cannot be self-assigned' });
    }
    if (!['customer', 'electrician'].includes(role)) return res.status(400).json({ message: 'Invalid role selection' });

    // Basic Input Validation
    const phoneRegex = /^\d{10}$/;
    if (!phoneRegex.test(phone)) return res.status(400).json({ message: 'Invalid phone number format. Must be 10 digits.' });
    // 7. Password Length DoS protection
    if (password.length < 6 || password.length > 100) return res.status(400).json({ message: 'Password must be between 6 and 100 characters.' });

    let existingUser = await User.findOne({ phone });
    if (existingUser) return res.status(400).json({ message: 'Phone number already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, phone, password: hashedPassword, role });
    await user.save();
    io.emit('adminRefresh');

    // Register success, update rate limit (max 3 signups per 24h per IP)
    signupRecord.count += 1;
    if (signupRecord.count >= 3) signupRecord.lockUntil = now + 24 * 60 * 60 * 1000;
    signupRateLimits.set(clientIp, signupRecord);

    const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d', issuer: 'wattzen-api' });
    res.status(201).json({ token, user: { _id: user._id, name: user.name, phone: user.phone, role: user.role } });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Phone number is already registered' });
    }
    res.status(500).json({ message: 'Internal server error during signup' });
  }
});

// POST /api/login
api.post('/login', async (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const now = Date.now();
    const attemptRecord = userLoginAttempts.get(clientIp) || { count: 0, lockUntil: 0 };

    if (now < attemptRecord.lockUntil) {
      const waitTime = Math.ceil((attemptRecord.lockUntil - now) / 60000);
      return res.status(429).json({ message: `Too many failed attempts. Please try again in ${waitTime} minutes.` });
    }

    // 9. Login Rate-Limit Race Condition Fix: Synchronously update lock BEFORE database I/O
    attemptRecord.count += 1;
    if (attemptRecord.count >= 10) attemptRecord.lockUntil = now + 10 * 60 * 1000;
    userLoginAttempts.set(clientIp, attemptRecord);

    // 4. Security: Typecast to prevent NoSQL Injection
    const phone = String(req.body.phone || '').trim().substring(0, 15);
    const password = String(req.body.password || '');
    const role = String(req.body.role || '').trim();
    if (!phone || !password || !role) return res.status(400).json({ message: 'Phone, password, and role are required' });

    const user = await User.findOne({ phone, role });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials or wrong role' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    userLoginAttempts.delete(clientIp); // Clear rate limiter on success

    const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d', issuer: 'wattzen-api' });
    res.json({ token, user: { _id: user._id, name: user.name, phone: user.phone, role: user.role } });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error during authentication' });
  }
});

// GET /api/location/search - Proxy for Nominatim to prevent client-side CORS/ToS issues
api.get('/location/search', async (req, res) => {
  try {
    let { q } = req.query;
    if (!q) return res.status(400).json([]);
    
    q = Array.isArray(q) ? q[0] : q; // Security: Prevent HTTP Parameter Pollution arrays
    const safeQuery = String(q).substring(0, 100); // Prevent massive payloads to external proxy

    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(safeQuery)}&countrycodes=in&limit=5`, {
      headers: { 'User-Agent': 'WattzenApp/1.0 (contact@wattzen.com)' }
    });
    if (!response.ok) throw new Error(`Nominatim API Error: ${response.status}`); // 8. Prevent HTML parse crash
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: 'Location search failed' });
  }
});

// POST /api/auth/forgot-password - Trigger RapidAPI SMS
api.post('/auth/forgot-password', async (req, res) => {
  try {
    // 5. Security: Prevent NoSQL object injection
    const cleanPhone = String(req.body.phone || '').trim().substring(0, 15);
    if (!cleanPhone) return res.status(400).json({ message: 'Phone number is required' });
    
    const now = Date.now();
    const clientIp = getClientIp(req);
    
    // IP-level rate limiting (prevents spamming different numbers to bypass phone limits)
    if (otpRateLimits.has(clientIp) && now < otpRateLimits.get(clientIp)) {
      return res.status(429).json({ message: 'Too many requests from this IP. Please wait 30 seconds.' });
    }
    // Server-side rate limiting: 60-second cooldown per phone number
    if (otpRateLimits.has(cleanPhone) && now < otpRateLimits.get(cleanPhone)) {
      return res.status(429).json({ message: 'Please wait 60 seconds before requesting another OTP.' });
    }
    otpRateLimits.set(clientIp, now + 30000);
    otpRateLimits.set(cleanPhone, now + 60000);

    const user = await User.findOne({ phone: cleanPhone });
    if (!user) {
      // SECURITY: Prevent phone number enumeration by returning a generic success message
      return res.status(200).json({ message: 'If an account matches this number, an OTP has been sent.' });
    }

    // Generate 4-digit OTP using cryptographically secure RNG
    const otp = crypto.randomInt(1000, 10000).toString();
    otpStore.set(cleanPhone, { otp, expiresAt: Date.now() + 10 * 60 * 1000 }); // 10 min expiry
    
    console.log(`[OTP GENERATED] Phone: ${cleanPhone} | Code: ${otp}`);

    // Trigger RapidAPI SMS Verify Service
    try {
      const targetPhone = cleanPhone.startsWith('+') ? cleanPhone : `+91${cleanPhone}`;
      await fetch('https://sms-verify3.p.rapidapi.com/send-numeric-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rapidapi-host': 'sms-verify3.p.rapidapi.com',
          'x-rapidapi-key': process.env.RAPIDAPI_KEY || '555ce5482cmshbd501fa2db0bb62p1b08fejsnc93f81bcae7a'
        },
        // Removing 'estimate: true' so it actually dispatches the text message
        body: JSON.stringify({ target: targetPhone })
      });
    } catch (smsError) {
      console.error('[SMS ERROR] Failed to hit RapidAPI:', smsError.message);
      // We swallow the error so development isn't blocked if the API key limit is reached
    }

    res.status(200).json({ message: 'If an account matches this number, an OTP has been sent.' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error while requesting OTP' });
  }
});

// POST /api/auth/reset-password - Verify OTP and update password
api.post('/auth/reset-password', async (req, res) => {
  try {
    // 6. Security: Prevent NoSQL injection
    const cleanPhone = String(req.body.phone || '').trim().substring(0, 15);
    const otp = String(req.body.otp || '').trim().substring(0, 10);
    const newPassword = String(req.body.newPassword || '');
    if (!cleanPhone || !otp || !newPassword) return res.status(400).json({ message: 'All fields are required' });
    if (newPassword.length < 6 || newPassword.length > 100) return res.status(400).json({ message: 'Password must be between 6 and 100 characters' });

    const record = otpStore.get(cleanPhone);
    
    if (!record) return res.status(400).json({ message: 'OTP expired or not requested' });
    if (Date.now() > record.expiresAt) {
      otpStore.delete(cleanPhone);
      return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });
    }
    
    // 7. Security: Protect against OTP Brute Force attacks (Max 5 attempts)
    const providedOtp = Buffer.from(otp.padStart(4, '0'));
    const actualOtp = Buffer.from(record.otp);

    // 10. Security: Timing Attacks on OTPs
    if (providedOtp.length !== actualOtp.length || !crypto.timingSafeEqual(providedOtp, actualOtp)) {
      record.attempts = (record.attempts || 0) + 1;
      if (record.attempts >= 5) {
        otpStore.delete(cleanPhone);
        return res.status(429).json({ message: 'Too many failed attempts. OTP revoked.' });
      }
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // 3. Bcrypt Asymmetric DoS Fix: Fetch user before hashing the password
    const user = await User.findOne({ phone: cleanPhone });
    if (!user) {
      otpStore.delete(cleanPhone);
      return res.status(404).json({ message: 'Account no longer exists' });
    }
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    otpStore.delete(cleanPhone); // Clear token after success

    res.status(200).json({ message: 'Password reset successfully. You can now log in.' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error during password reset' });
  }
});

// GET /api/me - Get current user profile from token
api.get('/me', authenticateToken, async (req, res) => {
  try {
    // FIX: Explicitly exclude the password hash from being sent to the client
    const user = await User.findById(req.user.userId).select('-password -__v'); 
    if (!user) {
      // This case can happen if the user was deleted but the token is still valid.
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user.toObject());
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/me - Update user profile
api.put('/me', authenticateToken, async (req, res) => {
  try {
    // 8. Security: Typecast to prevent object injection
    const name = String(req.body.name || '').trim().substring(0, 50);
    const phone = String(req.body.phone || '').trim().substring(0, 15);
    if (!name || !phone) return res.status(400).json({ message: 'Name and phone are required' });
    
    const phoneRegex = /^\d{10}$/;
    if (!phoneRegex.test(phone)) return res.status(400).json({ message: 'Invalid phone number format. Must be 10 digits.' });

    // Ensure the new phone isn't already taken by another account
    const existing = await User.findOne({ phone, _id: { $ne: req.user.userId } });
    if (existing) return res.status(400).json({ message: 'Phone number already in use' });

    const updatedUser = await User.findByIdAndUpdate(
      req.user.userId, { name, phone }, { new: true }
    ).select('-password -__v');
    
    if (!updatedUser) return res.status(404).json({ message: 'User not found' });
    io.emit('adminRefresh'); // Update admin dashboard lists
    res.json(updatedUser.toObject());
  } catch (error) {
    res.status(500).json({ message: 'Internal server error updating profile' });
  }
});

// 9. DELETE /api/me - GDPR Account Deletion
api.delete('/me', authenticateToken, async (req, res) => {
  try {
    // 5. Security: Prevent Account Deletion Fraud (escaping active jobs)
    const activeCustomerJobs = await Job.countDocuments({ customer: req.user.userId, status: { $in: ['verifying_payment', 'searching', 'assigned', 'in_progress'] } });
    const activeElectricianJobs = await Job.countDocuments({ electricians: req.user.userId, status: { $in: ['assigned', 'in_progress'] } });
    if (activeCustomerJobs > 0 || activeElectricianJobs > 0) {
      return res.status(400).json({ message: 'Cannot delete account with active jobs. Please complete or cancel them first.' });
    }

    const deletedUser = await User.findByIdAndDelete(req.user.userId);
    if (!deletedUser) return res.status(404).json({ message: 'User not found' });
    res.status(200).json({ message: 'Account permanently deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error during deletion' });
  }
});

// POST /api/jobs - Create a new booking
api.post('/jobs', authenticateToken, async (req, res) => {
  try {
    // 2. Job Creation Authorization
    if (req.user.role !== 'customer') return res.status(403).json({ message: 'Only customers can create jobs' });

    // 9. Security: Enforce string limits to prevent large payload attacks
    const serviceType = String(req.body.serviceType || '').trim().substring(0, 50);
    const trimmedAddress = String(req.body.address || '').trim().substring(0, 250);
    const { coordinates, estimatedPrice, teamSize } = req.body;
    if (!serviceType || !trimmedAddress) return res.status(400).json({ message: 'Service type and valid address required' });

    // 10. DDoS Protection: Limit active jobs per customer to prevent database spam
    const activeJobsCount = await Job.countDocuments({ customer: req.user.userId, status: { $in: ['verifying_payment', 'searching', 'assigned', 'in_progress', 'payment'] } });
    if (activeJobsCount >= 3) {
      return res.status(429).json({ message: 'Maximum limit of 3 active jobs reached. Please complete or cancel an existing job.' });
    }

    // Security: Strictly enforce min and max bounds to prevent Schema Validation 500 crashes
    const safeTeamSize = Math.max(1, Math.min(10, Number(teamSize) || 1));
    const basePrice = safeTeamSize * 299;
    const safePrice = Math.min(1000000, Math.max(basePrice, Number(estimatedPrice) || basePrice)); // 3. Pricing Exploitation Vector

    // Security: Strict coordinate validation to prevent MongoDB 2dsphere index crashes
    if (!Array.isArray(coordinates) || coordinates.length !== 2 || 
        typeof coordinates[0] !== 'number' || typeof coordinates[1] !== 'number' ||
        coordinates[0] < -180 || coordinates[0] > 180 || 
        coordinates[1] < -90 || coordinates[1] > 90 ||
        (coordinates[0] === 0 && coordinates[1] === 0)) { // 4. Null Island Rejection
      return res.status(400).json({ message: 'Invalid GPS coordinates provided.' });
    }

    const newJob = new Job({
      customer: req.user.userId,
      serviceType,
      address: trimmedAddress,
      teamSize: safeTeamSize,
      location: { type: 'Point', coordinates },
      estimatedPrice: safePrice,
      paymentStatus: 'verifying',
      jobOTP: crypto.randomInt(1000, 10000).toString(), // Security: Cryptographically secure OTP
      status: 'verifying_payment'
    });

    await newJob.save();
    io.emit('adminRefresh');
    
    res.status(201).json(newJob);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error during booking' });
  }
});

// GET /api/jobs/active - Fetch current active job to restore session on page refresh
api.get('/jobs/active', authenticateToken, async (req, res) => {
  try {
    const query = { status: { $in: ['verifying_payment', 'searching', 'assigned', 'in_progress', 'payment'] } };
    if (req.user.role === 'customer') query.customer = req.user.userId;
    else if (req.user.role === 'electrician') query.electricians = req.user.userId;
    else return res.status(403).json({ message: 'Forbidden' });

    // 8. Bug Fix: Customers MUST see the jobOTP to read it to the electrician, but electricians should not see it!
    const selectFields = req.user.role === 'electrician' ? '-jobOTP' : '';
    const job = await Job.findOne(query).select(selectFields).populate('electricians', 'name phone averageRating totalReviews');
    res.status(200).json(job || {});
  } catch (error) {
    console.error('Error fetching active job:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/jobs/available - Fetch a pending job
api.get('/jobs/available', authenticateToken, async (req, res) => {
  try {
    const { latitude, longitude, maxDistance = 10 } = req.query;
    // Ensure we don't return team jobs that this electrician has already joined OR jobs that are already full
    let query = { 
      status: 'searching', 
      electricians: { $ne: req.user.userId },
      $expr: { $lt: ["$currentTeamSize", "$teamSize"] }
    };

    if (latitude && longitude) {
      const lat = parseFloat(latitude), lng = parseFloat(longitude);
      // 9. Clamp maxDistance to prevent Geospatial DB scanning attacks with negative numbers (Min 1km, Max 50km)
      const dist = Math.max(1000, Math.min(parseFloat(maxDistance) * 1000, 50000)); 
      if (isNaN(lat) || isNaN(lng) || isNaN(dist)) return res.status(400).json({ message: 'Invalid params' });

      query.location = { $near: { $geometry: { type: "Point", coordinates: [lng, lat] }, $maxDistance: dist } };
    }

    // Performance: Add pagination boundaries
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit) || 10)); // Default 10, max 50
    // 11. Security: Negative Pagination Infinity DoS Fix
    const skip = Math.max(0, Math.min((page - 1) * limit, 5000)); 

    let jobQuery = Job.find(query).select('serviceType address estimatedPrice status location customer teamSize currentTeamSize').skip(skip).limit(limit);
    if (!latitude || !longitude) {
      jobQuery = jobQuery.sort({ createdAt: -1 });
    }

    const jobs = await jobQuery;
    res.status(200).json(jobs);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/jobs/:id/accept - Accept a job
api.put('/jobs/:id/accept', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'electrician' && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid Job ID format' });

    // 3. Security: Prevent Electrician Job Hoarding (DDoS)
    if (req.user.role === 'electrician') {
      const activeJobs = await Job.countDocuments({ electricians: req.user.userId, status: { $in: ['assigned', 'in_progress'] } });
      if (activeJobs >= 1) return res.status(400).json({ message: 'You can only have 1 active job at a time. Complete your current job first.' });
    }

    const jobId = req.params.id;
    const electricianId = req.user.userId;

    // Atomically check limits, add the electrician to the team, and increment currentTeamSize
    // This query ensures we ONLY update if the team isn't full and the user isn't already in it.
    const updatedJob = await Job.findOneAndUpdate(
      { 
        _id: jobId, 
        status: 'searching', 
        customer: { $ne: electricianId }, // 11. Security: Prevent self-assignment farm boosting
        electricians: { $ne: electricianId }, // Security: Prevent duplicate joining/double-counting
        $expr: { $lt: ["$currentTeamSize", "$teamSize"] }
      },
      {
        $addToSet: { electricians: electricianId },
        $inc: { currentTeamSize: 1 }
      },
      { new: true, runValidators: true } // 1. Enforce max bounds
    ).populate('electricians', 'name phone averageRating totalReviews');

    if (!updatedJob) {
      return res.status(404).json({ message: 'Job not found, already assigned, or team is full' });
    }

    // Check if the team is now full
    if (updatedJob.currentTeamSize >= updatedJob.teamSize) {
      // Fix: Use updateOne to prevent Mongoose CastErrors when modifying a populated document
      await Job.updateOne({ _id: updatedJob._id }, { $set: { status: 'assigned' } });
      updatedJob.status = 'assigned'; // Keep local state updated for the socket emission
      // Notify everyone in the room (customer and all electricians) that the team is full
      io.to(jobId).emit('jobAccepted', { electricians: updatedJob.electricians, electrician: updatedJob.electricians[0] });
    } else {
      // Notify customer that a team member has joined
      const justAddedElectrician = updatedJob.electricians.find(e => e._id.equals(electricianId));
      io.to(jobId).emit('teamMemberJoined', { electrician: justAddedElectrician, teamSize: updatedJob.teamSize, currentSize: updatedJob.electricians.length });
    }
    io.emit('adminRefresh');

    // 1. Electrician OTP Theft Fix
    const safeJob = updatedJob.toObject();
    delete safeJob.jobOTP;

    res.status(200).json(safeJob);
  } catch (error) {
    console.error(`Error accepting job ${req.params.id} by electrician ${req.user?.userId}:`, error.stack);
    res.status(500).json({ message: 'Internal server error while accepting job' });
  }
});

// 5. PUT /api/jobs/:id/verify-otp - Electrician verifies arrival
api.put('/jobs/:id/verify-otp', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'electrician') return res.status(403).json({ message: 'Forbidden' });
    const { otp } = req.body;
    if (!otp || String(otp).trim().length !== 4) return res.status(400).json({ message: 'A valid 4-digit OTP is required' }); // 8. Job OTP Format Strictness

    const job = await Job.findOne({ _id: req.params.id, electricians: req.user.userId, status: 'assigned' });
    if (!job) return res.status(404).json({ message: 'Job not found or not currently assigned' });
    
    // 4. Job OTP Brute Force Protection
    const attemptKey = `${req.user.userId}_${req.params.id}`;
    const attempts = jobOtpAttempts.get(attemptKey) || 0;
    if (attempts >= 5) return res.status(429).json({ message: 'Too many invalid attempts. Contact support.' });

    if (job.jobOTP !== String(otp).trim()) {
      jobOtpAttempts.set(attemptKey, attempts + 1);
      return res.status(400).json({ message: 'Invalid OTP code' });
    }
    jobOtpAttempts.delete(attemptKey);
    
    job.status = 'in_progress';
    await job.save();
    
    io.to(job._id.toString()).emit('jobStatusUpdated', { status: 'in_progress' });
    res.status(200).json({ message: 'OTP verified successfully. Job is now in progress.' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error verifying OTP' });
  }
});

// 6. PUT /api/jobs/:id/drop - Electrician emergency drop
api.put('/jobs/:id/drop', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'electrician') return res.status(403).json({ message: 'Forbidden' });
    
    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, electricians: req.user.userId, status: 'assigned' },
      { $pull: { electricians: req.user.userId }, $inc: { currentTeamSize: -1 }, status: 'searching' },
      { new: true, runValidators: true }
    );
    
    if (!job) return res.status(404).json({ message: 'Job not found or already in progress' });
    
    // 9. Security: Prevent Socket Eavesdropping (Zombie Rooms)
    const sockets = await io.in(req.params.id).fetchSockets();
    for (const s of sockets) {
      if (s.user?.userId === req.user.userId) s.leave(req.params.id);
    }
    
    io.to(job._id.toString()).emit('electricianDropped', { electricianId: req.user.userId });
    io.emit('newJobAvailable', job); // Re-broadcast to other electricians
    res.status(200).json({ message: 'Job dropped successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error dropping job' });
  }
});

// PUT /api/jobs/:id/cancel - Cancel a job
api.put('/jobs/:id/cancel', authenticateToken, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid Job ID format' });

    // FIX: Atomic findOneAndUpdate prevents a Time-of-Check to Time-of-Use (TOCTOU) race condition 
    // where an electrician accepts the job at the exact millisecond the customer cancels it.
    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, customer: req.user.userId, status: { $in: ['searching', 'verifying_payment'] } },
      { status: 'cancelled' },
      { new: false, runValidators: true } // Returns the document BEFORE the update so we know if a refund is needed
    );
    if (!job) return res.status(404).json({ message: 'Job not found or already assigned' });

    // Logic Fix: Refund the customer if they had already paid upfront
    if (job.status === 'searching' && job.paymentStatus === 'paid') {
      await User.findByIdAndUpdate(req.user.userId, { $inc: { walletBalance: job.estimatedPrice } });
    }

    // Notify any partially joined or tracking electricians that the job was cancelled
    io.to(req.params.id).emit('jobCancelled');
    io.emit('adminRefresh');

    res.status(200).json({ message: 'Job cancelled successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/admin/jobs/:id/verify-payment - Admin approves upfront payment
api.put('/admin/jobs/:id/verify-payment', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid Job ID format' });
    
    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, status: 'verifying_payment' }, 
      { paymentStatus: 'paid', status: 'searching' }, 
      { new: true, runValidators: true }
    ).select('-jobOTP -messages'); // Security: Prevent leaking OTP and chat history to all connected sockets
    if (!job) return res.status(404).json({ message: 'Job not found' });
    
    io.to(req.params.id).emit('paymentVerified');
    io.emit('newJobAvailable', job); // Now SAFE to alert electricians!
    io.emit('adminRefresh');
    res.status(200).json(job);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/jobs/:id/complete - Customer completes job and triggers payout
api.put('/jobs/:id/complete', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'customer') return res.status(403).json({ message: 'Only customers can mark jobs complete' });
    
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid Job ID format' });

    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, customer: req.user.userId, status: { $in: ['assigned', 'in_progress'] } }, // 7. Hardened payout state checks
      { status: 'completed' },
      { new: true, runValidators: true }
    );
    
    if (!job) return res.status(404).json({ message: 'Job not found' });

    // Performance: Replace sequential loop with bulk updateMany operation
    if (job.electricians && job.electricians.length > 0) {
      // 10. Financial Bug: Floor precision to prevent over-payouts. Deduplicate array to prevent fragmented/lost payouts.
      const uniqueElectricians = [...new Set(job.electricians.map(e => e.toString()))];
      const earningsPerElectrician = Math.floor(((job.estimatedPrice * 0.8) / Math.max(1, uniqueElectricians.length)) * 100) / 100;
      await User.updateMany(
        { _id: { $in: uniqueElectricians } },
        { $inc: { walletBalance: earningsPerElectrician, jobsCompleted: 1 } }
      );
    }

    io.to(req.params.id).emit('jobCompleted'); // Notify all in room
    io.emit('adminRefresh');

    res.status(200).json(job);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/admin/users - Admin fetch all users
api.get('/admin/users', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden: Admin access required' });
    }

    // 10. Pagination application for Admin Users
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 50));
    const skip = Math.min((page - 1) * limit, 5000); 

    const users = await User.find({}).select('-password -__v').sort({ createdAt: -1 }).skip(skip).limit(limit);

    res.status(200).json(users);
  } catch (error) {
    console.error('Error fetching users for admin:', error);
    res.status(500).json({ message: 'Internal server error while fetching users' });
  }
});

// GET /api/admin/reports/completed-jobs - Admin report generation
api.get('/admin/reports/completed-jobs', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden: Admin access required' });
    }

    const completedJobs = await Job.find({ status: 'completed' })
      .populate('customer', 'name phone')
      .populate('electricians', 'name phone')
      .sort({ updatedAt: -1 })
      .limit(2000); // Performance: Prevent giant CSV payloads from crashing the browser

    res.status(200).json(completedJobs);
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ message: 'Internal server error while generating report' });
  }
});

// GET /api/admin/finance - Fetch pending jobs and withdrawals
api.get('/admin/finance', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    // 12. Performance & Privacy: Do not load messages arrays or OTPs into admin dashboard memory
    const pendingJobs = await Job.find({ status: 'verifying_payment' }).select('-messages -jobOTP').populate('customer', 'name phone').sort({ createdAt: -1 }).limit(100);
    const pendingWithdrawals = await Withdrawal.find({ status: 'pending' }).populate('electrician', 'name phone').sort({ createdAt: -1 }).limit(100);
    res.status(200).json({ pendingJobs, pendingWithdrawals });
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching finance records' });
  }
});

// POST /api/withdrawals - Request withdrawal
api.post('/withdrawals', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'electrician') return res.status(403).json({ message: 'Forbidden' });
    
    // 4. Security: Prevent Pending Withdrawal Spam (OOM/Dashboard Spam)
    const existingPending = await Withdrawal.findOne({ electrician: req.user.userId, status: 'pending' });
    if (existingPending) return res.status(400).json({ message: 'You already have a pending withdrawal request. Please wait for approval.' });

    const user = await User.findById(req.user.userId);
    if (!user || user.walletBalance < 500) {
      return res.status(400).json({ message: 'Minimum ₹500 required for withdrawal or insufficient balance' });
    }

    const amountToWithdraw = user.walletBalance;
    // Logic Fix: Ensure withdrawal amount is strictly positive
    if (amountToWithdraw <= 0) return res.status(400).json({ message: 'Invalid withdrawal amount' });

    // FIX: Deduct the exact amount to prevent overwriting concurrent earnings ($inc overwrites with $set: 0 bug)
    const updatedUser = await User.findOneAndUpdate(
      { _id: req.user.userId, walletBalance: { $gte: amountToWithdraw } },
      { $inc: { walletBalance: -amountToWithdraw } },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(400).json({ message: 'Transaction failed due to a concurrent balance change. Please try again.' });
    }

    try {
      const withdrawal = await Withdrawal.create({ electrician: user._id, amount: amountToWithdraw });
      io.emit('adminRefresh');
      res.status(201).json({ message: 'Withdrawal requested', withdrawal });
    } catch (createErr) {
      // Rollback: Prevent permanently lost money if document creation fails!
      await User.findByIdAndUpdate(req.user.userId, { $inc: { walletBalance: amountToWithdraw } });
      res.status(500).json({ message: 'Error processing withdrawal. Funds have been refunded to your wallet.' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Error processing withdrawal' });
  }
});

// PUT /api/admin/withdrawals/:id/approve
api.put('/admin/withdrawals/:id/approve', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid Withdrawal ID format' });
    
    const withdrawal = await Withdrawal.findOneAndUpdate(
      { _id: req.params.id, status: 'pending' }, 
      { status: 'approved' }, 
      { new: true, runValidators: true }
    );
    if (!withdrawal) return res.status(404).json({ message: 'Request not found' });
    io.emit('adminRefresh');
    res.status(200).json({ message: 'Withdrawal approved', withdrawal });
  } catch (error) {
    res.status(500).json({ message: 'Error approving withdrawal' });
  }
});

// PUT /api/admin/withdrawals/:id/reject - Reject withdrawal and refund wallet
api.put('/admin/withdrawals/:id/reject', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid Withdrawal ID format' });
    
    const withdrawal = await Withdrawal.findOneAndUpdate(
      { _id: req.params.id, status: 'pending' }, 
      { status: 'rejected' }, 
      { new: true, runValidators: true }
    );
    if (!withdrawal) return res.status(404).json({ message: 'Request not found' });
    
    // 12. Refund the deducted amount back to the electrician's wallet with validation guard
    await User.findByIdAndUpdate(withdrawal.electrician, { $inc: { walletBalance: withdrawal.amount } }, { runValidators: true });
    
    io.emit('adminRefresh');
    res.status(200).json({ message: 'Withdrawal rejected and refunded successfully', withdrawal });
  } catch (error) {
    res.status(500).json({ message: 'Error rejecting withdrawal' });
  }
});

// POST /api/admin/broadcast - Admin global message broadcast
api.post('/admin/broadcast', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    
    const msg = req.body.message;
    if (!msg || typeof msg !== 'string' || msg.trim().length === 0 || msg.length > 1000) {
      return res.status(400).json({ message: 'Invalid broadcast message payload' });
    }

    io.emit('systemBroadcast', req.body.message);
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ message: 'Error broadcasting message' });
  }
});

// POST /api/users/:id/rate - Rate an electrician
api.post('/users/:id/rate', authenticateToken, async (req, res) => {
  try {
    // 2. Security: Ensure only Customers can rate Electricians
    if (req.user.role !== 'customer') return res.status(403).json({ message: 'Only customers can submit ratings' });

    // Parse rating to a strict number to prevent MongoDB $multiply aggregation type errors
    // 12. Floor/round rating to prevent floating-point precision corruption
    const numericRating = Math.round(Number(req.body.rating));
    if (!numericRating || numericRating < 1 || numericRating > 5) return res.status(400).json({ message: 'Invalid rating' });

    if (!req.params.id || req.params.id === 'undefined' || !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid or missing Electrician ID' });
    }

    const electrician = await User.findById(req.params.id);
    if (!electrician || electrician.role !== 'electrician') return res.status(404).json({ message: 'Electrician not found' });

    // BUG FIX: Verify that the requesting user (customer) has a completed job with this electrician.
    // Use atomic findOneAndUpdate with $addToSet to prevent race conditions on double-rating
    const completedJob = await Job.findOneAndUpdate({
      customer: req.user.userId,
      electricians: req.params.id,
      status: 'completed',
      ratedElectricians: { $ne: req.params.id }
    }, {
      $addToSet: { ratedElectricians: req.params.id }
    });

    if (!completedJob) {
      return res.status(403).json({ message: 'Forbidden: You can only rate this electrician once after a completed job.' });
    }

    // Atomic Rating Update using Mongoose Aggregation Pipeline to prevent Lost Update Anomalies
    const updatedElectrician = await User.findOneAndUpdate(
      { _id: electrician._id },
      [
        { $set: {
            totalReviews: { $add: [{ $ifNull: ["$totalReviews", 0] }, 1] },
            averageRating: {
              $round: [
                { $divide: [
                  { $add: [
                    { $multiply: [{ $ifNull: ["$averageRating", 0] }, { $ifNull: ["$totalReviews", 0] }] },
                    numericRating
                  ]},
                  { $add: [{ $ifNull: ["$totalReviews", 0] }, 1] }
                ]},
                1
              ]
            }
        }}
      ],
      { new: true }
    );

    io.emit('adminRefresh');
    res.status(200).json({ message: 'Rating submitted', rating: updatedElectrician.averageRating });
  } catch (error) {
    console.error('Rating Error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/jobs/history - Fetch historical jobs securely
api.get('/jobs/history', authenticateToken, async (req, res) => {
  try {
    const query = {};
    if (req.user.role === 'customer') {
      query.customer = req.user.userId;
    } else if (req.user.role === 'electrician') {
      query.electricians = req.user.userId;
    } else return res.status(403).json({ message: 'Forbidden' });

    // Performance: Add pagination boundaries to prevent massive payload loading
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const skip = Math.min((page - 1) * limit, 5000); // 11. Pagination application

    const jobs = await Job.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('electricians', 'name phone').populate('customer', 'name phone');
    res.status(200).json(jobs);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/health - Zero-downtime deployment orchestrator check
api.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', dbConnected: isDbConnected, uptime: process.uptime() });
});

app.use('/api', api);

// Export the Express API for Vercel Serverless Functions
module.exports = app;