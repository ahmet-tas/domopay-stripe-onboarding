'use strict';

const config = require('../../config');
const stripe = require('stripe')(config.stripe.secretKey, {
  apiVersion: config.stripe.apiVersion || '2022-08-01'
});
const express = require('express');
const router = express.Router();
const Passenger = require('../../models/passenger');

/* For this demo, we assume that we're always authenticating the
 * latest passenger. In a production app, you would also typically
 * have a user authentication system for passengers.
 */

module.exports = router;
