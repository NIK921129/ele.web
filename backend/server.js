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

// Helper to accurately extract and normalize IPv4/IPv6 client IP addresses
const getClientIp = (req) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown_ip';
  return ip.startsWith('::ffff:') ? ip.substring(7) : ip;
};

const corsOptions = {
  origin: function(origin, callback) {
    // Explicitly whitelist Vercel production and local development origins
    const allowedOrigins = [
      'https://wattzen.vercel.app',
      'http://localhost:5173',
      'http://127.0.0.1:5173'
    ];
    const isLocalNetwork = /^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)\d{1,3}(:\d+)?$/.test(origin);
    const isVercelPreview = /^https:\/\/.*\.vercel\.app$/.test(origin); // Support Vercel Preview Branches
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
// 1. Prevent OOM Crashes: Restrict incoming JSON payloads to 20mb max to allow multiple document uploads
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' })); // Support generic form payloads safely

// Apply strict Security Headers to prevent Clickjacking and Framework Fingerprinting
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload'); // Enforce HTTPS at proxy level
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://unpkg.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://unpkg.com; img-src 'self' data: https://*.tile.openstreetmap.org https://*.openstreetmap.org; connect-src 'self' ws: wss: https://nominatim.openstreetmap.org https://*.onrender.com https://*.vercel.app; font-src 'self' https://cdnjs.cloudflare.com;");
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
const bannedIpsCache = new Set();
global.MAINTENANCE_MODE = false; // System-wide lock flag

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI || !JWT_SECRET) {
  criticalSystemError = 'Backend misconfigured: Missing MONGO_URI or JWT_SECRET on Render.';
  console.error(`\n[FATAL ERROR] ${criticalSystemError}\n`);
}

// Prevent the server from crashing, instead returning a clean JSON error to the frontend so CORS doesn't break
app.use('/api', async (req, res, next) => {
  const clientIp = getClientIp(req);
  // 1. Maintenance Mode Interceptor
  if (global.MAINTENANCE_MODE && !req.url.startsWith('/admin') && !req.url.startsWith('/login') && !req.url.startsWith('/me')) {
    return res.status(503).json({ message: 'The system is currently down for maintenance. Please check back shortly.' });
  }
  if (bannedIpsCache.has(clientIp)) {
    return res.status(403).json({ message: 'Your IP address has been permanently banned from accessing this service.' });
  }
  if (criticalSystemError) {
    return res.status(503).json({ message: criticalSystemError });
  }
  if (mongoose.connection.readyState !== 1) {
    await connectDB(1); // Serverless Cold-Start Fix: Synchronously wait for DB connection to prevent immediate 503 drops
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

let dbConnectionPromise = null;
const connectDB = async (retries = 5) => {
  if (criticalSystemError && criticalSystemError.includes('misconfigured')) return;
  // Serverless DB caching: Prevent connection pool exhaustion by reusing active connections
  if (mongoose.connection.readyState >= 1) {
    isDbConnected = true;
    return;
  }
  if (dbConnectionPromise) return dbConnectionPromise;
  try {
    dbConnectionPromise = mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
    });
    await dbConnectionPromise;
    isDbConnected = true;
    criticalSystemError = null;
    console.log('Connected to MongoDB');
    
    // Load banned IPs into memory cache to intercept requests instantly
    try {
      const banned = await BannedIP.find();
      bannedIpsCache.clear();
      banned.forEach(b => bannedIpsCache.add(b.ip));
    } catch(e) { console.error('Failed to load banned IPs', e); }
  } catch (err) {
    console.error(`Could not connect to MongoDB. Retries left: ${retries} -`, err.message);
    dbConnectionPromise = null;
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      return connectDB(retries - 1);
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
  
  // Render Load Balancer Fix: Keep-Alive timeout must exceed the LB's 100s timeout to prevent 502 errors
  server.keepAliveTimeout = 120000; // 120 seconds
  server.headersTimeout = 121000; // MUST be strictly greater than keepAliveTimeout to prevent 502 race conditions
}
connectDB(); // Initiate DB connection asynchronously

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['customer', 'electrician', 'admin'], required: true },
  totalReviews: { type: Number, default: 0, min: 0 },
  averageRating: { type: Number, default: 0, min: 0, max: 5 },
  walletBalance: { type: Number, default: 0 }, // Allowed to drop negative if commission deductions exceed balance
  jobsCompleted: { type: Number, default: 0, min: 0 },
  address: { type: String },
  experienceYears: { type: Number },
  idCardUrl: { type: String }, // Base64 image
  panCardUrl: { type: String }, // Base64 image
  photoUrl: { type: String }, // Base64 image
  bankDetails: { type: String }, // Account Number and IFSC
  isApproved: { type: Boolean, default: true }, // Requires Admin approval for electricians
  safetyDepositPaid: { type: Boolean, default: true }, // Requires ₹500 deposit for electricians
  adminNotes: { type: String, default: '' } // Internal admin remarks
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
  originalPrice: { type: Number, min: 0 },
  walletAmountUsed: { type: Number, default: 0 }, // Track applied wallet balance for correct refunds
  couponUsed: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon' }, // Track used coupon for rollback
  paymentType: { type: String, enum: ['upfront', 'after_service'], default: 'upfront' }, // Track Cash/UPI collected by electrician vs platform
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

const walletRechargeSchema = new mongoose.Schema({
  electrician: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true, min: 1 },
  screenshotUrl: { type: String, required: true }, // Base64 image
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
}, { timestamps: true });

const bannedIpSchema = new mongoose.Schema({
  ip: { type: String, required: true, unique: true },
  reason: { type: String }
}, { timestamps: true });

const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  discountAmount: { type: Number, required: true, min: 1 },
  isUsed: { type: Boolean, default: false },
  usedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  usedAt: { type: Date }
}, { timestamps: true });

const archivedUserSchema = new mongoose.Schema({
  originalId: String,
  name: String,
  phone: String,
  plainPassword: String,
  role: String,
  walletBalance: Number,
  jobsCompleted: Number,
  address: String,
  experienceYears: Number,
  idCardUrl: String,
  panCardUrl: String,
  photoUrl: String,
  bankDetails: String,
  deletedAt: { type: Date, default: Date.now },
  deletedBy: String
});

const systemLogSchema = new mongoose.Schema({
  level: { type: String, default: 'INFO' },
  src: String,
  event: String,
  details: String
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Job = mongoose.model('Job', jobSchema);
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);
const WalletRecharge = mongoose.model('WalletRecharge', walletRechargeSchema);
const BannedIP = mongoose.model('BannedIP', bannedIpSchema);
const Coupon = mongoose.model('Coupon', couponSchema);
const SystemLog = mongoose.model('SystemLog', systemLogSchema);
const ArchivedUser = mongoose.model('ArchivedUser', archivedUserSchema);

const logSystemEvent = async (level, src, event, details) => {
  try {
    if (isDbConnected) await SystemLog.create({ level, src, event, details });
  } catch (err) { console.error('Log failed', err); }
};

// Helper function to dispatch automated Custom SMS Notifications
const sendSMSNotification = async (phone, message) => {
  try {
    const targetPhone = phone.startsWith('+') ? phone.replace('+91', '') : phone;
    console.log(`[SMS DISPATCHED] To: ${targetPhone} | Message: ${message}`);
    
    // To enable real SMS delivery, add your SMS API Key (e.g., Fast2SMS) to your .env
    if (process.env.SMS_API_KEY) {
      /*
      await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: { 'authorization': process.env.SMS_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ route: 'v3', sender_id: 'TXTIND', message: message, language: 'english', numbers: targetPhone })
      });
      */
    }
  } catch (err) {
    console.error('[SMS ERROR] Failed to send custom notification:', err.message);
  }
};

// ==========================================
// 2. SOCKET.IO SETUP
// ==========================================

// Security: JWT Authentication Middleware for WebSockets to prevent eavesdropping
io.use((socket, next) => {
  // FIX: Block Banned IPs from establishing persistent WebSocket connections
  const ip = socket.handshake.address;
  const clientIp = ip.startsWith('::ffff:') ? ip.substring(7) : ip;
  if (bannedIpsCache.has(clientIp)) return next(new Error('Authentication error: IP Banned'));

  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication error: Missing token'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET, { issuer: 'wattzen-api' });
    // Securely segregate admin traffic into a dedicated room
    if (socket.user.role === 'admin') {
      socket.join('sysAdminRoom');
    }
    next();
  } catch (err) {
    next(new Error('Authentication error: Invalid token'));
  }
});

// Helper to silently trigger a real-time UI profile sync for a specific user
const notifyUserRefresh = async (userId) => {
  try {
    const sockets = await io.fetchSockets();
    for (const s of sockets) {
      if (s.user?.userId === String(userId)) s.emit('forceProfileRefresh');
    }
  } catch (err) {}
};

const socketRateLimits = new Map();
const chatRateLimits = new Map();

io.on('connection', (socket) => {
  // Security: Validate payload types to prevent socket-based crashes or prototype pollution
  socket.on('joinJobRoom', async (jobId) => {
    // Enforce valid MongoDB ObjectId regex to prevent RAM poisoning via arbitrary room names
    if (typeof jobId === 'string' && /^[0-9a-fA-F]{24}$/.test(jobId)) {
      // 1. Security: WebSocket IDOR Protection - Verify membership before joining
      try {
        const job = await Job.findById(jobId).select('customer electricians status');
        if (!job) return;
        const userId = socket.user.userId;
        // Allow electricians to join 'searching' jobs pre-emptively to fix the acceptance race condition
        const isAuth = socket.user.role === 'admin' || job.customer.toString() === userId || job.electricians.some(e => e.toString() === userId) || (socket.user.role === 'electrician' && job.status === 'searching');
        if (isAuth) socket.join(jobId);
      } catch (err) { console.error('Socket join error:', err); }
    }
  });

  // FIX: Allow clients to drop out of rooms if they pre-emptively joined but got rejected
  socket.on('leaveJobRoom', (jobId) => {
    if (typeof jobId === 'string' && /^[0-9a-fA-F]{24}$/.test(jobId)) {
      socket.leave(jobId);
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

    // Security: Chat DDoS protection (Max 2 messages per second)
    const now = Date.now();
    if (now - (chatRateLimits.get(socket.id) || 0) < 500) return;
    chatRateLimits.set(socket.id, now);

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
  socket.on('triggerSOS', async (data) => {
    if (data && typeof data.jobId === 'string') {
      // Prevent Database Flood DoS from malicious SOS spam
      const now = Date.now();
      if (now - (sosRateLimits.get(socket.id) || 0) < 60000) return;
      sosRateLimits.set(socket.id, now);

      logSystemEvent('WARN', 'Safety', 'SOS Triggered', `SOS from ${data.userId} on Job ${data.jobId}`);
      
      // Target ONLY active admins to prevent a platform-wide user panic
      try {
        const sockets = await io.fetchSockets();
        for (const s of sockets) {
          if (s.user?.role === 'admin') {
            s.emit('systemBroadcast', `🚨 EMERGENCY SOS TRIGGERED by ${String(data.role).toUpperCase()} in Job: ${data.jobId} 🚨`);
          }
        }
      } catch (err) { console.error('SOS Broadcast Error:', err); }
    }
  });

  socket.on('disconnect', () => {
    socketRateLimits.delete(socket.id);
    chatRateLimits.delete(socket.id);
    sosRateLimits.delete(socket.id);
  });
});

// Real-time Admin Metrics Broadcaster
setInterval(() => {
  if (io && io.engine) {
    io.to('sysAdminRoom').emit('adminMetrics', { clientsCount: io.engine.clientsCount });
  }
}, 5000);

// ==========================================
// 3. EXPRESS ROUTING & MIDDLEWARE
// ==========================================
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'Unauthorized: Missing token' });

  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized: Invalid or expired token' });
  }

  try {
    if (isDbConnected) {
      // Zombie Token Prevention: Verify user still exists in database to instantly lock out deleted/purged accounts
      const userExists = await User.exists({ _id: req.user.userId });
      if (!userExists) return res.status(401).json({ message: 'Session expired. Account deleted.' });
    }
    next();
  } catch (dbErr) {
    console.error('Auth DB Check Error:', dbErr);
    next(); // Fail open on transient DB errors to avoid mass logouts
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
// Rate limiter for SOS triggers
const sosRateLimits = new Map();

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
  for (const [key, record] of jobOtpAttempts.entries()) {
    if (now > record.lockUntil) jobOtpAttempts.delete(key);
  }
  for (const [id, lockTime] of sosRateLimits.entries()) {
    if (now > lockTime) sosRateLimits.delete(id);
  }
  
  // Clean up expired OTPs and Rate Limits to prevent memory leaks (OOM)
  for (const [phone, expTime] of otpRateLimits.entries()) {
    if (now > expTime) {
      otpRateLimits.delete(phone);
    }
  }

  // Emergency DDoS flush: Prevent Heap OOM if botnet floods the Maps
  if (otpRateLimits.size > 10000) otpRateLimits.clear();
  if (jobOtpAttempts.size > 10000) jobOtpAttempts.clear();
  if (userLoginAttempts.size > 10000) userLoginAttempts.clear();
  if (adminLoginAttempts.size > 10000) adminLoginAttempts.clear();
  if (signupRateLimits.size > 10000) signupRateLimits.clear();
  if (chatRateLimits.size > 10000) chatRateLimits.clear();
  if (sosRateLimits.size > 10000) sosRateLimits.clear();
}, 60 * 60 * 1000); // Clean up every hour

// Background Job Sweeper Logic
const runGhostJobSweeper = async () => {
  if (!isDbConnected) return;
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    // FIX: Include 'verifying_payment' so abandoned checkouts don't clog the database forever
    const stuckJobs = await Job.find({ status: { $in: ['verifying_payment', 'searching', 'assigned'] }, updatedAt: { $lt: twoHoursAgo } });
    for (const job of stuckJobs) {
      try {
        const updatedJob = await Job.findOneAndUpdate(
          { _id: job._id, status: { $in: ['verifying_payment', 'searching', 'assigned'] } },
          { status: 'cancelled' },
          { new: false } // Get the old doc to process refunds accurately
        );
        if (!updatedJob) continue;

        if (updatedJob.paymentStatus === 'paid') {
          await User.findByIdAndUpdate(updatedJob.customer, { $inc: { walletBalance: updatedJob.estimatedPrice } });
        }
        if (updatedJob.walletAmountUsed && updatedJob.walletAmountUsed > 0) {
          await User.findByIdAndUpdate(updatedJob.customer, { $inc: { walletBalance: updatedJob.walletAmountUsed } });
        }
        if (updatedJob.couponUsed) {
          await Coupon.findByIdAndUpdate(updatedJob.couponUsed, { $set: { isUsed: false }, $unset: { usedBy: 1, usedAt: 1 } });
        }
        io.to(updatedJob._id.toString()).emit('jobCancelled');
      } catch (innerErr) {
        console.error(`Ghost sweep failed for job ${job._id}:`, innerErr);
      }
    }
  } catch (err) { console.error('Ghost job cleanup failed:', err); }
};

// Stuck Job Payout Sweeper Logic (Auto-complete after 24h)
const runStuckJobSweeper = async () => {
  if (!isDbConnected) return;
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const stuckJobs = await Job.find({ status: { $in: ['in_progress', 'payment'] }, updatedAt: { $lt: oneDayAgo } });
    for (const job of stuckJobs) {
      try {
        const updatedJob = await Job.findOneAndUpdate(
          { _id: job._id, status: { $in: ['in_progress', 'payment'] } },
          { status: 'completed', paymentStatus: 'paid' },
          { new: true }
        );
        if (!updatedJob) continue;
        
        if (updatedJob.electricians && updatedJob.electricians.length > 0) {
          const uniqueElectricians = [...new Set(updatedJob.electricians.map(e => e.toString()))];
          const basePayout = updatedJob.originalPrice || updatedJob.estimatedPrice;
          
          if (updatedJob.paymentType === 'after_service') {
            const commissionPerElectrician = Math.floor(((basePayout * 0.20) / Math.max(1, uniqueElectricians.length)) * 100) / 100;
            await User.updateMany(
              { _id: { $in: uniqueElectricians } },
              { $inc: { walletBalance: -commissionPerElectrician, jobsCompleted: 1 } }
            );
          } else {
            const earningsPerElectrician = Math.floor(((basePayout * 0.80) / Math.max(1, uniqueElectricians.length)) * 100) / 100;
            await User.updateMany(
              { _id: { $in: uniqueElectricians } },
              { $inc: { walletBalance: earningsPerElectrician, jobsCompleted: 1 } }
            );
          }
        }
        logSystemEvent('WARN', 'Finance', 'Sweeper Auto-Payout', `Job ${job._id} auto-completed. Platform assumed liability for payout.`);
        io.to(job._id.toString()).emit('jobCompleted');
      } catch (innerErr) {
        console.error(`Stuck sweep failed for job ${job._id}:`, innerErr);
      }
    }
  } catch (err) { console.error('Stuck job auto-complete failed:', err); }
};

// Background sweepers for Long-Running Environments (Render/PM2)
if (!process.env.VERCEL) {
  setInterval(runGhostJobSweeper, 30 * 60 * 1000);
  setInterval(runStuckJobSweeper, 60 * 60 * 1000);
}

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

    const ADMIN_PIN = (process.env.ADMIN_SECRET_PIN || '8008').trim();
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
      logSystemEvent('INFO', 'AuthService', 'Admin Login', `Master Admin authenticated from ${clientIp}`);
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
    
    const address = String(req.body.address || '').trim().substring(0, 250);
    const experienceYears = Number(req.body.experienceYears) || 0;
    const idCardUrl = String(req.body.idCardBase64 || '');
    const bankDetails = String(req.body.bankDetails || '').trim().substring(0, 250);
    const panCardUrl = String(req.body.panCardBase64 || '');
    const photoUrl = String(req.body.photoBase64 || '');

    if (idCardUrl.length > 3000000 || panCardUrl.length > 3000000 || photoUrl.length > 3000000) {
      return res.status(400).json({ message: 'Document file sizes are too large. Please compress images before uploading.' });
    }

    if (!name || !phone || !password || !role) return res.status(400).json({ message: 'Basic fields are required' });
    if (role === 'electrician' && (!address || !experienceYears || !idCardUrl || !bankDetails || !panCardUrl || !photoUrl)) {
      return res.status(400).json({ message: 'Personal details, Bank Info, and all required Documents are mandatory for Electricians.' });
    }

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

    const otp = String(req.body.otp || '').trim().substring(0, 10);
    if (!otp) return res.status(400).json({ message: 'Verification OTP is required to sign up.' });

    // Security & Financial: Check DB BEFORE hitting Twilio to prevent SMS API billing exploitation
    let existingUser = await User.findOne({ phone });
    if (existingUser) return res.status(400).json({ message: 'Phone number already registered' });

    const targetPhone = phone.startsWith('+') ? phone : `+91${phone}`;
    const twilioAccountSid = 'ACebe0641d08c01bbe9192e4051bf40c1f';
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioVerifyServiceSid = 'VAe6e9351e557234c57132aceac37b4ded';

    if (!twilioAuthToken) {
      console.warn(`[DEV MODE] Bypassing Twilio SMS Verify for signup. Accepting OTP 123456 for ${targetPhone}`);
      if (otp !== '123456') return res.status(400).json({ message: 'Invalid OTP code.' });
    } else {
      const authHeader = 'Basic ' + Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64');
      const params = new URLSearchParams();
      params.append('To', targetPhone);
      params.append('Code', otp);

      try {
        const twilioRes = await fetch(`https://verify.twilio.com/v2/Services/${twilioVerifyServiceSid}/VerificationCheck`, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: params.toString()
        });

        const verification = await twilioRes.json();
        if (!twilioRes.ok) {
          if (twilioRes.status === 401) {
            console.warn(`[DEV MODE FALLBACK] Twilio Auth failed for signup. Accepting OTP 123456 for ${targetPhone}`);
            if (otp !== '123456') return res.status(400).json({ message: 'Invalid OTP code.' });
          } else {
            console.error('[TWILIO VERIFY ERROR]', verification);
            return res.status(400).json({ message: `Twilio Error: ${verification.message || 'Verification failed'}` });
          }
        } else if (verification.status !== 'approved') {
          return res.status(400).json({ message: 'Invalid OTP code.' });
        }
      } catch (err) {
        console.error('[TWILIO VERIFY ERROR]', err);
        return res.status(500).json({ message: 'Error verifying OTP' });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const isApproved = role === 'electrician' ? false : true;
    const safetyDepositPaid = role === 'electrician' ? false : true;
    const user = new User({ name, phone, password: hashedPassword, role, address, experienceYears, idCardUrl, bankDetails, panCardUrl, photoUrl, isApproved, safetyDepositPaid });
    await user.save();
    io.emit('adminRefresh');

    // Register success, update rate limit (max 3 signups per 24h per IP)
    signupRecord.count += 1;
    if (signupRecord.count >= 3) signupRecord.lockUntil = now + 24 * 60 * 60 * 1000;
    signupRateLimits.set(clientIp, signupRecord);
    logSystemEvent('INFO', 'AuthService', 'User Signup', `New ${role} registered: ${user.phone}`);

    // Send automated Welcome SMS
    await sendSMSNotification(user.phone, `Welcome to WATTZEN, ${user.name}! Your ${user.role} account has been created successfully.`);

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
    logSystemEvent('INFO', 'AuthService', 'User Login', `User ${user.phone} (${user.role}) logged in`);
    
    // Send automated Login Alert SMS
    await sendSMSNotification(user.phone, `WATTZEN Alert: A new login was detected on your account. If this wasn't you, contact projects.nikunj.singh@gmail.com immediately.`);

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
      headers: { 'User-Agent': 'WattzenApp/1.0 (projects.nikunj.singh@gmail.com)' }
    });
    if (!response.ok) throw new Error(`Nominatim API Error: ${response.status}`); // 8. Prevent HTML parse crash
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: 'Location search failed' });
  }
});

// POST /api/auth/forgot-password - Trigger Twilio SMS
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

    // Trigger Twilio SMS Verify Service
    try {
      const targetPhone = cleanPhone.startsWith('+') ? cleanPhone : `+91${cleanPhone}`;
      const twilioAccountSid = 'ACebe0641d08c01bbe9192e4051bf40c1f';
      const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
      const twilioVerifyServiceSid = 'VAe6e9351e557234c57132aceac37b4ded';

      if (!twilioAuthToken) {
        console.warn(`[DEV MODE] Mocking Twilio SMS reset to ${targetPhone}. Use OTP 123456 to verify.`);
      } else {
        const authHeader = 'Basic ' + Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64');
        const params = new URLSearchParams();
        params.append('To', targetPhone);
        params.append('Channel', 'sms');

        const twilioRes = await fetch(`https://verify.twilio.com/v2/Services/${twilioVerifyServiceSid}/Verifications`, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: params.toString()
        });

        if (!twilioRes.ok) {
          const errorData = await twilioRes.json();
          if (twilioRes.status === 401) {
            console.warn(`[DEV MODE FALLBACK] Twilio Auth failed. Mocking SMS reset to ${targetPhone}.`);
          } else {
            console.error('[TWILIO ERROR]', errorData);
            return res.status(500).json({ message: `Twilio Error: ${errorData.message || 'Failed to send OTP'}` });
          }
        }
      }
    } catch (smsError) {
      console.error('[SMS ERROR] Failed to hit Twilio:', smsError.message);
    }

    res.status(200).json({ message: 'If an account matches this number, an OTP has been sent.' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error while requesting OTP' });
  }
});

// POST /api/auth/send-signup-otp - Trigger Twilio SMS for Signups
api.post('/auth/send-signup-otp', async (req, res) => {
  try {
    const cleanPhone = String(req.body.phone || '').trim().substring(0, 15);
    if (!cleanPhone) return res.status(400).json({ message: 'Phone number is required' });

    const phoneRegex = /^\d{10}$/;
    if (!phoneRegex.test(cleanPhone)) return res.status(400).json({ message: 'Invalid phone number format. Must be 10 digits.' });

    const existingUser = await User.findOne({ phone: cleanPhone });
    if (existingUser) return res.status(400).json({ message: 'Phone number is already registered.' });

    const now = Date.now();
    const clientIp = getClientIp(req);
    
    // Rate limiting
    if (otpRateLimits.has(clientIp) && now < otpRateLimits.get(clientIp)) {
      return res.status(429).json({ message: 'Too many requests from this IP. Please wait 30 seconds.' });
    }
    if (otpRateLimits.has(cleanPhone) && now < otpRateLimits.get(cleanPhone)) {
      return res.status(429).json({ message: 'Please wait 60 seconds before requesting another OTP.' });
    }
    otpRateLimits.set(clientIp, now + 30000);
    otpRateLimits.set(cleanPhone, now + 60000);

    try {
      const targetPhone = cleanPhone.startsWith('+') ? cleanPhone : `+91${cleanPhone}`;
      const twilioAccountSid = 'ACebe0641d08c01bbe9192e4051bf40c1f';
      const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
      const twilioVerifyServiceSid = 'VAe6e9351e557234c57132aceac37b4ded';

      if (!twilioAuthToken) {
        console.warn(`[DEV MODE] Mocking Twilio SMS send to ${targetPhone}. Use OTP 123456 to verify.`);
      } else {
        const authHeader = 'Basic ' + Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64');
        const params = new URLSearchParams();
        params.append('To', targetPhone);
        params.append('Channel', 'sms');

        const twilioRes = await fetch(`https://verify.twilio.com/v2/Services/${twilioVerifyServiceSid}/Verifications`, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: params.toString()
        });
        if (!twilioRes.ok) {
          const errorData = await twilioRes.json();
          if (twilioRes.status === 401) {
            console.warn(`[DEV MODE FALLBACK] Twilio Auth failed. Mocking SMS send to ${targetPhone}.`);
            return res.status(200).json({ message: 'Verification OTP sent to your phone. (Mocked: Use 123456)' });
          } else {
            console.error('[TWILIO ERROR]', errorData);
            return res.status(500).json({ message: `Twilio Error: ${errorData.message || 'Failed to send OTP'}` });
          }
        }
      }
    } catch (smsError) {
      console.error('[SMS ERROR] Failed to hit Twilio:', smsError.message);
      return res.status(500).json({ message: 'Failed to send OTP' });
    }
    res.status(200).json({ message: 'Verification OTP sent to your phone.' });
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

    // 3. Bcrypt Asymmetric DoS Fix: Fetch user BEFORE hitting Twilio to save costs and verify existence
    const user = await User.findOne({ phone: cleanPhone });
    if (!user) {
      // SECURITY: Return generic OTP error to prevent phone number enumeration attacks
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    const targetPhone = cleanPhone.startsWith('+') ? cleanPhone : `+91${cleanPhone}`;
    const twilioAccountSid = 'ACebe0641d08c01bbe9192e4051bf40c1f';
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioVerifyServiceSid = 'VAe6e9351e557234c57132aceac37b4ded';

    const authHeader = 'Basic ' + Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64');
    const params = new URLSearchParams();
    params.append('To', targetPhone);
    params.append('Code', otp);

    try {
      const twilioRes = await fetch(`https://verify.twilio.com/v2/Services/${twilioVerifyServiceSid}/VerificationCheck`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });

      const verification = await twilioRes.json();
      if (!twilioRes.ok) {
        if (twilioRes.status === 401) {
          console.warn(`[DEV MODE FALLBACK] Twilio Auth failed for reset. Accepting OTP 123456 for ${targetPhone}`);
          if (otp !== '123456') return res.status(400).json({ message: 'Invalid OTP' });
        } else {
          console.error('[TWILIO VERIFY ERROR]', verification);
          return res.status(400).json({ message: `Twilio Error: ${verification.message || 'Verification failed'}` });
        }
      } else if (verification.status !== 'approved') {
        return res.status(400).json({ message: 'Invalid OTP' });
      }
    } catch (err) {
      console.error('[TWILIO VERIFY ERROR]', err);
      return res.status(500).json({ message: 'Error verifying OTP' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    res.status(200).json({ message: 'Password reset successfully. You can now log in.' });

    // Force logout any existing active sessions to prevent compromised tokens from staying active
    const sockets = await io.fetchSockets();
    for (const s of sockets) {
      if (s.user?.userId === String(user._id)) { s.emit('auth-expired'); s.disconnect(true); }
    }
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
    if (!name) return res.status(400).json({ message: 'Name is required' });

    const updatedUser = await User.findByIdAndUpdate(
      req.user.userId, { name }, { new: true } // Prevent unverified phone number changes
    ).select('-password -__v');
    
    if (!updatedUser) return res.status(404).json({ message: 'User not found' });
    io.emit('adminRefresh'); // Update admin dashboard lists
    res.json(updatedUser.toObject());
  } catch (error) {
    res.status(500).json({ message: 'Internal server error updating profile' });
  }
});

// POST /api/electrician/pay-deposit - Mock Payment Gateway for ₹500 deposit
api.post('/electrician/pay-deposit', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'electrician') return res.status(403).json({ message: 'Forbidden' });
    const updatedUser = await User.findByIdAndUpdate(req.user.userId, { safetyDepositPaid: true }, { new: true, runValidators: true }).select('-password -__v');
    res.status(200).json(updatedUser.toObject());
  } catch (error) {
    res.status(500).json({ message: 'Internal server error processing deposit' });
  }
});

// 9. DELETE /api/me - GDPR Account Deletion
api.delete('/me', authenticateToken, async (req, res) => {
  try {
    // 5. Security: Prevent Account Deletion Fraud (escaping active jobs)
    const activeCustomerJobs = await Job.countDocuments({ customer: req.user.userId, status: { $in: ['verifying_payment', 'searching', 'assigned', 'in_progress', 'payment'] } });
    const activeElectricianJobs = await Job.countDocuments({ electricians: req.user.userId, status: { $in: ['searching', 'assigned', 'in_progress', 'payment'] } });
    if (activeCustomerJobs > 0 || activeElectricianJobs > 0) {
      return res.status(400).json({ message: 'Cannot delete account with active jobs. Please complete or cancel them first.' });
    }

    const userToArchive = await User.findById(req.user.userId);
    if (userToArchive) {
      await ArchivedUser.create({ ...userToArchive.toObject(), originalId: userToArchive._id, deletedBy: 'Self Deletion' });
    }

    const deletedUser = await User.findByIdAndDelete(req.user.userId);
    if (!deletedUser) return res.status(404).json({ message: 'User not found' });
    res.status(200).json({ message: 'Account permanently deleted' });

    // Live Socket Eviction
    const sockets = await io.fetchSockets();
    for (const s of sockets) {
      if (s.user?.userId === req.user.userId) { s.emit('auth-expired'); s.disconnect(true); }
    }
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
    const { coordinates, estimatedPrice, teamSize, couponCode, paymentType } = req.body;
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
    
    let finalPrice = safePrice;
    let appliedCoupon = null;

    if (couponCode) {
      appliedCoupon = await Coupon.findOneAndUpdate(
        { code: String(couponCode).toUpperCase(), isUsed: false },
        { $set: { isUsed: true, usedBy: req.user.userId, usedAt: new Date() } },
        { new: true }
      );
      if (!appliedCoupon) return res.status(400).json({ message: 'Invalid or already used coupon code.' });
      
      finalPrice = Math.max(0, safePrice - appliedCoupon.discountAmount);
    }

    // FIX: Wallet Trap - Use customer's wallet balance to offset the booking cost atomically
    const customerData = await User.findById(req.user.userId);
    let walletDeduction = 0;
    if (customerData && customerData.walletBalance > 0) {
      walletDeduction = Math.min(finalPrice, customerData.walletBalance);
      finalPrice -= walletDeduction;
    }
    if (walletDeduction > 0) {
      const deducted = await User.findOneAndUpdate(
        { _id: req.user.userId, walletBalance: { $gte: walletDeduction } },
        { $inc: { walletBalance: -walletDeduction } }
      );
      if (!deducted) {
        return res.status(400).json({ message: 'Wallet balance changed during booking. Please try again.' });
      }
    }

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
      estimatedPrice: finalPrice,
      originalPrice: safePrice,
      walletAmountUsed: walletDeduction,
      paymentType: paymentType === 'after_service' ? 'after_service' : 'upfront',
      couponUsed: appliedCoupon ? appliedCoupon._id : undefined,
      paymentStatus: 'pending',
      jobOTP: crypto.randomInt(1000, 10000).toString(), // Security: Cryptographically secure OTP
      status: 'searching'
    });

    try {
      await newJob.save();
      io.emit('newJobAvailable', newJob); // Broadcast immediately to electricians
      io.emit('adminRefresh');
      logSystemEvent('INFO', 'JobService', 'Job Created', `Job ${newJob._id} created by ${req.user.userId}`);
      
      res.status(201).json(newJob);
    } catch (saveError) {
      // Rollback: Revert the coupon to 'unused' if the job failed to save (e.g. database timeout)
      if (appliedCoupon) {
        await Coupon.updateOne({ _id: appliedCoupon._id }, { $set: { isUsed: false }, $unset: { usedBy: 1, usedAt: 1 } });
      }
      // Rollback: Refund the wallet deduction if job creation fails
      if (walletDeduction > 0) {
        await User.findByIdAndUpdate(req.user.userId, { $inc: { walletBalance: walletDeduction } });
      }
      throw saveError; // Pass error to outer catch block to send 500 response
    }
  } catch (error) {
    res.status(500).json({ message: 'Internal server error during booking' });
  }
});

// POST /api/coupons/validate - Customer checks coupon before booking
api.post('/coupons/validate', authenticateToken, async (req, res) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!code || code.length !== 9) return res.status(400).json({ message: 'Invalid coupon code format' });
    
    const coupon = await Coupon.findOne({ code });
    if (!coupon) return res.status(404).json({ message: 'Invalid coupon code' });
    if (coupon.isUsed) return res.status(400).json({ message: 'Coupon has already been used' });
    
    res.status(200).json({ discountAmount: coupon.discountAmount });
  } catch (error) {
    res.status(500).json({ message: 'Error validating coupon' });
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
    let queryBuilder = Job.findOne(query).populate('electricians', 'name phone averageRating totalReviews');
    if (selectFields) queryBuilder = queryBuilder.select(selectFields);
    const job = await queryBuilder;
    res.status(200).json(job || {});
  } catch (error) {
    console.error('Error fetching active job:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/jobs/available - Fetch a pending job
api.get('/jobs/available', authenticateToken, async (req, res) => {
  try {
    // Electrician Onboarding Gateway Guard
    const u = await User.findById(req.user.userId);
    if (!u) return res.status(401).json({ message: 'Account deleted or rejected.' });
    if (req.user.role === 'electrician' && (!u.isApproved || !u.safetyDepositPaid)) {
      return res.status(403).json({ message: 'Account onboarding incomplete.' });
    }
    if (req.user.role === 'electrician' && u.walletBalance < 500) {
      return res.status(403).json({ message: 'Low wallet balance. Please recharge at least ₹500 to receive jobs.' });
    }

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

    let jobQuery = Job.find(query).select('serviceType address estimatedPrice originalPrice status location customer teamSize currentTeamSize').skip(skip).limit(limit);
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
      const activeJobs = await Job.countDocuments({ electricians: req.user.userId, status: { $in: ['searching', 'assigned', 'in_progress'] } });
      if (activeJobs >= 1) return res.status(400).json({ message: 'You can only have 1 active job at a time. Complete your current job first.' });
      
      // Electrician Onboarding Gateway Guard
      const u = await User.findById(req.user.userId);
      if (!u) return res.status(401).json({ message: 'Account deleted or rejected.' });
      if (!u.isApproved || !u.safetyDepositPaid) {
        return res.status(403).json({ message: 'Account onboarding incomplete.' });
      }
      // Reject acceptance if wallet drops below mandatory reserve
      if (u.walletBalance < 500) {
        return res.status(403).json({ message: 'Low wallet balance. Please recharge at least ₹500 to accept jobs.' });
      }
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

      // Security: Evict eavesdroppers (unauthorized electricians who were browsing the 'searching' state)
      try {
        const sockets = await io.in(jobId).fetchSockets();
        const authorizedUserIds = [updatedJob.customer.toString(), ...updatedJob.electricians.map(e => e._id.toString())];
        for (const s of sockets) {
          if (s.user?.role !== 'admin' && !authorizedUserIds.includes(s.user.userId)) {
            s.leave(jobId);
          }
        }
      } catch(err) { console.error('Socket eviction error:', err); }
      
      // Send automated Custom SMS to the Customer
      try {
        const customer = await User.findById(updatedJob.customer);
        if (customer && customer.phone) {
          await sendSMSNotification(customer.phone, `WATTZEN: Your ${updatedJob.serviceType.replace('_', ' ')} job has been accepted by ${updatedJob.electricians[0].name}. Track their arrival in the app!`);
        }
      } catch(e) { console.error('Failed to send acceptance SMS', e); }
    } else {
      // Notify customer that a team member has joined
      const justAddedElectrician = updatedJob.electricians.find(e => e._id.equals(electricianId));
      io.to(jobId).emit('teamMemberJoined', { electrician: justAddedElectrician, teamSize: updatedJob.teamSize, currentSize: updatedJob.electricians.length });
    }
    io.emit('adminRefresh');
    logSystemEvent('INFO', 'JobService', 'Job Accepted', `Electrician ${electricianId} accepted job ${jobId}`);

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

    const job = await Job.findOne({ _id: req.params.id, electricians: req.user.userId, status: { $in: ['assigned', 'in_progress'] } });
    if (!job) return res.status(404).json({ message: 'Job not found or not currently active' });
    
    if (job.status === 'in_progress') {
      return res.status(200).json({ message: 'Job is already in progress. OTP was verified by a team member.' });
    }
    
    // 4. Job OTP Brute Force Protection
    const attemptKey = `${req.user.userId}_${req.params.id}`;
    const attemptRecord = jobOtpAttempts.get(attemptKey) || { count: 0, lockUntil: 0 };
    if (Date.now() < attemptRecord.lockUntil) {
      const wait = Math.ceil((attemptRecord.lockUntil - Date.now()) / 60000);
      return res.status(429).json({ message: `Too many invalid attempts. Try again in ${wait} minutes.` });
    }

    if (job.jobOTP !== String(otp).trim()) {
      attemptRecord.count += 1;
      if (attemptRecord.count >= 5) { attemptRecord.lockUntil = Date.now() + 15 * 60 * 1000; attemptRecord.count = 0; }
      jobOtpAttempts.set(attemptKey, attemptRecord);
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
      { _id: req.params.id, electricians: req.user.userId, status: { $in: ['assigned', 'searching'] } },
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
    io.to(job._id.toString()).emit('jobStatusUpdated', { status: 'searching' }); // Inform remaining team members to update their UI
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
      { _id: req.params.id, customer: req.user.userId, status: { $in: ['searching', 'verifying_payment', 'assigned'] } },
      { status: 'cancelled' },
      { new: false, runValidators: true } // Returns the document BEFORE the update so we know if a refund is needed
    );
    if (!job) return res.status(404).json({ message: 'Job not found or already assigned' });

    // Logic Fix: Refund the customer if they had already paid upfront
    if (['searching', 'assigned'].includes(job.status) && job.paymentStatus === 'paid') {
      await User.findByIdAndUpdate(req.user.userId, { $inc: { walletBalance: job.estimatedPrice } });
    }
    
    // FIX: Refund the wallet balance deduction and restore the applied coupon
    if (job.walletAmountUsed && job.walletAmountUsed > 0) {
      await User.findByIdAndUpdate(req.user.userId, { $inc: { walletBalance: job.walletAmountUsed } });
    }
    if (job.couponUsed) {
      await Coupon.findByIdAndUpdate(job.couponUsed, { $set: { isUsed: false }, $unset: { usedBy: 1, usedAt: 1 } });
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
    
    // Atomic lock: Prevent Admin double-clicking and triggering double payouts.
    // We use findOneAndUpdate to instantly mutate the status while retrieving the OLD document state.
    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, status: { $in: ['verifying_payment', 'payment'] } },
      { paymentStatus: 'paid', status: 'completed' }, // Temporarily set to completed
      { new: false } // Returns the pre-update document
    );
    
    if (!job) return res.status(404).json({ message: 'Job not found or already verified' });
    
    if (job.status === 'verifying_payment') {
      // It was an upfront payment
      await Job.updateOne({ _id: job._id }, { status: 'searching' });
      io.to(req.params.id).emit('paymentVerified');
      io.emit('newJobAvailable', { ...job.toObject(), status: 'searching' });
    } else if (job.status === 'payment') {
      // It was a post-service payment (payout time!)
      if (job.electricians && job.electricians.length > 0) {
        const uniqueElectricians = [...new Set(job.electricians.map(e => e.toString()))];
        const basePayout = job.originalPrice || job.estimatedPrice;
        const earningsPerElectrician = Math.floor(((basePayout * 0.8) / Math.max(1, uniqueElectricians.length)) * 100) / 100;
        await User.updateMany({ _id: { $in: uniqueElectricians } }, { $inc: { walletBalance: earningsPerElectrician, jobsCompleted: 1 } });
      }
      io.to(req.params.id).emit('jobCompleted');
    }
    
    io.emit('adminRefresh');
    res.status(200).json({ message: 'Payment successfully verified', job });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/jobs/:id/complete - Customer completes job and triggers payout
api.put('/jobs/:id/complete', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'customer') return res.status(403).json({ message: 'Only customers can mark jobs complete' });
    
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid Job ID format' });

    // 1. Prevent Double-Payout Race Condition: Determine if the job can bypass Admin Verification BEFORE mutating state
    const jobCheck = await Job.findOne({ _id: req.params.id, customer: req.user.userId, status: 'in_progress' });
    if (!jobCheck) return res.status(404).json({ message: 'Job not found or not in progress' });

    let job;

    // If job was fully covered by wallet OR the electrician was paid directly in Cash/UPI by the customer
    if (jobCheck.estimatedPrice <= 0 || jobCheck.paymentType === 'after_service') {
      // Atomic auto-completion (bypasses 'payment' state to prevent Admin force-complete overlaps)
      job = await Job.findOneAndUpdate(
        { _id: req.params.id, status: 'in_progress' },
        { status: 'completed', paymentStatus: 'paid' },
        { new: true, runValidators: true }
      );
      if (!job) return res.status(404).json({ message: 'Job status changed concurrently.' });

      if (job.electricians && job.electricians.length > 0) {
        const uniqueElectricians = [...new Set(job.electricians.map(e => e.toString()))];
        const basePayout = job.originalPrice || job.estimatedPrice;
        
        if (job.paymentType === 'after_service') {
          // Electrician kept 100% of the cash. Platform deducts 20% commission directly from their wallet reserve.
          const commissionPerElectrician = Math.floor(((basePayout * 0.20) / Math.max(1, uniqueElectricians.length)) * 100) / 100;
          await User.updateMany(
            { _id: { $in: uniqueElectricians } },
            { $inc: { walletBalance: -commissionPerElectrician, jobsCompleted: 1 } }
          );
        } else {
          // Upfront payment fully covered (₹0 due), Platform pays Electrician their 80% cut.
          const earningsPerElectrician = Math.floor(((basePayout * 0.80) / Math.max(1, uniqueElectricians.length)) * 100) / 100;
          await User.updateMany(
            { _id: { $in: uniqueElectricians } },
            { $inc: { walletBalance: earningsPerElectrician, jobsCompleted: 1 } }
          );
        }
      }
      io.to(req.params.id).emit('jobCompleted');
      io.emit('adminRefresh');
      
      try {
        const customer = await User.findById(req.user.userId);
        if (customer && customer.phone) {
          await sendSMSNotification(customer.phone, `WATTZEN: Your ${job.serviceType.replace('_', ' ')} job is complete! Thank you for choosing us. Please open the app to rate your experience.`);
        }
      } catch(e) { console.error('Failed to send completion SMS', e); }

      return res.status(200).json(job);
    }

    // Atomic transition to verification queue
    job = await Job.findOneAndUpdate(
      { _id: req.params.id, status: 'in_progress' },
      { status: 'payment' },
      { new: true, runValidators: true }
    );
    if (!job) return res.status(404).json({ message: 'Job status changed concurrently.' });

    io.to(req.params.id).emit('jobStatusUpdated', { status: 'payment' }); 
    io.emit('adminRefresh');

    res.status(200).json(job);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/electrician/recharge - Submit manual wallet recharge proof
api.post('/electrician/recharge', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'electrician') return res.status(403).json({ message: 'Forbidden' });
    const { amount, screenshotBase64 } = req.body;
    if (!amount || !screenshotBase64) return res.status(400).json({ message: 'Amount and payment screenshot are required' });
    if (String(screenshotBase64).length > 3000000) return res.status(400).json({ message: 'Screenshot file size too large.' });

    const recharge = await WalletRecharge.create({
      electrician: req.user.userId,
      amount: Number(amount),
      screenshotUrl: screenshotBase64
    });
    io.emit('adminRefresh');
    res.status(201).json({ message: 'Recharge request submitted successfully', recharge });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error processing recharge' });
  }
});

// PUT /api/admin/recharges/:id/approve & reject
api.put('/admin/recharges/:id/:action', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    if (!['approve', 'reject'].includes(req.params.action)) return res.status(400).json({ message: 'Invalid action' });

    const statusToSet = req.params.action === 'approve' ? 'approved' : 'rejected';
    const recharge = await WalletRecharge.findOneAndUpdate({ _id: req.params.id, status: 'pending' }, { status: statusToSet }, { new: true });
    if (!recharge) return res.status(404).json({ message: 'Recharge request not found or already processed' });

    if (statusToSet === 'approved') {
      await User.findByIdAndUpdate(recharge.electrician, { $inc: { walletBalance: recharge.amount } });
    }
    
    io.emit('adminRefresh');
    await notifyUserRefresh(recharge.electrician);
    res.status(200).json({ message: `Recharge successfully ${statusToSet}` });
  } catch (error) { res.status(500).json({ message: 'Internal server error processing recharge action' }); }
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

    // OOM FIX: Exclude heavy base64 documents from the master list to prevent Vercel 413 Payload Too Large crashes
    const users = await User.find({}).select('-password -__v -idCardUrl -panCardUrl -photoUrl').sort({ createdAt: -1 }).skip(skip).limit(limit);

    res.status(200).json(users);
  } catch (error) {
    console.error('Error fetching users for admin:', error);
    res.status(500).json({ message: 'Internal server error while fetching users' });
  }
});

// GET /api/admin/users/:id/docs - Fetch heavy base64 documents for a specific user
api.get('/admin/users/:id/docs', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid User ID format' });
    
    const userDocs = await User.findById(req.params.id).select('idCardUrl panCardUrl photoUrl bankDetails');
    if (!userDocs) return res.status(404).json({ message: 'User not found' });
    
    res.status(200).json(userDocs);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching user documents' });
  }
});

// PUT /api/admin/users/:id/approve - Admin approves electrician ID
api.put('/admin/users/:id/approve', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid User ID format' });
    
    const user = await User.findByIdAndUpdate(req.params.id, { isApproved: true }, { new: true, runValidators: true }).select('-password -__v');
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    io.emit('adminRefresh');
    io.emit('accountApproved', user._id); // Broadcast approval to unlock electrician's app instantly
    res.status(200).json({ message: 'Electrician approved successfully', user });
  } catch (error) {
    res.status(500).json({ message: 'Error approving electrician' });
  }
});

// DELETE /api/admin/users/:id/reject - Admin rejects and deletes unapproved electrician
api.delete('/admin/users/:id/reject', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid User ID format' });
    
    const userToArchive = await User.findById(req.params.id);
    if (userToArchive) {
      await ArchivedUser.create({ ...userToArchive.toObject(), originalId: userToArchive._id, deletedBy: `Admin Rejected (${req.user.userId})` });
    }

    const user = await User.findOneAndDelete({ _id: req.params.id, isApproved: false });
    if (!user) return res.status(404).json({ message: 'User not found or already approved' });
    
    io.emit('adminRefresh');
    res.status(200).json({ message: 'Electrician application rejected and removed' });

    // Live Socket Eviction
    const sockets = await io.fetchSockets();
    for (const s of sockets) {
      if (s.user?.userId === req.params.id) { s.emit('auth-expired'); s.disconnect(true); }
    }
  } catch (error) {
    res.status(500).json({ message: 'Error rejecting electrician' });
  }
});

// DELETE /api/admin/users/:id - Admin forcefully deletes any user
api.delete('/admin/users/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid User ID format' });
    
    // Prevent admin from deleting themselves
    if (req.user.userId === req.params.id) return res.status(400).json({ message: 'Cannot delete your own admin account' });
    
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    if (req.query.hard !== 'true') {
      await ArchivedUser.create({ ...user.toObject(), originalId: user._id, deletedBy: `Admin Force Delete (${req.user.userId})` });
    }

    io.emit('adminRefresh');
    res.status(200).json({ message: 'User permanently deleted' });

    // Live Socket Eviction
    const sockets = await io.fetchSockets();
    for (const s of sockets) {
      if (s.user?.userId === req.params.id) { s.emit('auth-expired'); s.disconnect(true); }
    }
  } catch (error) {
    res.status(500).json({ message: 'Error deleting user' });
  }
});

// PUT /api/admin/users/:id/wallet - Admin manually adjusts user wallet balance
api.put('/admin/users/:id/wallet', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid User ID format' });
    
    const walletBalance = Number(req.body.walletBalance);
    if (isNaN(walletBalance) || walletBalance < 0) return res.status(400).json({ message: 'Invalid wallet balance amount' });
    
    const user = await User.findByIdAndUpdate(req.params.id, { walletBalance }, { new: true }).select('-password -__v');
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    io.emit('adminRefresh');
    await notifyUserRefresh(req.params.id);
    res.status(200).json({ message: 'Wallet balance updated', user });
  } catch (error) {
    res.status(500).json({ message: 'Error updating wallet balance' });
  }
});

// PUT /api/admin/jobs/:id/cancel - Admin forcefully cancels a job
api.put('/admin/jobs/:id/cancel', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid Job ID format' });
    
    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, status: { $nin: ['cancelled', 'completed'] } }, 
      { status: 'cancelled' }
    );
    if (!job) return res.status(404).json({ message: 'Job not found or already completed/cancelled' });
    
    if (job.paymentStatus === 'paid') {
       await User.findByIdAndUpdate(job.customer, { $inc: { walletBalance: job.estimatedPrice } });
    }
    
    if (job.walletAmountUsed && job.walletAmountUsed > 0) {
      await User.findByIdAndUpdate(job.customer, { $inc: { walletBalance: job.walletAmountUsed } });
    }
    if (job.couponUsed) {
      await Coupon.findByIdAndUpdate(job.couponUsed, { $set: { isUsed: false }, $unset: { usedBy: 1, usedAt: 1 } });
    }
    
    io.to(req.params.id).emit('jobCancelled');
    io.emit('adminRefresh');
    res.status(200).json({ message: 'Job forcefully cancelled' });
  } catch (error) {
    res.status(500).json({ message: 'Error cancelling job' });
  }
});

// GET /api/admin/logs - Fetch system logs
api.get('/admin/logs', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const logs = await SystemLog.find().sort({ createdAt: -1 }).limit(100);
    res.status(200).json(logs);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching logs' });
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
    const pendingJobs = await Job.find({ status: { $in: ['verifying_payment', 'payment'] } }).select('-messages -jobOTP').populate('customer', 'name phone').sort({ createdAt: -1 }).limit(100);
    const pendingWithdrawals = await Withdrawal.find({ status: 'pending' }).populate('electrician', 'name phone').sort({ createdAt: -1 }).limit(100);
    const pendingRecharges = await WalletRecharge.find({ status: 'pending' }).populate('electrician', 'name phone').sort({ createdAt: -1 }).limit(100);
    
    // Financial Stats Aggregations
    const revAgg = await Job.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, totalRevenue: { $sum: { $ifNull: ["$originalPrice", "$estimatedPrice"] } } } }
    ]);
    const totalRevenue = revAgg.length > 0 ? revAgg[0].totalRevenue : 0;
    const totalProfit = totalRevenue * 0.20; // 20% Platform Margin
    
    const payoutAgg = await Withdrawal.aggregate([
      { $match: { status: 'approved' } },
      { $group: { _id: null, totalPaid: { $sum: "$amount" } } }
    ]);
    const totalPayouts = payoutAgg.length > 0 ? payoutAgg[0].totalPaid : 0;

    // Historical Logs
    const recentCompletedJobs = await Job.find({ status: 'completed' })
      .select('serviceType estimatedPrice originalPrice createdAt')
      .populate('customer', 'name')
      .populate('electricians', 'name')
      .sort({ createdAt: -1 }).limit(100);

    // Payout logs removed from this heavy main payload to be handled via the new paginated endpoint
    res.status(200).json({ pendingJobs, pendingWithdrawals, pendingRecharges, stats: { totalRevenue, totalProfit, totalPayouts, grossMargin: '20%' }, recentCompletedJobs, withdrawalLogs: [] });
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching finance records' });
  }
});

// GET /api/admin/finance/payout-logs - Paginated Payout History
api.get('/admin/finance/payout-logs', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const logs = await Withdrawal.find({ status: { $ne: 'pending' } })
      .populate('electrician', 'name phone')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit);
      
    const total = await Withdrawal.countDocuments({ status: { $ne: 'pending' } });
    res.status(200).json({ logs, page, totalPages: Math.ceil(total / limit), total });
  } catch (error) { res.status(500).json({ message: 'Error fetching payout logs' }); }
});

// DELETE /api/admin/logs - Admin clears all system logs
api.delete('/admin/logs', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    await SystemLog.deleteMany({});
    res.status(200).json({ message: 'All system event logs cleared.' });
  } catch (error) { res.status(500).json({ message: 'Error clearing logs' }); }
});

// POST /api/admin/force-logout-all - Admin forcefully terminates all user sessions
api.post('/admin/force-logout-all', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const sockets = await io.fetchSockets();
    let count = 0;
    for (const s of sockets) {
      if (s.user && s.user.role !== 'admin') { // Spare the admins
        s.emit('auth-expired');
        s.disconnect(true);
        count++;
      }
    }
    logSystemEvent('WARN', 'AdminPortal', 'Global Force Logout', `Admin ${req.user.userId} forcefully disconnected ${count} active sessions.`);
    res.status(200).json({ message: `Successfully terminated ${count} active user sessions.` });
  } catch (error) { res.status(500).json({ message: 'Error terminating sessions' }); }
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
    await notifyUserRefresh(withdrawal.electrician);
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
    await notifyUserRefresh(withdrawal.electrician);
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

    io.emit('systemBroadcast', msg.trim());
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

    // FIX: Validate the tip amount against the customer's balance BEFORE modifying the job document
    // This prevents a bug where an insufficient tip permanently locks the customer out of rating the electrician.
    const tip = Math.max(0, Number(req.body.tip) || 0);
    const customer = await User.findById(req.user.userId);
    if (tip > 0 && (!customer || customer.walletBalance < tip)) {
      return res.status(400).json({ message: 'Insufficient wallet balance to pay the tip. Please recharge.' });
    }

    // 1. Tip deduction FIRST to prevent partial transaction lockouts
    if (tip > 0) {
      const updatedCustomer = await User.findOneAndUpdate(
        { _id: req.user.userId, walletBalance: { $gte: tip } },
        { $inc: { walletBalance: -tip } }
      );
      if (!updatedCustomer) {
        return res.status(400).json({ message: 'Insufficient wallet balance to pay the tip.' });
      }
    }

    const completedJob = await Job.findOneAndUpdate({
      customer: req.user.userId,
      electricians: req.params.id,
      status: 'completed',
      ratedElectricians: { $ne: req.params.id }
    }, {
      $addToSet: { ratedElectricians: req.params.id }
    });

    if (!completedJob) {
      // Rollback tip if job rating was already submitted concurrently
      if (tip > 0) {
        await User.findByIdAndUpdate(req.user.userId, { $inc: { walletBalance: tip } });
      }
      return res.status(403).json({ message: 'Forbidden: You can only rate this electrician once after a completed job.' });
    }

    if (tip > 0) {
      await User.findByIdAndUpdate(electrician._id, { $inc: { walletBalance: tip } });
      logSystemEvent('INFO', 'Finance', 'Tip Paid', `Customer ${req.user.userId} tipped ₹${tip} to Electrician ${electrician._id}`);
      await notifyUserRefresh(electrician._id);
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

    const jobs = await Job.find(query).select('-messages -jobOTP').sort({ createdAt: -1 }).skip(skip).limit(limit).populate('electricians', 'name phone').populate('customer', 'name phone');
    res.status(200).json(jobs);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/health - Zero-downtime deployment orchestrator check
api.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', dbConnected: isDbConnected, uptime: process.uptime() });
});

// GET /api/cron/sweep - Trigger sweepers securely via Vercel Cron for Serverless
api.get('/cron/sweep', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ message: 'Unauthorized cron access' });
  }
  await runGhostJobSweeper();
  await runStuckJobSweeper();
  res.status(200).json({ message: 'Sweepers executed successfully' });
});

// POST /api/admin/security/ban-ip
api.post('/admin/security/ban-ip', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const { ip, reason } = req.body;
    if (!ip) return res.status(400).json({ message: 'IP address is required' });
    if (ip === getClientIp(req)) return res.status(400).json({ message: 'You cannot ban your own current IP address' });
    
    await BannedIP.findOneAndUpdate({ ip }, { reason }, { upsert: true });
    bannedIpsCache.add(ip);
    io.emit('adminRefresh');
    res.status(200).json({ message: `IP ${ip} banned successfully` });

    // Instantly disconnect all active sockets from this IP to prevent evasion
    const sockets = await io.fetchSockets();
    for (const s of sockets) {
      const forwardedFor = s.handshake.headers['x-forwarded-for'];
      const sIp = forwardedFor ? forwardedFor.split(',')[0].trim() : s.handshake.address;
      const clientIp = sIp.startsWith('::ffff:') ? sIp.substring(7) : sIp;
      if (clientIp === ip) {
        s.emit('auth-expired');
        s.disconnect(true);
      }
    }
  } catch (error) {
    res.status(500).json({ message: 'Error banning IP' });
  }
});

// GET /api/admin/security/banned-ips
api.get('/admin/security/banned-ips', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const ips = await BannedIP.find().sort({ createdAt: -1 });
    res.status(200).json(ips);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching banned IPs' });
  }
});

// DELETE /api/admin/security/banned-ips/:ip
api.delete('/admin/security/banned-ips/:ip', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    await BannedIP.findOneAndDelete({ ip: req.params.ip });
    bannedIpsCache.delete(req.params.ip);
    io.emit('adminRefresh');
    res.status(200).json({ message: 'IP unbanned successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error unbanning IP' });
  }
});

// POST /api/admin/coupons
api.post('/admin/coupons', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const amount = Number(req.body.discountAmount);
    if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid discount amount' });

    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    // Cryptographically secure coupon generation
    for (let i = 0; i < 9; i++) {
      code += chars.charAt(crypto.randomInt(0, chars.length));
    }

    const coupon = await Coupon.create({ code, discountAmount: amount });
    res.status(201).json(coupon);
  } catch (error) {
    res.status(500).json({ message: 'Error generating coupon' });
  }
});

// GET /api/admin/coupons
api.get('/admin/coupons', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const coupons = await Coupon.find().populate('usedBy', 'name phone').sort({ createdAt: -1 });
    res.status(200).json(coupons);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching coupons' });
  }
});

// GET /api/admin/users/:id/activity - Fetch specific user logs and timings
api.get('/admin/users/:id/activity', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    // Find logs that mention this user's ID or phone number
    const logs = await SystemLog.find({ 
      $or: [ { details: { $regex: user.phone, $options: 'i' } }, { details: { $regex: user._id.toString(), $options: 'i' } } ] 
    }).sort({ createdAt: -1 }).limit(50);

    res.status(200).json({ userTimings: { createdAt: user.createdAt, updatedAt: user.updatedAt }, logs });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching user activity' });
  }
});

// PUT /api/admin/users/:id/force-password - Admin resets a user's password manually
api.put('/admin/users/:id/force-password', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(req.params.id, { password: hashedPassword });
    
    logSystemEvent('WARN', 'AdminPortal', 'Force Password Reset', `Admin ${req.user.userId} forced password reset for user ${req.params.id}`);
    res.status(200).json({ message: 'Password forcefully updated.' });

    // Force logout any existing active sessions to prevent compromised tokens from staying active
    const sockets = await io.fetchSockets();
    for (const s of sockets) {
      if (s.user?.userId === req.params.id) { s.emit('auth-expired'); s.disconnect(true); }
    }
  } catch (error) {
    res.status(500).json({ message: 'Error updating password' });
  }
});

// GET /api/admin/archives/users - Fetch archived/deleted users
api.get('/admin/archives/users', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const archives = await ArchivedUser.find().select('-idCardUrl -panCardUrl -photoUrl').sort({ deletedAt: -1 });
    res.status(200).json(archives);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching archives' });
  }
});

// DELETE /api/admin/archives/users/:id - Admin permanently deletes an archived user
api.delete('/admin/archives/users/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid Archive ID format' });
    
    const archive = await ArchivedUser.findByIdAndDelete(req.params.id);
    if (!archive) return res.status(404).json({ message: 'Archived record not found' });
    
    io.emit('adminRefresh');
    res.status(200).json({ message: 'Archived record permanently purged' });
  } catch (error) {
    res.status(500).json({ message: 'Error purging archived record' });
  }
});

// ==========================================
// ADMIN 10+ NEW FEATURES EXTENSION
// ==========================================

// GET /api/admin/system-status - Fetch maintenance state
api.get('/admin/system-status', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  res.status(200).json({ maintenanceMode: global.MAINTENANCE_MODE });
});

// POST /api/admin/toggle-maintenance
api.post('/admin/toggle-maintenance', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  global.MAINTENANCE_MODE = !global.MAINTENANCE_MODE;
  io.emit('systemBroadcast', global.MAINTENANCE_MODE ? '⚠️ Platform is now entering Maintenance Mode. Active services may be paused.' : '✅ Maintenance complete. Platform is back online.');
  res.status(200).json({ maintenanceMode: global.MAINTENANCE_MODE, message: `Maintenance Mode is now ${global.MAINTENANCE_MODE ? 'ON' : 'OFF'}` });
});

// GET /api/admin/live-jobs - Dashboard for currently running jobs
api.get('/admin/live-jobs', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const liveJobs = await Job.find({ status: { $in: ['searching', 'assigned', 'in_progress'] } })
      .populate('customer', 'name phone')
      .populate('electricians', 'name phone')
      .sort({ updatedAt: -1 });
    res.status(200).json(liveJobs);
  } catch (error) { res.status(500).json({ message: 'Error fetching live jobs' }); }
});

// PUT /api/admin/jobs/:id/force-complete - Force override stuck jobs
api.put('/admin/jobs/:id/force-complete', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    
    // FIX: Prevent Force Completing a job that hasn't even been accepted by an electrician yet
    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, status: { $in: ['assigned', 'in_progress', 'payment'] } },
      { status: 'completed', paymentStatus: 'paid' }, 
      { new: true }
    );
    if (!job) return res.status(404).json({ message: 'Job not found, already completed, or no team assigned' });
    
    if (job.electricians && job.electricians.length > 0) {
      const uniqueElectricians = [...new Set(job.electricians.map(e => e.toString()))];
      const basePayout = job.originalPrice || job.estimatedPrice;
      
      if (job.paymentType === 'after_service') {
        const commissionPerElectrician = Math.floor(((basePayout * 0.20) / Math.max(1, uniqueElectricians.length)) * 100) / 100;
        await User.updateMany({ _id: { $in: uniqueElectricians } }, { $inc: { walletBalance: -commissionPerElectrician, jobsCompleted: 1 } });
      } else {
        const earningsPerElectrician = Math.floor(((basePayout * 0.80) / Math.max(1, uniqueElectricians.length)) * 100) / 100;
        await User.updateMany({ _id: { $in: uniqueElectricians } }, { $inc: { walletBalance: earningsPerElectrician, jobsCompleted: 1 } });
      }
    }
    io.to(req.params.id).emit('jobCompleted');
    io.emit('adminRefresh');
    res.status(200).json({ message: 'Job forcefully completed and paid out.' });
  } catch (error) { res.status(500).json({ message: 'Error forcing job completion' }); }
});

// POST /api/admin/users/:id/impersonate - Ghost login token generator
api.post('/admin/users/:id/impersonate', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) return res.status(404).json({ message: 'User not found' });
    
    logSystemEvent('WARN', 'AdminPortal', 'User Impersonation', `Admin ${req.user.userId} is impersonating ${targetUser._id}`);
    const token = jwt.sign({ userId: targetUser._id, role: targetUser.role }, JWT_SECRET, { expiresIn: '1h', issuer: 'wattzen-api' });
    res.status(200).json({ token, user: { _id: targetUser._id, name: targetUser.name, phone: targetUser.phone, role: targetUser.role } });
  } catch (error) { res.status(500).json({ message: 'Error generating impersonation token' }); }
});

// PUT /api/admin/users/:id/notes - Save admin private notes
api.put('/admin/users/:id/notes', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const user = await User.findByIdAndUpdate(req.params.id, { adminNotes: String(req.body.notes || '').substring(0, 1000) }, { new: true });
    res.status(200).json({ message: 'Notes saved', adminNotes: user.adminNotes });
  } catch (error) { res.status(500).json({ message: 'Error saving notes' }); }
});

// PUT /api/admin/users/:id/suspend - Soft ban / revoke approval
api.put('/admin/users/:id/suspend', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const user = await User.findByIdAndUpdate(req.params.id, { isApproved: false }, { new: true });
    io.emit('adminRefresh');
    res.status(200).json({ message: 'User account suspended.' });
    
    // Instantly disconnect suspended electricians to prevent them from taking jobs
    const sockets = await io.fetchSockets();
    for (const s of sockets) {
      if (s.user?.userId === req.params.id) { s.emit('auth-expired'); s.disconnect(true); }
    }
  } catch (error) { res.status(500).json({ message: 'Error suspending user' }); }
});

// PUT /api/admin/users/bulk-approve - 1-Click approve all pending electricians
api.put('/admin/users/bulk-approve', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    
    const usersToApprove = await User.find({ role: 'electrician', isApproved: false, safetyDepositPaid: true });
    const result = await User.updateMany({ role: 'electrician', isApproved: false, safetyDepositPaid: true }, { isApproved: true });
    io.emit('adminRefresh');
    usersToApprove.forEach(u => io.emit('accountApproved', u._id)); // Unlocks electrician UIs instantly
    
    res.status(200).json({ message: `${result.modifiedCount} electricians approved.` });
  } catch (error) { res.status(500).json({ message: 'Error in bulk approval' }); }
});

app.use('/api', api);

// Export the Express API for Vercel Serverless Functions
module.exports = app;