const express = require('express');
const router = express.Router();
const cors = require('cors');
const mongoose = require('mongoose');
const Medication = require('../database/medication'); // Adjust the path to your medication schema

// Autocomplete route for medications
router.get('/api/autocomplete', cors(), async (req, res) => {
    try {
        console.log("Received request for autocomplete");
        console.log("Request headers:", req.headers);  // Log the request headers
        console.log("Request origin:", req.headers.origin);  // Log the request origin

        const { query } = req.query;
        console.log("Query parameter received:", query);  // Log the query parameter

        if (!query) {
            console.log("No query provided, returning 400 error.");
            return res.status(400).send('Query is required');
        }

        // Use MongoDB Atlas Search with the "prescription_autocomplete" index and autocomplete feature
        const medications = await Medication.aggregate([
            {
                $search: {
                    "index": "prescription_autocomplete",  // Make sure to specify your index here
                    "autocomplete": {
                        "query": query,
                        "path": "product_name",  // Ensure you are searching within the product_name field
                        "fuzzy": {
                            "maxEdits": 1  // Allow for minor typos in the query
                        }
                    }
                }
            },
            {
                $limit: 10  // Limit to 10 suggestions
            },
            {
                $project: {
                    product_name: 1,
                    Instructions: 1,  // Include Instructions in the results
                    medicine_type: 1  // Include medicine_type in the results
                }
            }
        ]);

        console.log("Medications found:", medications.length);  // Log the number of medications found
        medications.forEach(med => {
            console.log(`Medicine: ${med.product_name}, Instructions: ${med.Instructions}, Type: ${med.medicine_type}`);
        });

        res.status(200).json(medications);
    } catch (error) {
        console.error("Error in autocomplete route:", error);  // Log the error
        res.status(500).send(error.message);
    }
});

module.exports = router;
