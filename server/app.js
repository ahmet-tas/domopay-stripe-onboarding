'use strict';

const config = require('./config');
const express = require('express');
const session = require('cookie-session');
const passport = require('passport');
const ApiKeyStrategy = require('passport-headerapikey').HeaderAPIKeyStrategy;
const AuthService = require('./services/AuthService'); // Use the service for serviceVendor lookup

const path = require('path');
const logger = require('morgan');
const cookieParser = require('cookie-parser');
const flash = require('express-flash');
const bodyParser = require('body-parser');
const moment = require('moment');

const app = express();
app.set('trust proxy', true);

// MongoDB configuration
const mongoose = require('mongoose');
const connectRetry = function() {
  mongoose.connect(config.mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    useCreateIndex: true,
    poolSize: 500,
  }, (err) => {
    if (err) {
      console.log('Mongoose connection error:', err);
      setTimeout(connectRetry, 5000);
    }
  });
}
connectRetry();

// Set up the view engine
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

// Enable sessions using encrypted cookies
app.use(cookieParser(config.secret));
app.use(
  session({
    cookie: {maxAge: 60000},
    secret: config.secret,
    signed: true,
    resave: true,
  })
);
// Set up flash messages
app.use(flash());

// Set up useful middleware
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.use(express.static(path.join(__dirname, 'public')));

// Use API Key strategy with Passport
passport.use(new ApiKeyStrategy(
  { header: 'Authorization', prefix: 'Api-Key ' },
  true,
  async (apiKey, done) => {
    try {
      // Delegate the responsibility of finding the user to AuthService
      const serviceVendor = await AuthService.findByApiKey(apiKey);
      if (!serviceVendor) {
        return done(null, false);
      }
      return done(null, serviceVendor);
    } catch (err) {
      return done(err);
    }
  }
));

// Initialize Passport and restore any existing authentication state
app.use(passport.initialize());
app.use(passport.session());

// Middleware that exposes the serviceVendor object (if any) to views
app.use((req, res, next) => {
  if (req.user) {
    res.locals.serviceVendor = req.user;
  }
  next();
});
app.locals.moment = moment;

// CRUD routes for the serviceVendor signup and dashboard
app.use('/serviceVendors', require('./routes/serviceVendors/serviceVendors'));
app.use('/serviceVendors/stripe', require('./routes/serviceVendors/stripe'));

// API routes for offerings and customers used by the mobile app
app.use('/api/settings', require('./routes/api/settings'));
app.use('/api/offerings', require('./routes/api/offerings'));
app.use('/api/customers', require('./routes/api/customers'));

// Index page for domopay
app.get('/', (req, res) => {
  res.render('index');
});

// Respond to a health check
app.get('/health', (req, res) => {
  res.type('text').send('ok');
});

// Catch 404 errors and forward to error handler
app.use((req, res, next) => {
  res.status(404).render('404');
});

// Development error handler: will print stacktrace
if (app.get('env') === 'development') {
  app.use((err, req, res) => {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err,
    });
  });
}

// Production error handler: no stacktraces will be leaked to user
app.use((err, req, res) => {
  console.log(err);
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: {},
  });
});

// Start the server on the correct port
const server = app.listen(process.env.PORT || config.port, () => {
  console.log('🚀 domopay server started:', config.publicDomain);
});
