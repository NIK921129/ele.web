require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const apiRoutes = require('./api');
const Job = require('./models/Job');

const app = express();
const server = http.createServer(app);

// Configure CORS for frontend hosted on Vercel
app.use(cors({
  origin: process.env.FRONTEND_URL || '*', // e.g., 'https://voltflow.vercel.app'
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
}));
app.use(express.json());

// Gracefully handle invalid JSON payloads from clients
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ message: 'Malformed JSON payload' });
  }
  next();
});

// Mount REST API Routes
app.use('/api', apiRoutes);

// Setup Socket.io for Real-Time features
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || '*' }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Join a specific job room (Customer and Electrician join the same room)
  socket.on('joinJobRoom', (jobId) => {
    socket.join(jobId);
  });

  // Handle batched/adaptive location updates from the Electrician
  socket.on('updateLocation', (data) => {
    // data payload: { jobId, coordinates, distance, eta }
    // Relay this to the customer securely via the room
    socket.to(data.jobId).emit('electricianLocationChanged', data);
  });

  // Handle job acceptance notifications
  socket.on('jobAccepted', (data) => {
    // data payload: { jobId, electrician }
    socket.to(data.jobId).emit('jobAccepted', data);
  });

  // Handle job completion notifications
  socket.on('jobCompleted', (data) => {
    // data payload: { jobId }
    socket.to(data.jobId).emit('jobCompleted', data);
  });

  // Handle real-time chat messages
  socket.on('sendMessage', async (data) => {
    // data payload: { jobId, sender, text, time }
    socket.to(data.jobId).emit('receiveMessage', data);

    // Save message to MongoDB Job model
    try {
      // Ensure jobId is a valid Mongo ID (ignores 'MOCK_JOB_123' during frontend prototyping)
      if (mongoose.Types.ObjectId.isValid(data.jobId)) {
        await Job.findByIdAndUpdate(data.jobId, {
          $push: { chatHistory: { sender: data.senderId, text: data.text, time: data.time } } // Store senderId
        });
      }
    } catch (err) {
      console.error('Error saving chat message:', err);
    }
  });
});

// Connect to MongoDB and Start Server
const PORT = process.env.PORT || 5000;
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB Atlas successfully.');
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
  });

// Start server immediately to allow health checks and graceful failure responses
server.listen(PORT, () => console.log(`VoltFlow Backend running on port ${PORT}`));

// Graceful Shutdown Handler
process.on('SIGINT', async () => {
  console.log('SIGINT signal received: closing HTTP server & MongoDB connection');
  await mongoose.connection.close();
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});