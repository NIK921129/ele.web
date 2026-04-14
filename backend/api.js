const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Job = require('../models/Job');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_fallback_key';

const router = express.Router();

// Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'Unauthorized: Missing token' });

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Attach the decoded payload to the request object
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized: Invalid or expired token' });
  }
};

// POST /api/login
router.post('/login', async (req, res) => {
  try {
    const { name, phone, role } = req.body;

    if (!name || !phone || !role) {
      return res.status(400).json({ message: 'Name, phone, and role are required' });
    }

    // Find user by phone and role, or create a new one if it doesn't exist
    let user = await User.findOne({ phone, role });
    if (!user) {
      user = new User({ name, phone, role });
      await user.save();
    }

    // Generate a secure JWT for session management
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      JWT_SECRET, // Use the defined constant
      { expiresIn: '7d' }
    );

    // Return data in the exact format the frontend expects
    res.json({
      token,
      user: user.toObject() // Ensure user object is returned
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ message: 'Internal server error during authentication' });
  }
});

// POST /api/jobs - Create a new booking (protected)
router.post('/jobs', authenticateToken, async (req, res) => {
  try {
    const { serviceType, address, coordinates, estimatedPrice } = req.body;

    if (!serviceType || !address) {
      return res.status(400).json({ message: 'Service type and address are required' });
    }

    const newJob = new Job({
      customer: req.user.userId, // Use decoded user from middleware
      serviceType,
      address,
      location: { type: 'Point', coordinates: coordinates || [0, 0] },
      estimatedPrice: estimatedPrice || 299, // default base price
      jobOTP: Math.floor(1000 + Math.random() * 9000).toString(),
      status: 'searching'
    });

    await newJob.save();
    res.status(201).json(newJob);
  } catch (error) {
    console.error('Job Booking Error:', error);
    res.status(500).json({ message: 'Internal server error during booking' });
  }
});

// GET /api/jobs/available - Fetch a pending job for electricians (protected and optimized)
router.get('/jobs/available', authenticateToken, async (req, res) => {
  try {
    const { latitude, longitude, maxDistance = 10 } = req.query; // maxDistance in km

    let query = { status: 'searching' };
    let sort = { createdAt: -1 }; // Default sort by newest

    if (latitude && longitude) {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      const distanceInMeters = parseFloat(maxDistance) * 1000;

      if (isNaN(lat) || isNaN(lng) || isNaN(distanceInMeters)) {
        return res.status(400).json({ message: 'Invalid latitude, longitude, or maxDistance' });
      }

      query.location = {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [lng, lat]
          },
          $maxDistance: distanceInMeters
        }
      };
      sort = {}; // When using $near, MongoDB automatically sorts by distance
    }

    const job = await Job.findOne(query).sort(sort).select('serviceType address estimatedPrice jobOTP status location customer'); // Select only necessary fields
    res.status(200).json(job);
  } catch (error) {
    console.error('Fetch Available Jobs Error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/jobs/:id/accept - Electrician accepts a job (protected)
router.put('/jobs/:id/accept', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'electrician' && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden: Only electricians can accept jobs' });
    }

    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, status: 'searching' },
      { status: 'assigned', electrician: req.user.userId }, // Use decoded user from middleware
      { new: true }
    );

    if (!job) {
      return res.status(404).json({ message: 'Job not found or already assigned to someone else' });
    }

    res.status(200).json(job);
  } catch (error) {
    console.error('Accept Job Error:', error);
    res.status(500).json({ message: 'Internal server error while accepting job' });
  }
});

// PUT /api/jobs/:id/cancel - Customer cancels a job (protected)
router.put('/jobs/:id/cancel', authenticateToken, async (req, res) => {
  try {
    // Only allow cancelling if it's the customer's job and no electrician has accepted it yet
    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, customer: req.user.userId, status: 'searching' }, // Use decoded user from middleware
      { status: 'cancelled' },
      { new: true }
    );

    if (!job) {
      return res.status(404).json({ message: 'Job not found or already assigned to an electrician' });
    }

    res.status(200).json({ message: 'Job cancelled successfully' });
  } catch (error) {
    console.error('Cancel Job Error:', error);
    res.status(500).json({ message: 'Internal server error while cancelling job' });
  }
});

// PUT /api/jobs/:id/complete - Electrician marks a job as completed (protected)
router.put('/jobs/:id/complete', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'electrician' && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden: Only electricians can complete jobs' });
    }

    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, electrician: req.user.userId, status: { $in: ['assigned', 'in_progress', 'payment'] } }, // Use decoded user from middleware
      { status: 'completed' },
      { new: true }
    );

    if (!job) {
      return res.status(404).json({ message: 'Job not found or not assigned to you' });
    }

    res.status(200).json(job);
  } catch (error) {
    console.error('Complete Job Error:', error);
    res.status(500).json({ message: 'Internal server error while completing job' });
  }
});

// POST /api/users/:id/rate - Rate an electrician (protected)
router.post('/users/:id/rate', authenticateToken, async (req, res) => {
  try {
    // Token is already validated by middleware, req.user contains decoded payload

    const { rating } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'A valid rating between 1 and 5 is required' });
    }

    const electrician = await User.findById(req.params.id);
    if (!electrician || electrician.role !== 'electrician') {
      return res.status(404).json({ message: 'Electrician not found' });
    }

    // Calculate the new average rating mathematically
    const newTotal = (electrician.totalReviews || 0) + 1;
    const newAverage = (((electrician.averageRating || 0) * (electrician.totalReviews || 0)) + rating) / newTotal;

    const updatedUser = await User.findByIdAndUpdate(req.params.id, { averageRating: newAverage.toFixed(1), totalReviews: newTotal }, { new: true });
    res.status(200).json({ message: 'Rating submitted successfully', rating: updatedUser.averageRating });
  } catch (error) {
    console.error('Rating Error:', error);
    res.status(500).json({ message: 'Internal server error while submitting rating' });
  }
});

module.exports = router;