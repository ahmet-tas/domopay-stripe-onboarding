const ServiceVendor = require('../models/serviceVendor');

// AuthService: Handles authentication-related operations
class AuthService {
  // Method to find a user by their API key
  static async findByApiKey(apiKey) {
    return await ServiceVendor.findOne({ apiKey });
  }

  // Add other authentication-related methods here if needed
}

module.exports = AuthService;
