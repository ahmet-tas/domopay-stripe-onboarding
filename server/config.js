// config.js
const dotenv = require('dotenv');
dotenv.config();

module.exports = {

  // App name
  appName: 'domopay',

  // Public domain of domopay
  publicDomain: process.env.APPLICATION_URL || 'http://localhost:3000',

  // Server port
  port: process.env.PORT || 3000,

  // Secret for cookie sessions
  secret: process.env.COOKIE_SECRET,

  // Configuration for Stripe
  // API Keys: https://dashboard.stripe.com/account/apikeys
  // Connect Settings: https://dashboard.stripe.com/account/applications/settings
  stripe: {
    secretKey: process.env.STRIPE_SECRETKEY,
    publishableKey: process.env.STRIPE_PUBLISHABLEKEY,
    apiVersion: '2022-08-01'
  },

  // Configuration for MongoDB
  mongoUri: process.env.MONGO_URI
};