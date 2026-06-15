const fs = require('fs');
const path = require('path');
const { getDocumentsDir } = require('../runtime-paths');

class ListingFeeConfigStore {
  constructor({ documentsDir } = {}) {
    this.documentsDir = documentsDir || getDocumentsDir();
    this.configPath = path.join(this.documentsDir, 'BidKing', 'listing-fee-config.json');
  }

  readConfig() {
    try {
      if (!fs.existsSync(this.configPath)) return null;

      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      const listingFeeRate = parseRate(parsed?.listingFeeRate);
      const tradeTaxRate = parseRate(parsed?.tradeTaxRate);
      if (listingFeeRate === null || tradeTaxRate === null) return null;

      return {
        listingFeeRate,
        tradeTaxRate,
        source: String(parsed.source || 'unknown'),
      };
    } catch {
      return null;
    }
  }
}

function parseRate(rawValue) {
  let value;
  if (typeof rawValue === 'number') {
    value = rawValue;
  } else if (typeof rawValue === 'string' && rawValue.trim() !== '') {
    value = Number(rawValue);
  } else {
    return null;
  }

  return Number.isFinite(value) && value >= 0 && value < 1 ? value : null;
}

module.exports = {
  ListingFeeConfigStore,
};
