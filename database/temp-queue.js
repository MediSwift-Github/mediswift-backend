const mongoose = require('mongoose');

const tempQueueSchema = new mongoose.Schema({
    patientMobileNumber: { type: String, required: true },
    fromMissedCall: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now, expires: '10m' } // Automatically delete after 5 minutes
});

const TempQueue = mongoose.model('TempQueue', tempQueueSchema);

module.exports = TempQueue;
