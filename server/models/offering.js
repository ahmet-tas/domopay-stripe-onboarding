'use strict';

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Use native promises.
mongoose.Promise = global.Promise;

// Define the Offering schema.
const OfferingSchema = new Schema({
  serviceVendor: { type : Schema.ObjectId, ref : 'ServiceVendor', required: true },
  customer: { type : Schema.ObjectId, ref : 'Customer', required: true },
  origin: { type: [Number], index: '2d', sparse: true, default: [37.7765030, -122.3920385] },
  destination: { type: [Number], index: '2d', sparse: true, default: [37.8199286, -122.4782551] },
  pickupTime: { type: Date, default: Date.now },
  dropoffTime: { type: Date, default: new Date((new Date).getTime() + Math.floor(10 * Math.random()) * 60000) },
  amount: Number,
  currency: { type: String, default: 'eur' },
  created: { type: Date, default: Date.now },

  // Stripe Payment Intent ID corresponding to this offering.
  stripePaymentIntentId: String
});

// Return the offering amount for the serviceVendor after collecting 20% platform fees.
OfferingSchema.methods.amountForServiceVendor = function() {
  return parseInt(this.amount);
};

const Offering = mongoose.model('Offering', OfferingSchema);

module.exports = Offering;
