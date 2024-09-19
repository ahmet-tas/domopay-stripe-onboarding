'use strict';

const config = require('../config');
const stripe = require('stripe')(config.stripe.secretKey, {
  apiVersion: config.stripe.apiVersion || '2022-08-01'
});
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Use native promises.
mongoose.Promise = global.Promise;

// Define the Customer schema.
const CustomerSchema = new Schema({
  email: { type: String, required: true, unique: true },
  firstName: String,
  lastName: String,
  created: { type: Date, default: Date.now },

  // Stripe customer ID storing the payment sources.
  stripeCustomerId: String
});

// Return a customer name for display.
CustomerSchema.methods.displayName = function() {
  return `${this.firstName} ${this.lastName.charAt(0)}.`;
};

// Get the latest customer.
CustomerSchema.statics.getLatest = async function() {
  try {
    // Count all the customers.
    const count = await Customer.countDocuments().exec();
    if (count === 0) {
      // Create default customers.
      await Customer.insertDefaultCustomers();
    }
    // Return latest customer.
    return Customer.findOne()
      .sort({ created: -1 })
      .exec();
  } catch (err) {
    console.log(err);
  }
};

// Find a random customer.
CustomerSchema.statics.getRandom = async function() {
  try {
    // Count all the customers.
    const count = await Customer.countDocuments().exec();
    if (count === 0) {
      // Create default customers.
      await Customer.insertDefaultCustomers();
    }
    // Returns a document after skipping a random amount.
    const random = Math.floor(Math.random() * count);
    return Customer.findOne().skip(random).exec();
  } catch (err) {
    console.log(err);
  }
};

// Create a few default customers for the platform to simulate offerings.
CustomerSchema.statics.insertDefaultCustomers = async function() {
  try {
    const data = [{
      firstName: 'Jenny',
      lastName: 'Rosen',
      email: 'jenny.rosen@example.com'
    }, {
      firstName: 'Kathleen',
      lastName: 'Banks',
      email: 'kathleen.banks@example.com'
    }, {
      firstName: 'Victoria',
      lastName: 'Thompson',
      email: 'victoria.thompson@example.com'
    }, {
      firstName: 'Ruth',
      lastName: 'Hamilton',
      email: 'ruth.hamilton@example.com'
    }, {
      firstName: 'Emma',
      lastName: 'Lane',
      email: 'emma.lane@example.com'
    }];
    for (let object of data) {
      const customer = new Customer(object);
      // Create a Stripe account for each of the customers.
      const stripeCustomer = await stripe.customers.create({
        email: customer.email,
        description: customer.displayName()
      });
      customer.stripeCustomerId = stripeCustomer.id;
      await customer.save();
    }
  } catch (err) {
    console.log(err);
  }
};

const Customer = mongoose.model('Customer', CustomerSchema);

module.exports = Customer;
