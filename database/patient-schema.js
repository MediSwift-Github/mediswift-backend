const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const patientSchema = new Schema({
    name: { type: String, required: true },
    mobile_number: { type: String, required: true },
    medical_history: [{
        visitDate: { type: Date, default: Date.now },
        notes: mongoose.Schema.Types.Mixed
    }],
    sessionSummaries: [{ // New field to store chat session summaries
        summaryDate: { type: Date, default: Date.now },
        summaryContent: mongoose.Schema.Types.Mixed, // This will store the JSON summary
        transcription: { type: String, default: '' },
        healthRecord: { type: mongoose.Schema.Types.Mixed, default: {} },
        patientHandout: { type: mongoose.Schema.Types.Mixed, default: {} },
        prescriptions: [{
            srNo: { type: Number },
            drug: { type: String, index: true },
            dosagePerDay: { type: String },
            days: { type: Number },
            frequency: { type: String },
            notes: { type: String }
        }]
    }],
    hospitalId: { type: Schema.Types.ObjectId, ref: 'Hospital', required: true } // Add this line
}, { timestamps: true }); // Optionally add timestamps to automatically get createdAt and updatedAt fields

const Patient = mongoose.model('Patient', patientSchema,'patients_collection');

module.exports = Patient;
