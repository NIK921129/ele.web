const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config(); // Load environment variables from .env file
const jwt = require('jsonwebtoken');
const http = require('http');
const bcrypt = require('bcrypt');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Remove trailing slash if it exists to prevent strict CORS mismatches
const FRONTEND_URL = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, '') : 'https://wattzen.vercel.app';
const corsOptions = {
  origin: FRONTEND_URL || true, // Use env var if present, otherwise reflect request origin
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
};

// Configure Socket.io and CORS
const io = new Server(server, { cors: corsOptions });
app.use(cors(corsOptions));
app.use(express.json());

// Add a request logger to verify if the frontend is reaching the backend
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Origin: ${req.headers.origin}`);
  next();
});

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_fallback_key';
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/wattzen';

// ==========================================
// 1. MONGODB SCHEMAS & MODELS
// ==========================================
mongoose.connect(MONGO_URI).then(() => {
  console.log('Connected to MongoDB');
  // Start the server ONLY after the DB connection is successful
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Could not connect to MongoDB. Server not started.', err);
});

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['customer', 'electrician', 'admin'], required: true },
  totalReviews: { type: Number, default: 0 },
  averageRating: { type: Number, default: 0 },
  walletBalance: { type: Number, default: 0 }
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
  status: { type: String, enum: ['verifying_payment', 'searching', 'assigned', 'in_progress', 'payment', 'completed', 'cancelled'], default: 'verifying_payment' }
}, { timestamps: true });

jobSchema.index({ location: '2dsphere' });

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
  socket.on('joinJobRoom', (jobId) => socket.join(jobId));
  socket.on('updateLocation', (data) => io.to(data.jobId).emit('electricianLocationChanged', data));
  socket.on('sendMessage', (data) => socket.to(data.jobId).emit('receiveMessage', data));
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

// POST /api/admin/secret-login - Hidden backdoor login
api.post('/admin/secret-login', async (req, res) => {
  if (req.body.password === '79827') {
    let admin = await User.findOne({ role: 'admin' });
    if (!admin) {
      admin = await User.create({ name: 'System Admin', phone: '0000000000', password: await bcrypt.hash('79827', 10), role: 'admin' });
    }
    const token = jwt.sign({ userId: admin._id, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token, user: admin });
  }
  res.status(403).json({ message: 'Invalid Admin PIN' });
});

// POST /api/signup
api.post('/signup', async (req, res) => {
  try {
    const { name, phone, password, role } = req.body;
    if (!name || !phone || !password || !role) return res.status(400).json({ message: 'All fields are required' });

    // Basic Input Validation
    const phoneRegex = /^\d{10}$/;
    if (!phoneRegex.test(phone)) return res.status(400).json({ message: 'Invalid phone number format. Must be 10 digits.' });
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters.' });

    let existingUser = await User.findOne({ phone });
    if (existingUser) return res.status(400).json({ message: 'Phone number already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, phone, password: hashedPassword, role });
    await user.save();

    const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { _id: user._id, name: user.name, phone: user.phone, role: user.role } });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error during signup' });
  }
});

// POST /api/login
api.post('/login', async (req, res) => {
  try {
    const { phone, password, role } = req.body;
    if (!phone || !password || !role) return res.status(400).json({ message: 'Phone, password, and role are required' });

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
    const user = await User.findById(req.user.userId).select('-__v'); // Exclude version key
    if (!user) {
      // This case can happen if the user was deleted but the token is still valid.
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user.toObject());
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/jobs - Create a new booking
api.post('/jobs', authenticateToken, async (req, res) => {
  try {
    const { serviceType, address, coordinates, estimatedPrice, teamSize } = req.body;
    if (!serviceType || !address) return res.status(400).json({ message: 'Service type and address required' });

    const newJob = new Job({
      customer: req.user.userId,
      serviceType,
      address,
      teamSize: teamSize || 1,
      location: { type: 'Point', coordinates: coordinates || [0, 0] },
      estimatedPrice: estimatedPrice || 299,
      paymentStatus: 'verifying',
      jobOTP: Math.floor(1000 + Math.random() * 9000).toString(),
      status: 'verifying_payment'
    });

    await newJob.save();
    
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

    const jobId = req.params.id;
    const electricianId = req.user.userId;

    // Atomically check limits, add the electrician to the team, and increment currentTeamSize
    const updatedJob = await Job.findOneAndUpdate(
      { _id: jobId, status: 'searching', $expr: { $lt: ["$currentTeamSize", "$teamSize"] } },
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
      updatedJob.status = 'assigned';
      await updatedJob.save();
      // Notify everyone in the room (customer and all electricians) that the team is full
      io.to(jobId).emit('jobAccepted', { electricians: updatedJob.electricians, electrician: updatedJob.electricians[0] });
    } else {
      // Notify customer that a team member has joined
      const justAddedElectrician = updatedJob.electricians.find(e => e._id.equals(electricianId));
      io.to(jobId).emit('teamMemberJoined', { electrician: justAddedElectrician, teamSize: updatedJob.teamSize, currentSize: updatedJob.electricians.length });
    }

    res.status(200).json(updatedJob);
  } catch (error) {
    console.error(`Error accepting job ${req.params.id} by electrician ${req.user?.userId}:`, error.stack);
    res.status(500).json({ message: 'Internal server error while accepting job' });
  }
});

// PUT /api/jobs/:id/cancel - Cancel a job
api.put('/jobs/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, customer: req.user.userId, status: 'searching' },
      { status: 'cancelled' },
      { new: true }
    );
    if (!job) return res.status(404).json({ message: 'Job not found or already assigned' });
    res.status(200).json({ message: 'Job cancelled successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/admin/jobs/:id/verify-payment - Admin approves upfront payment
api.put('/admin/jobs/:id/verify-payment', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const job = await Job.findByIdAndUpdate(req.params.id, { paymentStatus: 'paid', status: 'searching' }, { new: true });
    if (!job) return res.status(404).json({ message: 'Job not found' });
    
    io.to(req.params.id).emit('paymentVerified');
    io.emit('newJobAvailable', job); // Now alert electricians!
    res.status(200).json(job);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/jobs/:id/complete - Customer completes job and triggers payout
api.put('/jobs/:id/complete', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'customer') return res.status(403).json({ message: 'Only customers can mark jobs complete' });

    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, customer: req.user.userId, status: { $in: ['assigned', 'in_progress', 'payment'] } },
      { status: 'completed' },
      { new: true }
    );
    
    if (!job) return res.status(404).json({ message: 'Job not found' });

    // Payout: 80% to electricians (20% platform cut)
    const earningsPerElectrician = (job.estimatedPrice * 0.8) / Math.max(1, job.electricians.length);
    for (const electricianId of job.electricians) {
      await User.findByIdAndUpdate(electricianId, { $inc: { walletBalance: earningsPerElectrician } });
    }

    io.to(req.params.id).emit('jobCompleted'); // Notify all in room

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
    if (user.walletBalance < 500) return res.status(400).json({ message: 'Minimum ₹500 required for withdrawal' });
    
    const withdrawal = await Withdrawal.create({ electrician: user._id, amount: user.walletBalance });
    user.walletBalance = 0; // Deduct immediately to prevent double spend
    await user.save();
    
    res.status(201).json({ message: 'Withdrawal requested', withdrawal });
  } catch (error) {
    res.status(500).json({ message: 'Error processing withdrawal' });
  }
});

// PUT /api/admin/withdrawals/:id/approve
api.put('/admin/withdrawals/:id/approve', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const withdrawal = await Withdrawal.findByIdAndUpdate(req.params.id, { status: 'approved' }, { new: true });
    if (!withdrawal) return res.status(404).json({ message: 'Request not found' });
    res.status(200).json({ message: 'Withdrawal approved', withdrawal });
  } catch (error) {
    res.status(500).json({ message: 'Error approving withdrawal' });
  }
});

// POST /api/users/:id/rate - Rate an electrician
api.post('/users/:id/rate', authenticateToken, async (req, res) => {
  try {
    const { rating } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ message: 'Invalid rating' });

    if (!req.params.id || req.params.id === 'undefined' || !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid or missing Electrician ID' });
    }

    const electrician = await User.findById(req.params.id);
    if (!electrician || electrician.role !== 'electrician') return res.status(404).json({ message: 'Electrician not found' });

    // BUG FIX: Verify that the requesting user (customer) has a completed job with this electrician.
    const completedJob = await Job.findOne({
      customer: req.user.userId,
      electricians: req.params.id,
      status: 'completed'
    });

    // To prevent re-rating, you could add a flag like `isRated` to the Job schema and check for it here.
    if (!completedJob) {
      return res.status(403).json({ message: 'Forbidden: You can only rate an electrician after a completed job.' });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      [{
        $set: {
          totalReviews: { $add: [{ $ifNull: ["$totalReviews", 0] }, 1] },
          averageRating: {
            $round: [
              { $divide: [
                { $add: [{ $multiply: [{ $ifNull: ["$averageRating", 0] }, { $ifNull: ["$totalReviews", 0] }] }, rating] },
                { $add: [{ $ifNull: ["$totalReviews", 0] }, 1] }
              ]},
              1
            ]
          }
        }
      }],
      { new: true }
    );
    res.status(200).json({ message: 'Rating submitted', rating: updatedUser.averageRating });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.use('/api', api);