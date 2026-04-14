const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    role: { 
      type: String, 
      enum: ['customer', 'electrician', 'admin'], 
      required: true 
    },
    averageRating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 }
  },
  { timestamps: true }
);

// Prevent duplicate accounts with the same phone and role
userSchema.index({ phone: 1, role: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);