const express = require('express');
const router = express.Router();// and Queue model is imported
const mongoose = require('mongoose');
const Queue = require('../database/queue-schema');
const Patient =require('../database/patient-schema');
const axios = require('axios');

const baseUrl = process.env.NODE_ENV === 'production' ? process.env.BASE_URL : `http://localhost:${process.env.PORT || 3000}`;



// Endpoint to add a patient to the queue
router.post('/api/queue/add', async (req, res) => {
    try {
        const { patientId } = req.body;

        // First, check if the patient already exists in the queue
        const existingEntry = await Queue.findOne({ patientId });
        if (existingEntry) {
            return res.status(400).send('Patient is already in the queue.');
        }

        // Then, find the patient by ID to get their details
        const patient = await Patient.findById(patientId);
        if (!patient) {
            return res.status(404).send('Patient not found.');
        }

        // Now that we have the patient's details, create a new queue entry with them
        const queueEntry = new Queue({
            patientId,
            patientName: patient.name, // Use the patient's name from the Patient document
            patientMobileNumber: patient.mobile_number // Use the patient's mobile number from the Patient document
        });

        // Save the queue entry
        await queueEntry.save();

        const localBaseUrl = `http://localhost:${process.env.PORT || 3000}`;

        await axios.post(`${baseUrl}/send-template-message`, {
            to: patient.mobile_number // Use the patient's mobile number
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.BEARER_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        res.status(201).send(queueEntry);
    } catch (error) {
        console.error(error);
        res.status(400).send(error.message);
    }
});

// Endpoint to remove a patient from the queue or clear the entire queue
router.delete('/api/queue/remove', async (req, res) => {
    const { patientId, clearAll } = req.query;

    try {
        if (clearAll === 'true') {
            // Clear the entire queue
            await Queue.deleteMany({});
            console.log('All queue entries have been removed');
            return res.status(200).send('All queue entries have been removed.');
        } else if (patientId) {
            // Remove specific patient from the queue
            const result = await Queue.findOneAndDelete({ patientId });
            if (!result) {
                return res.status(404).send('Patient not found in queue.');
            }
            console.log('Patient removed from the queue:', result);
            return res.status(200).send('Patient removed from the queue.');
        } else {
            return res.status(400).send('Please provide a patientId or set clearAll to true.');
        }
    } catch (error) {
        console.error('Error in removing queue entries:', error);
        res.status(500).send('Error in removing queue entries');
    }
});


// Endpoint to view the queue
router.get('/api/queue', async (req, res) => {
    try {
        const queueEntries = await Queue.find({}).sort({ queueEntryTime: 1 }).exec();
        if (queueEntries.length === 0) {
            console.log('No queue entries found');
            return res.status(404).send('No queue entries found.');
        }
        console.log('Queue entries retrieved:', queueEntries);
        res.status(200).send(queueEntries);
    } catch (error) {
        console.error('Error retrieving queue entries:', error);
        res.status(500).send('Error retrieving queue entries');
    }
});
// Endpoint to update the status of a queue entry
router.patch('/api/queue/update/:id', async (req, res) => {
    try {
        const { status } = req.body;
        const { id } = req.params;

        const updatedEntry = await Queue.findByIdAndUpdate(id, { status }, { new: true });

        if (!updatedEntry) {
            return res.status(404).send('Queue entry not found.');
        }

        res.status(200).send(updatedEntry);
    } catch (error) {
        console.error(error);
        res.status(400).send(error.message);
    }
});

// New endpoint to fetch session summaries for a specific patient and day
router.get('/api/patients/:patientId/summaries', async (req, res) => {
    const { patientId } = req.params;
    let { date } = req.query; // Date in 'YYYY-MM-DD' format, optional

    try {
        // Default to today's date if no date is provided
        if (!date) {
            date = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
        }

        const patient = await Patient.findById(patientId);
        if (!patient) {
            return res.status(404).send('Patient not found.');
        }

        // Assuming 'sessionSummaries' field exists and contains an array of summaries with a 'summaryDate'
        // Convert date to start of the day and next day in UTC for comparison
        const startDate = new Date(date);
        startDate.setUTCHours(0, 0, 0, 0);
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 1);

        const summariesForDate = patient.sessionSummaries.filter(summary => {
            const summaryDate = new Date(summary.summaryDate);
            return summaryDate >= startDate && summaryDate < endDate;
        });

        res.json(summariesForDate);
    } catch (error) {
        console.error(error);
        res.status(500).send('An error occurred while retrieving patient summaries.');
    }
});

module.exports = router;

