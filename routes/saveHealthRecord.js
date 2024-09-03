const express = require('express');
const router = express.Router();
const Patient = require('../database/patient-schema');
const { convertMedicalSummaryToNotes } = require('../bot/gptChat');  // Ensure gptChat is properly required

// Endpoint to save the health record of a patient and update medical history
router.post('/api/saveHealthRecord', async (req, res) => {
    const { patientId, healthRecord, summaryDate } = req.body;

    if (!patientId || !healthRecord || !summaryDate) {
        return res.status(400).send('Missing patient ID, health record data, or summary date.');
    }

    try {
        // Store session summary
        await storeHealthRecord(patientId, healthRecord, summaryDate);

        // Update medical history
        await updateMedicalHistory(patientId, healthRecord);

        res.json({ status: 'success', message: 'Health Record and Medical History updated successfully!', patientId: patientId });
    } catch (error) {
        console.error("Failed to update health record or medical history:", error);
        res.status(500).send('Failed to update health record or medical history.');
    }
});
async function storeHealthRecord(patientId, healthRecord, summaryDate) {
    try {
        const dateStart = new Date(summaryDate);
        const dateEnd = new Date(summaryDate);
        dateEnd.setDate(dateEnd.getDate() + 1);

        // Try to find the session summary first
        const existingSummary = await Patient.findOne({
            _id: patientId,
            'sessionSummaries.summaryDate': {
                $gte: dateStart,
                $lt: dateEnd
            }
        });

        if (existingSummary) {
            // If summary exists, update the health record
            await Patient.updateOne({
                _id: patientId,
                'sessionSummaries.summaryDate': {
                    $gte: dateStart,
                    $lt: dateEnd
                }
            }, {
                $set: { 'sessionSummaries.$.healthRecord': healthRecord }
            });
            console.log("Successfully updated existing health record.");
        } else {
            // If summary does not exist, create a new summary entry
            await Patient.findByIdAndUpdate(patientId, {
                $push: { 'sessionSummaries': { summaryDate, healthRecord } }
            }, { new: true });
            console.log("Successfully created and stored new health record.");
        }
    } catch (error) {
        console.error("Error storing health record:", error);
        throw error; // Rethrow to be caught by the calling function
    }
}


async function updateMedicalHistory(patientId, healthRecord) {
    try {
        const patient = await Patient.findById(patientId);
        if (!patient) {
            throw new Error('Patient not found');
        }

        const notes = await convertMedicalSummaryToNotes(healthRecord, patient.medical_history);
        if (!notes) {
            throw new Error('Failed to convert health record to notes');
        }

        const medicalEntry = {
            visitDate: new Date(), // use current date or extract from healthRecord if applicable
            notes: notes
        };

        await Patient.findByIdAndUpdate(patientId, {
            $push: { 'medical_history': medicalEntry }
        });
    } catch (error) {
        console.error("Failed to update medical history:", error);
        throw error; // Rethrow to be caught by the calling function
    }
}

module.exports = router;
