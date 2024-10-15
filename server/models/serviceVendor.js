'use strict';

const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const bcrypt = require('bcryptjs');
const Offering = require('./offering');

// Define the ServiceVendor schema.
const ServiceVendorSchema = new Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    validate: {
      // Custom validator to check if the email was already used.
      validator: ServiceVendorEmailValiidator,
      message: 'Diese Email ist bereits registriert.',
    }
  },
  password: {
    type: String,
    required: true
  },
  type: {
    type: String,
    default: 'company',
    enum: ['individual', 'company']
  },
  firstName: String,
  lastName: String,
  address: String,
  postalCode: String,
  city: String,
  state: { type: String}, 
  country: { type: String, default: 'DE' },
  created: { type: Date, default: Date.now },
  products: {
    certificationRate: Number,
    keyRate: Number,
    hourRate: Number,
  },
  rocket: {
    model: String,
    license: String,
    color: String
  },
  businessName: String,
  // Stripe account ID to send payments obtained with Stripe Connect.
  stripeAccountId: String,
  onboardingComplete: Boolean,
  apiKey: { type: String, unique: true }
});

// Check the email addess to make sure it's unique (no existing serviceVendor with that address).
function ServiceVendorEmailValiidator(email) {
  const ServiceVendor = mongoose.model('ServiceVendor');
  // Asynchronously resolve a promise to validate whether an email already exists
  return new Promise((resolve, reject) => {
    // Only check model updates for new serviceVendors (or if the email address is updated).
    if (this.isNew || this.isModified('email')) {
      // Try to find a matching serviceVendor
      ServiceVendor.findOne({email}).exec((err, serviceVendor) => {
        // Handle errors
        if (err) {
          console.log(err);
          resolve(false);
          return;
        }
        // Validate depending on whether a matching serviceVendor exists.
        if (serviceVendor) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    } else {
      resolve(true);
    }
  });
}

// Return a serviceVendor name for display.
ServiceVendorSchema.methods.displayName = function() {
  if (this.type === 'company') {
    return this.businessName;
  } else {
    return `${this.firstName} ${this.lastName}`;
  }
};

// List offerings of the past week for the serviceVendor.
ServiceVendorSchema.methods.listRecentOfferings = function() {
  const weekAgo = Date.now() - (7*24*60*60*1000);
  return Offering.find({ serviceVendor: this, created: { $gte: weekAgo } })
    .populate('customer')
    .sort({ created: -1 })
    .exec();
};

// Generate a password hash (with an auto-generated salt for simplicity here).
ServiceVendorSchema.methods.generateHash = function(password) {
  return bcrypt.hashSync(password, 8);
};

// Check if the password is valid by comparing with the stored hash.
ServiceVendorSchema.methods.validatePassword = function(password) {
  return bcrypt.compareSync(password, this.password);
};

// Get the first fully onboarded serviceVendor.
ServiceVendorSchema.statics.getFirstOnboarded = function() {
  return ServiceVendor.findOne({ stripeAccountId: { $ne: null } })
    .sort({ created: 1 })
    .exec();
};

// Get the latest fully onboarded serviceVendor.
ServiceVendorSchema.statics.getLatestOnboarded = function() {
  return ServiceVendor.findOne({ stripeAccountId: { $ne: null } })
    .sort({ created: -1 })
    .exec();
};

// Pre-save hook to define some default properties for serviceVendors.
ServiceVendorSchema.pre('save', function(next) {
  // Make sure certain fields are blank depending on the serviceVendor type.
  if (this.isModified('type')) {
    if (this.type === 'individual') {
      this.businessName = null;
    } else {
      this.firstName = null;
      this.lastName = null;
    }
  }
  // Make sure the password is hashed before being stored.
  if (this.isModified('password')) {
    this.password = this.generateHash(this.password);
  }
  next();
});

const ServiceVendor = mongoose.model('ServiceVendor', ServiceVendorSchema);

module.exports = ServiceVendor;
