const mongoose = require('mongoose');

const queueSchema = new mongoose.Schema({
    patientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Patient',
        required: true
    },
    patientName: { // Adding patientName
        type: String,
        required: true
    },
    patientMobileNumber: { // Adding patientMobileNumber
        type: String,
        required: true
    },
    queueEntryTime: {
        type: Date,
        default: Date.now,
        required: true
    },
    status: {
        type: String,
        enum: ['Chatting', 'Completed', 'End Chat'],
        default: 'Chatting'
    },
    hospitalId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
});

const Queue = mongoose.model('Queue', queueSchema);

module.exports = Queue;
