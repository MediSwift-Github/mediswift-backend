const express = require('express');
const router = express.Router();
const Patient = require('../database/patient-schema'); // Adjust the path as necessary

// GET endpoint for searching a patient by name
router.get('/api/searchpatient', async (req, res) => {
    try {
        const { name, hospitalId } = req.query; // Extract the name and hospitalId query parameters
        if (!hospitalId) {
            return res.status(400).send('hospitalId query parameter is required.');
        }

        // Use a case-insensitive regular expression to find patients whose names start with the provided input
        const searchPattern = new RegExp('^' + name, 'i');
        const patients = await Patient.find({ name: { $regex: searchPattern }, hospitalId }, 'name _id mobile_number'); // Project only name, _id, and mobile_number

        // Send the list of matching patient names and their _id
        res.status(200).send(patients);
    } catch (error) {
        console.error(error);
        // Handle errors, like a missing query parameter or a database issue
        res.status(500).send(error.message);
    }
});

module.exports = router;
