const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Job = require('../models/Job');

const router = express.Router();

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
      { userId: user._id, role: user.role }, // Use user._id directly
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Return data in the exact format the frontend expects
    res.json({
      token,
      user: user.toObject()
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ message: 'Internal server error during authentication' });
  }
});

// POST /api/jobs - Create a new booking
router.post('/jobs', async (req, res) => {
  try {
    // Authenticate the user from the token
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const { serviceType, address, coordinates, estimatedPrice } = req.body;

    if (!serviceType || !address) {
      return res.status(400).json({ message: 'Service type and address are required' });
    }

    const newJob = new Job({
      customer: decoded.userId,
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

// GET /api/jobs/available - Fetch a pending job for electricians
router.get('/jobs/available', async (req, res) => {
  try {
    // Find the newest job that is still searching for an electrician
    const job = await Job.findOne({ status: 'searching' }).sort({ createdAt: -1 });
    res.status(200).json(job || null);
  } catch (error) {
    console.error('Fetch Available Jobs Error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/jobs/:id/accept - Electrician accepts a job
router.put('/jobs/:id/accept', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_fallback_key');

    if (decoded.role !== 'electrician' && decoded.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden: Only electricians can accept jobs' });
    }

    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, status: 'searching' },
      { status: 'assigned', electrician: decoded.userId },
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

// PUT /api/jobs/:id/cancel - Customer cancels a job
router.put('/jobs/:id/cancel', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    // Only allow cancelling if it's the customer's job and no electrician has accepted it yet
    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, customer: decoded.userId, status: 'searching' },
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

// PUT /api/jobs/:id/complete - Electrician marks a job as completed
router.put('/jobs/:id/complete', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.role !== 'electrician' && decoded.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden: Only electricians can complete jobs' });
    }

    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, electrician: decoded.userId, status: { $in: ['assigned', 'in_progress', 'payment'] } },
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

// POST /api/users/:id/rate - Rate an electrician
router.post('/users/:id/rate', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
    
    // Validate token
    jwt.verify(authHeader.split(' ')[1], JWT_SECRET);

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