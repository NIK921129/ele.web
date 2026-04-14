const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Remove trailing slash if it exists to prevent strict CORS mismatches
const FRONTEND_URL = (process.env.FRONTEND_URL || '*').replace(/\/$/, '');

// Configure Socket.io and CORS
const io = new Server(server, { cors: { origin: FRONTEND_URL } });
app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_fallback_key';
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/voltflow';

// ==========================================
// 1. MONGODB SCHEMAS & MODELS
// ==========================================
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  role: { type: String, enum: ['customer', 'electrician', 'admin'], required: true },
  totalReviews: { type: Number, default: 0 },
  averageRating: { type: Number, default: 0 }
}, { timestamps: true });

const jobSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  electrician: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  serviceType: { type: String, required: true },
  address: { type: String, required: true },
  location: {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: { type: [Number], required: true }
  },
  estimatedPrice: { type: Number, default: 299 },
  jobOTP: { type: String },
  status: { type: String, enum: ['searching', 'assigned', 'in_progress', 'payment', 'completed', 'cancelled'], default: 'searching' }
}, { timestamps: true });

jobSchema.index({ location: '2dsphere' });

const User = mongoose.model('User', userSchema);
const Job = mongoose.model('Job', jobSchema);

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

// POST /api/login
api.post('/login', async (req, res) => {
  try {
    const { name, phone, role } = req.body;
    if (!name || !phone || !role) return res.status(400).json({ message: 'Name, phone, and role required' });

    let user = await User.findOne({ phone, role });
    if (!user) {
      user = new User({ name, phone, role });
      await user.save();
    }

    const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: user.toObject() });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error during authentication' });
  }
});

// POST /api/jobs - Create a new booking
api.post('/jobs', authenticateToken, async (req, res) => {
  try {
    const { serviceType, address, coordinates, estimatedPrice } = req.body;
    if (!serviceType || !address) return res.status(400).json({ message: 'Service type and address required' });

    const newJob = new Job({
      customer: req.user.userId,
      serviceType,
      address,
      location: { type: 'Point', coordinates: coordinates || [0, 0] },
      estimatedPrice: estimatedPrice || 299,
      jobOTP: Math.floor(1000 + Math.random() * 9000).toString(),
      status: 'searching'
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
    let query = { status: 'searching' };

    if (latitude && longitude) {
      const lat = parseFloat(latitude), lng = parseFloat(longitude), dist = parseFloat(maxDistance) * 1000;
      if (isNaN(lat) || isNaN(lng) || isNaN(dist)) return res.status(400).json({ message: 'Invalid params' });

      query.location = { $near: { $geometry: { type: "Point", coordinates: [lng, lat] }, $maxDistance: dist } };
    }

    let jobQuery = Job.findOne(query).select('serviceType address estimatedPrice status location customer');
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
    if (req.user.role !== 'electrician' && req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });

    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, status: 'searching' },
      { status: 'assigned', electrician: req.user.userId },
      { new: true }
    ).populate('electrician', 'name phone averageRating totalReviews');

    if (!job) return res.status(404).json({ message: 'Job not found or already assigned' });
    
    // Notify customer that the job was accepted
    io.to(req.params.id).emit('jobAccepted', { electrician: job.electrician });

    res.status(200).json(job);
  } catch (error) {
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

// PUT /api/jobs/:id/complete - Complete a job
api.put('/jobs/:id/complete', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'electrician' && req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });

    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, electrician: req.user.userId, status: { $in: ['assigned', 'in_progress', 'payment'] } },
      { status: 'completed' },
      { new: true }
    );

    if (!job) return res.status(404).json({ message: 'Job not found or not assigned to you' });
    
    // Notify customer that job is completed
    io.to(req.params.id).emit('jobCompleted');

    res.status(200).json(job);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/users/:id/rate - Rate an electrician
api.post('/users/:id/rate', authenticateToken, async (req, res) => {
  try {
    const { rating } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ message: 'Invalid rating' });

    const electrician = await User.findById(req.params.id);
    if (!electrician || electrician.role !== 'electrician') return res.status(404).json({ message: 'Electrician not found' });

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

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});