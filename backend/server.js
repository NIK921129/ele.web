const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config(); // Load environment variables from .env file
const jwt = require('jsonwebtoken');
const http = require('http');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
app.set('trust proxy', 1); // Enable trusting proxy headers for correct IP detection
const server = http.createServer(app);

const corsOptions = {
  // Explicitly list allowed origins to prevent Render proxy CORS dropping
  origin: [
    'https://wattzen.vercel.app', 
    process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, '') : null
  ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
};

// Configure Socket.io and CORS
const io = new Server(server, { cors: corsOptions });
app.use(cors(corsOptions));
app.use(express.json());

// Global Error Handler for malformed JSON to prevent the server from returning HTML stack traces
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ message: 'Invalid JSON payload format' });
  }
  next();
});

// Add a request logger to verify if the frontend is reaching the backend
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Origin: ${req.headers.origin}`);
  next();
});

let criticalSystemError = null;
let isDbConnected = false;

const PORT = process.env.PORT || 5000;
// Fix: Allow seamless local development by falling back to local credentials unless explicitly in production
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_fallback_key';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/wattzen';

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

const connectDB = async () => {
  if (criticalSystemError) return;
  // Serverless DB caching: Prevent connection pool exhaustion by reusing active connections
  if (mongoose.connection.readyState >= 1) return;
  try {
    await mongoose.connect(MONGO_URI);
    isDbConnected = true;
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('Could not connect to MongoDB.', err);
    criticalSystemError = 'Database connection failed. Check your MongoDB Atlas Network Access.';
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
  totalReviews: { type: Number, default: 0 },
  averageRating: { type: Number, default: 0 },
  walletBalance: { type: Number, default: 0 },
  jobsCompleted: { type: Number, default: 0 }
}, { timestamps: true });

const jobSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  electricians: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  serviceType: { type: String, required: true },
  address: { type: String, required: true },
  location: {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: { type: [Number], required: true }
  },
  estimatedPrice: { type: Number, default: 299 },
  currentTeamSize: { type: Number, default: 0 }, // New field for atomic team size tracking
  teamSize: { type: Number, default: 1 },
  jobOTP: { type: String },
  paymentStatus: { type: String, enum: ['pending', 'verifying', 'paid'], default: 'pending' },
  status: { type: String, enum: ['verifying_payment', 'searching', 'assigned', 'in_progress', 'payment', 'completed', 'cancelled'], default: 'verifying_payment' },
  isRated: { type: Boolean, default: false }, // Kept for backwards compatibility
  ratedElectricians: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

jobSchema.index({ location: '2dsphere' });
jobSchema.index({ status: 1 }); // Optimize high-frequency status queries made by electricians

const withdrawalSchema = new mongoose.Schema({
  electrician: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'approved'], default: 'pending' }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Job = mongoose.model('Job', jobSchema);
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

// ==========================================
// 2. SOCKET.IO SETUP
// ==========================================
io.on('connection', (socket) => {
  // Security: Validate payload types to prevent socket-based crashes or prototype pollution
  socket.on('joinJobRoom', (jobId) => {
    if (typeof jobId === 'string' && jobId.length > 0) socket.join(jobId);
  });
  socket.on('updateLocation', (data) => {
    if (data && typeof data.jobId === 'string') io.to(data.jobId).emit('electricianLocationChanged', data);
  });
  socket.on('sendMessage', (data) => {
    if (data && typeof data.jobId === 'string') socket.to(data.jobId).emit('receiveMessage', data);
  });
  socket.on('typing', (data) => {
    if (data && typeof data.jobId === 'string') socket.to(data.jobId).emit('userTyping', data);
  });
  socket.on('stopTyping', (data) => {
    if (data && typeof data.jobId === 'string') socket.to(data.jobId).emit('userStopTyping', data);
  });
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

// Security/Performance: Periodically clean up the admin login attempts map to prevent memory leaks (OOM)
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of adminLoginAttempts.entries()) {
    if (now > record.lockUntil) {
      adminLoginAttempts.delete(ip);
    }
  }
}, 60 * 60 * 1000); // Clean up every hour

// POST /api/admin/secret-login - Hidden backdoor login
api.post('/admin/secret-login', async (req, res) => {
  try {
    // FIX: Better IP detection to prevent 'undefined' from sharing a single rate-limit pool behind proxies
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || req.ip || 'unknown_ip';
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

    if (req.body.password === ADMIN_PIN) {
      adminLoginAttempts.delete(clientIp); // Clear attempts on success
      console.log(`[AUDIT] Successful Admin Login from IP: ${clientIp} at ${new Date().toISOString()}`);
      let admin = await User.findOne({ role: 'admin' });
      if (!admin) {
        // Use a non-numeric string to guarantee no collision with regular user phone numbers
        admin = await User.create({ name: 'System Admin', phone: 'ADMIN_MASTER', password: await bcrypt.hash(ADMIN_PIN, 10), role: 'admin' });
      }
      const token = jwt.sign({ userId: admin._id, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
      
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
    let { name, phone, password, role } = req.body;
    if (!name || !phone || !password || !role) return res.status(400).json({ message: 'All fields are required' });

    // Trim inputs to prevent accidental trailing spaces from mobile keyboards
    name = name.trim();
    phone = phone.trim();

    // Security: Prevent unauthorized creation of admin accounts
    if (role === 'admin') {
      return res.status(403).json({ message: 'Unauthorized: Admin role cannot be self-assigned' });
    }
    if (!['customer', 'electrician'].includes(role)) return res.status(400).json({ message: 'Invalid role selection' });

    // Basic Input Validation
    const phoneRegex = /^\d{10}$/;
    if (!phoneRegex.test(phone)) return res.status(400).json({ message: 'Invalid phone number format. Must be 10 digits.' });
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters.' });

    let existingUser = await User.findOne({ phone });
    if (existingUser) return res.status(400).json({ message: 'Phone number already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, phone, password: hashedPassword, role });
    await user.save();
    io.emit('adminRefresh');

    const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
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
    let { phone, password, role } = req.body;
    if (!phone || !password || !role) return res.status(400).json({ message: 'Phone, password, and role are required' });

    phone = phone.trim();

    const user = await User.findOne({ phone, role });
    if (!user) return res.status(400).json({ message: 'Invalid credentials or wrong role' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { _id: user._id, name: user.name, phone: user.phone, role: user.role } });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error during authentication' });
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
    let { name, phone } = req.body;
    if (!name || !phone) return res.status(400).json({ message: 'Name and phone are required' });
    name = name.trim();
    phone = phone.trim();
    
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

// POST /api/jobs - Create a new booking
api.post('/jobs', authenticateToken, async (req, res) => {
  try {
    const { serviceType, address, coordinates, estimatedPrice, teamSize } = req.body;
    if (!serviceType || !address) return res.status(400).json({ message: 'Service type and address required' });

    // Security: Prevent malicious injection of negative prices or absurd team sizes
    const safePrice = Math.max(299, Number(estimatedPrice) || 299);
    const safeTeamSize = Math.max(1, Math.min(10, Number(teamSize) || 1));

    // Security: Strict coordinate validation to prevent MongoDB 2dsphere index crashes
    if (!Array.isArray(coordinates) || coordinates.length !== 2 || 
        typeof coordinates[0] !== 'number' || typeof coordinates[1] !== 'number' ||
        coordinates[0] < -180 || coordinates[0] > 180 || 
        coordinates[1] < -90 || coordinates[1] > 90) {
      return res.status(400).json({ message: 'Invalid GPS coordinates provided.' });
    }

    const newJob = new Job({
      customer: req.user.userId,
      serviceType,
      address,
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

// GET /api/jobs/available - Fetch a pending job
api.get('/jobs/available', authenticateToken, async (req, res) => {
  try {
    const { latitude, longitude, maxDistance = 10 } = req.query;
    // Ensure we don't return team jobs that this electrician has already joined
    let query = { status: 'searching', electricians: { $ne: req.user.userId } };

    if (latitude && longitude) {
      const lat = parseFloat(latitude), lng = parseFloat(longitude), dist = parseFloat(maxDistance) * 1000;
      if (isNaN(lat) || isNaN(lng) || isNaN(dist)) return res.status(400).json({ message: 'Invalid params' });

      query.location = { $near: { $geometry: { type: "Point", coordinates: [lng, lat] }, $maxDistance: dist } };
    }

    let jobQuery = Job.findOne(query).select('serviceType address estimatedPrice status location customer teamSize currentTeamSize');
    if (!latitude || !longitude) {
      jobQuery = jobQuery.sort({ createdAt: -1 });
    }

    const job = await jobQuery;
    res.status(200).json(job);
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

    const jobId = req.params.id;
    const electricianId = req.user.userId;

    // Atomically check limits, add the electrician to the team, and increment currentTeamSize
    // This query ensures we ONLY update if the team isn't full and the user isn't already in it.
    const updatedJob = await Job.findOneAndUpdate(
      { 
        _id: jobId, 
        status: 'searching', 
        customer: { $ne: electricianId }, // Security: Prevent self-assignment
        electricians: { $ne: electricianId }, // Security: Prevent duplicate joining/double-counting
        $expr: { $lt: ["$currentTeamSize", "$teamSize"] }
      },
      {
        $addToSet: { electricians: electricianId },
        $inc: { currentTeamSize: 1 }
      },
      { new: true }
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

    res.status(200).json(updatedJob);
  } catch (error) {
    console.error(`Error accepting job ${req.params.id} by electrician ${req.user?.userId}:`, error.stack);
    res.status(500).json({ message: 'Internal server error while accepting job' });
  }
});

// PUT /api/jobs/:id/cancel - Cancel a job
api.put('/jobs/:id/cancel', authenticateToken, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid Job ID format' });

    const job = await Job.findOne({ _id: req.params.id, customer: req.user.userId, status: { $in: ['searching', 'verifying_payment'] } });
    if (!job) return res.status(404).json({ message: 'Job not found or already assigned' });

    // Logic Fix: Refund the customer if they had already paid upfront
    if (job.status === 'searching' && job.paymentStatus === 'paid') {
      await User.findByIdAndUpdate(req.user.userId, { $inc: { walletBalance: job.estimatedPrice } });
    }

    job.status = 'cancelled';
    await job.save();

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
      { new: true }
    );
    if (!job) return res.status(404).json({ message: 'Job not found' });
    
    io.to(req.params.id).emit('paymentVerified');
    io.emit('newJobAvailable', job); // Now alert electricians!
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
      { _id: req.params.id, customer: req.user.userId, status: { $in: ['assigned', 'in_progress', 'payment'] } },
      { status: 'completed' },
      { new: true }
    );
    
    if (!job) return res.status(404).json({ message: 'Job not found' });

    // Payout: 80% to electricians (20% platform cut). Round to 2 decimal places.
    const earningsPerElectrician = Math.round(((job.estimatedPrice * 0.8) / Math.max(1, job.electricians.length)) * 100) / 100;
    
    // Performance: Replace sequential loop with bulk updateMany operation
    if (job.electricians.length > 0) {
      await User.updateMany(
        { _id: { $in: job.electricians } },
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

    const users = await User.find({}).select('-password -__v').sort({ createdAt: -1 });

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
      .sort({ updatedAt: -1 });

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
    const pendingJobs = await Job.find({ status: 'verifying_payment' }).populate('customer', 'name phone').sort({ createdAt: -1 });
    const pendingWithdrawals = await Withdrawal.find({ status: 'pending' }).populate('electrician', 'name phone').sort({ createdAt: -1 });
    res.status(200).json({ pendingJobs, pendingWithdrawals });
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching finance records' });
  }
});

// POST /api/withdrawals - Request withdrawal
api.post('/withdrawals', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'electrician') return res.status(403).json({ message: 'Forbidden' });
    
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
      { new: true }
    );

    if (!updatedUser) {
      return res.status(400).json({ message: 'Transaction failed due to a concurrent balance change. Please try again.' });
    }

    const withdrawal = await Withdrawal.create({ electrician: user._id, amount: amountToWithdraw });
    io.emit('adminRefresh');
    
    res.status(201).json({ message: 'Withdrawal requested', withdrawal });
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
      { new: true }
    );
    if (!withdrawal) return res.status(404).json({ message: 'Request not found' });
    io.emit('adminRefresh');
    res.status(200).json({ message: 'Withdrawal approved', withdrawal });
  } catch (error) {
    res.status(500).json({ message: 'Error approving withdrawal' });
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
    // Parse rating to a strict number to prevent MongoDB $multiply aggregation type errors
    const numericRating = Number(req.body.rating);
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

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      [{
        $set: {
          totalReviews: { $add: [{ $ifNull: ["$totalReviews", 0] }, 1] },
          averageRating: {
            $round: [
              { $divide: [
                    { $add: [{ $multiply: [{ $ifNull: ["$averageRating", 0] }, { $ifNull: ["$totalReviews", 0] }] }, numericRating] },
                { $add: [{ $ifNull: ["$totalReviews", 0] }, 1] }
              ]},
              1
            ]
          }
        }
      }],
      { new: true }
    );
    io.emit('adminRefresh');
    res.status(200).json({ message: 'Rating submitted', rating: updatedUser.averageRating });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/jobs/history - Fetch user job history
api.get('/jobs/history', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'customer') query.customer = req.user.userId;
    else if (req.user.role === 'electrician') query.electricians = req.user.userId;
    else return res.status(403).json({ message: 'Forbidden' });

    // Performance: Add pagination boundaries to prevent massive payload loading
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const skip = (page - 1) * limit;

    const jobs = await Job.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('electricians', 'name phone').populate('customer', 'name phone');
    res.status(200).json(jobs);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error while fetching history' });
  }
});

app.use('/api', api);

// Export the Express API for Vercel Serverless Functions
module.exports = app;