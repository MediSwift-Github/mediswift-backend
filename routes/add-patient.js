const express = require('express');
const router = express.Router();
const Patient = require('../database/patient-schema');// Adjust the path as necessary


// POST endpoint for adding a new patient
router.post('/api/newpatient', async (req, res) => {
    try {
        const { name, mobile_number, medical_history, hospitalId } = req.body;

        console.log(hospitalId);

        // Create a new patient document. MongoDB will automatically assign a unique _id.
        const newPatient = new Patient({
            name,
            mobile_number,
            medical_history,
            hospitalId
        });

        // Save the new patient to the database
        await newPatient.save();

        // Send the newly created patient document back to the client, including the MongoDB-generated _id
        res.status(201).send(newPatient);
    } catch (error) {
        console.error(error);
        // If there's an error (e.g., validation failure or database connection issue), send an appropriate response
        res.status(400).send(error.message);
    }
});

module.exports = router;
