'use strict';

const config = require('../../config');
const stripe = require('stripe')(config.stripe.secretKey, {
  apiVersion: config.stripe.apiVersion || '2022-08-01'
});
const express = require('express');
const router = express.Router();
const ServiceVendor = require('../../models/serviceVendor');
const Customer = require('../../models/customer');
const Offering = require('../../models/offering');

/* For this demo, we assume that we're always authenticating the
 * latest customer. In a production app, you would also typically
 * have a user authentication system for customers.
 */

/**
 * POST /api/offerings
 *
 * Create a new offering with the corresponding parameters.
 */
router.post('/', async (req, res, next) => {
  /* Important: For this demo, we're trusting the `amount` and `currency`
   * coming from the client request.
   * A real application should absolutely ensure the `amount` and `currency`
   * are securely computed on the backend to make sure the user can't change
   * the payment amount from their web browser or client-side environment.
   */
  const {paymentMethod, amount, currency} = req.body;

  try {
    // For the purpose of this demo, we'll assume we are automatically
    // matched with the first fully-onboarded serviceVendor rather than using their location.
    const serviceVendor = await ServiceVendor.getFirstOnboarded();
    // Find the latest customer (see note above)
    const customer = await Customer.getLatest();

    if(!serviceVendor || !customer) {
      throw `Could not get ${!serviceVendor ? "service-vendor" : "customer"} details.`
    }

    // Create a new offering
    const offering = new Offering({
      serviceVendor: serviceVendor.id,
      customer: customer.id,
      amount: amount,
      currency: currency,
    });
    // Save the offering
    await offering.save();

    const paymentMethods = await stripe.paymentMethods.list({
      customer: customer.stripeCustomerId,
      type: 'card',
    });

    // This only works for the latest customer attached card.      
    const latest_pm = paymentMethods.data[0].id;
    
    // Create a Payment Intent and set its destination to the serviceVendor's account
    const paymentIntent = await stripe.paymentIntents.create({
      amount: offering.amount,
      currency: offering.currency,
      description: config.appName,
      statement_descriptor: config.appName,
      // The destination parameter directs the transfer of funds from platform to serviceVendor
      customer: customer.stripeCustomerId,
      payment_method: latest_pm,
      confirm: true,
      application_fee_amount: 300, // €3 platform fee
      transfer_data: {
        // Send the amount for the serviceVendor after collecting a 20% platform fee:
        // the `amountForServiceVendor` method simply computes `offering.amount * 0.8`
        amount: offering.amountForServiceVendor(),
        // The destination of this Payment Intent is the serviceVendor's Stripe account
        destination: serviceVendor.stripeAccountId,
      },
    });

    // Add the Stripe Payment Intent reference to the offering and save it
    offering.stripePaymentIntentId = paymentIntent.id;
    offering.save();

    // Return the offering info
    res.send({
      serviceVendor_name: serviceVendor.displayName(),
      serviceVendor_vehicle: serviceVendor.rocket.model,
      serviceVendor_license: serviceVendor.rocket.license,
    });
  } catch (err) {
    res.sendStatus(500);
    next(`Error adding token to customer: ${err.message || err}`);
  }
});

module.exports = router;
