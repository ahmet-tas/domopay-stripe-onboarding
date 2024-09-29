'use strict';

const config = require('../../config');
const stripe = require('stripe')(config.stripe.secretKey, {
  apiVersion: config.stripe.apiVersion || '2022-08-01'
});
const request = require('request-promise-native');
const querystring = require('querystring');
const express = require('express');
const router = express.Router();

// Middleware that requires a logged-in serviceVendor
function serviceVendorRequired(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.redirect('/serviceVendors/login');
  } 
  next();
}

/**
 * GET /serviceVendors/stripe/authorize
 *
 * Redirect to Stripe to set up payments.
 */
router.get('/authorize', serviceVendorRequired, async (req, res, next) => {
  // Generate a random string as `state` to protect from CSRF and include it in the session
  req.session.state = Math.random()
    .toString(36)
    .slice(2);

  try {
    let accountId = req.user.stripeAccountId;

    // Create a Stripe account for this user if one does not exist already
    if (accountId == undefined) {
      // Define the parameters to create a new Stripe account with
      let accountParams = {
        type: 'express',
        country: req.user.country || undefined,
        email: req.user.email || undefined,
        business_type: req.user.type || 'individual', 
      }
  
      // Companies and invididuals require different parameters
      if (accountParams.business_type === 'company') {
        accountParams = Object.assign(accountParams, {
          company: {
            name: req.user.businessName || undefined
          }
        });
      } else {
        accountParams = Object.assign(accountParams, {
          individual: {
            first_name: req.user.firstName || undefined,
            last_name: req.user.lastName || undefined,
            email: req.user.email || undefined
          }
        });
      }
  
      const account = await stripe.accounts.create(accountParams);
      accountId = account.id;

      // Update the model and store the Stripe account ID in the datastore:
      // this Stripe account ID will be used to issue payouts to the serviceVendor
      req.user.stripeAccountId = accountId;
      await req.user.save();
    }

    // Create an account link for the user's Stripe account
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: config.publicDomain + '/serviceVendors/stripe/authorize',
      return_url: config.publicDomain + '/serviceVendors/stripe/onboarded',
      type: 'account_onboarding'
    });

    // Redirect to Stripe to start the Express onboarding flow
    res.redirect(accountLink.url);
  } catch (err) {
    console.log('Failed to create a Stripe account.');
    console.log(err);
    next(err);
  }
});

/**
 * GET /serviceVendors/stripe/onboarded
 *
 * Return endpoint from Stripe onboarding, checks if onboarding has been completed and creates dummy products in newly created Stripe account.
 */
router.get('/onboarded', serviceVendorRequired, async (req, res, next) => {
  try {
    // Retrieve the user's Stripe account and check if they have finished onboarding
    const account = await stripe.account.retrieve(req.user.stripeAccountId);
    if (account.details_submitted) {
      req.user.onboardingComplete = true;
      await req.user.save();

      // Redirect to the domopay dashboard
      req.flash('showBanner', 'true');

      // Create a few dummy products in the Stripe account
      const products = [
        {
          name: 'Bescheinigung',
          description: 'Wohungsgeberbescheinigung, Mietschuldenfreiheitsbescheinigung, etc.',
          default_price_data: {
            currency: 'eur',
            unit_amount: 2000
          },
        },
/*         {
          name: 'Schlüssel',
          description: 'Schlüsselbestellung, Schlüsselverlust, etc.',
          amount: 50,
          currency: 'eur',
          type: 'service'
        },
        {
          name: 'Stundenlohn',
          description: 'Handwerker, Reinigungskraft, etc.',
          amount: 100,
          currency: 'eur',
          type: 'service'
        } */
      ];

      for (const product of products) {
        await stripe.products.create({
          name: product.name,
          description: product.description,
          default_price_data: product.default_price_data,
        }, {
          stripeAccount: req.user.stripeAccountId
        });
      }

      res.redirect('/serviceVendors/dashboard');
    } else {
      console.log('The onboarding process was not completed.');
      res.redirect('/serviceVendors/signup');
    }
  } catch (err) {
    console.log('Failed to retrieve Stripe account information.');
    console.log(err);
    next(err);
  }
})

/**
 * GET /serviceVendors/stripe/dashboard
 *
 * Redirect to the serviceVendors' Stripe Express dashboard to view payouts and edit account details.
 */
router.get('/dashboard', serviceVendorRequired, async (req, res) => {
  const serviceVendor = req.user;
  // Make sure the logged-in serviceVendor completed the Express onboarding
  if (!serviceVendor.onboardingComplete) {
    return res.redirect('/serviceVendors/signup');
  }
  try {
    // Generate a unique login link for the associated Stripe account to access their Express dashboard
    const loginLink = await stripe.accounts.createLoginLink(
      serviceVendor.stripeAccountId, {
        redirect_url: config.publicDomain + '/serviceVendors/dashboard'
      }
    );
    // Directly link to the account tab
    if (req.query.account) {
      loginLink.url = loginLink.url + '#/account';
    }
    // Retrieve the URL from the response and redirect the user to Stripe
    return res.redirect(loginLink.url);
  } catch (err) {
    console.log(err);
    console.log('Failed to create a Stripe login link.');
    return res.redirect('/serviceVendors/signup');
  }
});

/**
 * POST /serviceVendors/stripe/payout
 *
 * Generate a payout with Stripe for the available balance.
 */
router.post('/payout', serviceVendorRequired, async (req, res) => {
  const serviceVendor = req.user;
  try {
    // Fetch the account balance to determine the available funds
    const balance = await stripe.balance.retrieve({
      stripeAccount: serviceVendor.stripeAccountId,
    });
    // This demo app only uses USD so we'll just use the first available balance
    // (Note: there is one balance for each currency used in your application)
    const {amount, currency} = balance.available[0];
    // Create a payout
    const payout = await stripe.payouts.create({
      amount: amount,
      currency: currency,
      statement_descriptor: config.appName,
    }, { stripeAccount: serviceVendor.stripeAccountId });
  } catch (err) {
    console.log(err);
  }
  res.redirect('/serviceVendors/dashboard');
});

/**
 * POST /serviceVendors/stripe/paymentLink
 *
 * Create new payment link for the request Stripe priceId
 */
router.post('/paymentLink', serviceVendorRequired, async (req, res) => {
  const { priceId, quantity } = req.body;

  try {
    const serviceVendor = req.user;  // The authenticated user (connected account)
    const stripeAccountId = serviceVendor.stripeAccountId; // The Stripe account ID of the connected account

    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{
          price: priceId,
          quantity: parseInt(quantity),
        }]
      }, { stripeAccount: stripeAccountId });

    // Redirect back to the dashboard with the payment link as a query parameter
    res.redirect(`/serviceVendors/dashboard?paymentLink=${encodeURIComponent(paymentLink.url)}`);
  } catch (error) {
    console.error('Error creating Payment Link:', error);
    res.redirect('/serviceVendors/dashboard');
  }
});


module.exports = router;
