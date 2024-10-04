'use strict';

const config = require('../../config');
const stripe = require('stripe')(config.stripe.secretKey, {
  apiVersion: '2024-06-20'
});
const express = require('express');
const router = express.Router();
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const crypto = require('crypto');
const ServiceVendor = require('../../models/serviceVendor');
const Offering = require('../../models/offering');
const Customer = require('../../models/customer');

// Middleware: require a logged-in serviceVendor
function serviceVendorRequired(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.redirect('/serviceVendors/login');
  }
  next();
}

// Middleware: authenticate using API key
function authenticate(req, res, next) {
  passport.authenticate('headerapikey', { session: false })(req, res, next);
}

// Helper function: get the currency symbol for the given country ISO code
const getCurrencySymbol = currency => {
  const currencySymbol = new Intl.NumberFormat('de', {
    currency,
    style: 'currency'
  }).formatToParts(0).find(part => part.type === 'currency');
  return currencySymbol && currencySymbol.value;
}

/**
 * GET /serviceVendors/dashboard
 *
 * Show the Dashboard for the logged-in serviceVendor with the overview,
 * their offering history, and the ability to simulate a test offering.
 *
 * Use the `serviceVendorRequired` middleware to ensure that only logged-in
 * serviceVendors can access this route.
 */
router.get('/dashboard', serviceVendorRequired, async (req, res) => {
  const serviceVendor = req.user;
  // Retrieve the balance from Stripe
  const balance = await stripe.balance.retrieve({
    stripeAccount: serviceVendor.stripeAccountId,
  });

  // Fetch the serviceVendor's recent offerings
  const offerings = await serviceVendor.listRecentOfferings() || [];
  const offeringsTotalAmount = offerings.reduce((a, b) => {
    return a + b.amountForServiceVendor();
  }, 0);
  const [showBanner] = req.flash('showBanner');
  
  //Fetch the serviceVendor's products
  const products = await stripe.products.list({ stripeAccount: serviceVendor.stripeAccountId });

  //Create a list of products & prices and return them as simple list (but we need the product id as well)
  const productsWithPrices = [];
  for (const product of products.data) {
    const prices = await stripe.prices.list({ product: product.id, stripeAccount: serviceVendor.stripeAccountId });
    
    //search for the default price. if the default price is not found, use the first price in the list
    const defaultPrice = await stripe.prices.retrieve(product.default_price, { stripeAccount: serviceVendor.stripeAccountId }) || prices.data[0];

    productsWithPrices.push({
      name: product.name,
      id: product.id,
      price: defaultPrice.unit_amount,
      priceId: defaultPrice.id
    });
  }
  

  // There is one balance for each currencies used: as this 
  // demo app only uses USD we'll just use the first object
  res.render('dashboard', {
    serviceVendor: serviceVendor,
    balanceAvailable: balance.available[0].amount,
    balancePending: balance.pending[0].amount,
    offeringsTotalAmount: offeringsTotalAmount,
    balanceCurrency: getCurrencySymbol(balance.available[0].currency),
    offerings: offerings,
    rides: offerings,
    showBanner: !!showBanner || req.query.showBanner,
    products: productsWithPrices,
    paymentLink: req.query.paymentLink,
  });
});

/**
 * POST /serviceVendors/offerings
 *
 * Generate a test offering with sample data for the logged-in serviceVendor.
 */
router.post('/offerings', serviceVendorRequired, async (req, res, next) => {
  const serviceVendor = req.user;
  // Find a random customer
  const customer = await Customer.getRandom();
  // Create a new offering for the serviceVendor and this random customer
  const offering = new Offering({
    serviceVendor: serviceVendor.id,
    customer: customer.id,
    // Generate a random amount between €10 and €100 for this offering
    amount: getRandomInt(1000, 10000),
  });
  // Save the offering
  await offering.save();
  try {
    // Get a test source, using the given testing behavior
    let source;
    if (req.body.immediate_balance) {
      source = getTestSource('immediate_balance');
    } else if (req.body.payout_limit) {
      source = getTestSource('payout_limit');
    }
    let charge;
    // Accounts created in Japan/Germany have the `full` service agreement and must create their own card payments
    if (serviceVendor.country === 'DE') {
      // Create a Destination Charge to the serviceVendor's account
      charge = await stripe.charges.create({
        source: source,
        amount: offering.amount,
        currency: offering.currency,
        description: config.appName,
        statement_descriptor: config.appName,
        on_behalf_of: serviceVendor.stripeAccountId,
        // The destination parameter directs the transfer of funds from platform to serviceVendor
        transfer_data: {
          // Send the amount for the serviceVendor after collecting a 20% platform fee:
          // the `amountForServiceVendor` method simply computes `offering.amount * 0.8`
          amount: offering.amountForServiceVendor(),
          // The destination of this charge is the serviceVendor's Stripe account
          destination: serviceVendor.stripeAccountId,
        },
      });
    } else {
      // Accounts created in any other country use the more limited `recipients` service agreement (with a simpler
      // onboarding flow): the platform creates the charge and then separately transfers the funds to the recipient.
      charge = await stripe.charges.create({
        source: source,
        amount: offering.amount,
        currency: offering.currency,
        description: config.appName,
        statement_descriptor: config.appName,
        // The `transfer_group` parameter must be a unique id for the offering; it must also match between the charge and transfer
        transfer_group: offering.id
      });
      const transfer = await stripe.transfers.create({
        amount: offering.amountForServiceVendor(),
        currency: offering.currency,
        destination: serviceVendor.stripeAccountId,
        transfer_group: offering.id
      })
    }
    // Add the Stripe charge reference to the offering and save it
    offering.stripeChargeId = charge.id;
    offering.save();
  } catch (err) {
    console.log(err);
    // Return a 402 Payment Required error code
    res.sendStatus(402);
    next(`Error adding token to customer: ${err.message}`);
  }
  res.redirect('/serviceVendors/dashboard');
});

/**
 * GET /serviceVendors/signup
 *
 * Display the signup form on the right step depending on the current completion.
 */
router.get('/signup', (req, res) => {
  let step = 'account';
  // Naive way to identify which step we're on: check for the presence of user profile data
  if (req.user) {
    if (
      req.user.type === 'individual'
        ? !req.user.firstName || !req.user.lastName
        : !req.user.businessName
    ) {
      step = 'profile';
    } else if (!req.user.onboardingComplete) {
      step = 'payments';
    } else {
      step = 'done';
    }
  }
  res.render('signup', {step: step});
});

/**
 * POST /serviceVendors/signup
 *
 * Create a user and update profile information during the serviceVendor onboarding process.
 */
router.post('/signup', async (req, res, next) => {
  const body = Object.assign({}, req.body, {
    // Use `type` instead of `serviceVendor-type` for saving to the DB.
    type: req.body['serviceVendor-type'],
    'serviceVendor-type': undefined,
  });

  // Check if we have a logged-in serviceVendor
  let serviceVendor = req.user;
  if (!serviceVendor) {
    try {
      // Try to create and save a new serviceVendor, including API key generation
      serviceVendor = new ServiceVendor({
        email: body.email,
        password: body.password, 
        apiKey: crypto.randomBytes(20).toString('hex'), // Generate and assign API key
        type: body.type,
        stripeAccountId: body.stripeAccountId,
      });
      serviceVendor = await serviceVendor.save();

      // Log in the new serviceVendor and redirect to the signup process continuation
      req.logIn(serviceVendor, err => {
        if (err) next(err);
        return res.redirect('/serviceVendors/signup');
      });
    } catch (err) {
      console.log(err); 
      // Show an error message to the user
      const errors = Object.keys(err.errors).map(field => err.errors[field].message);
      res.render('signup', { step: 'account', error: errors[0] });
    }
  } 
  else {
    try {
      // If the serviceVendor is already logged in, update their profile data
      serviceVendor.set(body);
      await serviceVendor.save();
      return res.redirect('/serviceVendors/stripe/authorize');
    } catch (err) {
      next(err);
    }
  }
});

/**
 * GET /serviceVendors/login
 *
 * Simple serviceVendor login.
 */
router.get('/login', (req, res) => {
  res.render('login');
});

/**
 * GET /serviceVendors/login
 *
 * Simple serviceVendor login.
 */
router.post(
  '/login',
  passport.authenticate('serviceVendor-login', {
    successRedirect: '/serviceVendors/dashboard',
    failureRedirect: '/serviceVendors/login',
  })
);

/**
 * GET /serviceVendors/logout
 *
 * Delete the serviceVendor from the session.
 */
router.get('/logout', (req, res) => {
  req.logout();
  res.redirect('/');
});

/**
 * GET /serviceVendors/offerings
 *
 * Gets all Stripe products for connected account
 */
router.get('/offerings', authenticate, async (req, res) => {
  try {
    const serviceVendor = req.user;  // The authenticated user (connected account)
    const stripeAccountId = serviceVendor.stripeAccountId; // The Stripe account ID of the connected account

    // Get all products for the connected account
    const products = await stripe.products.list({}, { stripeAccount: stripeAccountId });

    res.json({ products });
  } catch (error) {
    console.error('Error creating Payment Link:', error);
    res.status(500).json({ error: 'Failed to create payment link' });
  }
});

// Create a payment link based on an existing product ID
router.post('/paymentLink/product', authenticate, async (req, res) => {
  const { productId, unitPrice, quantity, requireAddress = false } = req.body;

  console.log('Creating payment link for product:', productId, 'with price:', unitPrice, 'and quantity:', quantity);

  // Input validation
  if (!productId || !unitPrice || isNaN(unitPrice) || unitPrice <= 0) {
      return res.status(400).json({ error: 'Invalid product ID or price' });
  }

  //validate quantity
  if (isNaN(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'Invalid quantity' });
  }

  try {
    const serviceVendor = req.user;  // The authenticated user (connected account)
    const stripeAccountId = serviceVendor.stripeAccountId; // The Stripe account ID of the connected account

      // Create a price object for the existing product
      const priceObj = await stripe.prices.create({
          unit_amount: unitPrice * 100, // Convert to cents
          currency: 'eur',
          product: productId,
      }, { stripeAccount: stripeAccountId });

      // Create payment link
      const paymentLink = await stripe.paymentLinks.create({
          line_items: [
              {
                  price: priceObj.id,
                  quantity: quantity || 1 // Default to 1 if not provided,
              },
          ],
      }, { stripeAccount: stripeAccountId });

      res.json({
        success: true,
        paymentLink: paymentLink.url,
        paymentLinkId: paymentLink.id,
      });
  } catch (error) {
      console.error('Error creating payment link:', error);
      return res.status(500).json({ error: 'Failed to create payment link' });
  }
});


// Serialize the serviceVendor's sessions for Passport
passport.serializeUser((user, done) => {
  done(null, user.id);
});
passport.deserializeUser(async (id, done) => {
  try {
    let user = await ServiceVendor.findById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// Define the login strategy for serviceVendors based on email and password
passport.use('serviceVendor-login', new LocalStrategy({
  usernameField: 'email',
  passwordField: 'password'
}, async (email, password, done) => {
  let user;
  try {
    user = await ServiceVendor.findOne({email});
    if (!user) {
      return done(null, false, { message: 'Unbekannter Benutzer' });
    }
  } catch (err) {
    return done(err);
  }
  if (!user.validatePassword(password)) {
    return done(null, false, { message: 'Falsches Passwort' });
  }
  return done(null, user);
}));

// Function that returns a test card token for Stripe
function getTestSource(behavior) {
  // Important: We're using static tokens based on specific test card numbers
  // to trigger a special behavior. This is NOT how you would create real payments!
  // You should use Stripe Elements or Stripe iOS/Android SDKs to tokenize card numbers.
  // Use a static token based on a test card: https://stripe.com/docs/testing#cards
  var source = 'tok_visa';
  // We can use a different test token if a specific behavior is requested
  if (behavior === 'immediate_balance') {
    source = 'tok_bypassPending';
  } else if (behavior === 'payout_limit') {
    source = 'tok_visa_triggerTransferBlock';
  }
  return source;
}

// Return a random int between two numbers
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = router;
