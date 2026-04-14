const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  electrician: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  serviceType: { type: String, required: true },
  address: { type: String, required: true },
  
  // Job Location
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true } // [longitude, latitude]
  },
  
  status: { 
    type: String, 
    enum: ['searching', 'assigned', 'in_progress', 'payment', 'completed', 'cancelled'], 
    default: 'searching' 
  },
  
  estimatedPrice: { type: Number, required: true },
  finalPrice: { type: Number },
  jobOTP: { type: String }, // 4-digit PIN for starting the job
  
  chatHistory: [{ sender: String, text: String, time: String }]
}, { timestamps: true });

// Database Indexes for Performance Optimization
jobSchema.index({ location: '2dsphere' }); // Enables $near spatial queries for the matching algorithm
jobSchema.index({ status: 1, createdAt: -1 }); // Optimizes the 5-second interval polling for available jobs

module.exports = mongoose.model('Job', jobSchema);