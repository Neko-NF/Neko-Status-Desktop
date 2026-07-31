const crypto = require('crypto');

const runtimeSessionId = crypto.randomUUID();

module.exports = Object.freeze({ runtimeSessionId });
