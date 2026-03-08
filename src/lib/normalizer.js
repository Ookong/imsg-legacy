const { parsePhoneNumberFromString } = require('libphonenumber-js');

/**
 * PhoneNumberNormalizer - Normalize phone numbers to E.164 format
 * Based on PhoneNumberNormalizer.swift from the original imsg project
 */
class PhoneNumberNormalizer {
  /**
   * Normalize phone number to E.164 format
   * If it's an email, return as-is
   */
  normalize(phoneNumber, region = 'US') {
    // If it contains @, it's an email
    if (phoneNumber.includes('@')) {
      return phoneNumber;
    }

    try {
      const phoneNumberObj = parsePhoneNumberFromString(phoneNumber, region);
      if (phoneNumberObj && phoneNumberObj.isValid()) {
        return phoneNumberObj.format('E.164');
      }
    } catch (error) {
      // Parsing failed, return original value
    }

    return phoneNumber;
  }
}

module.exports = PhoneNumberNormalizer;
