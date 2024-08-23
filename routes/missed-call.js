const express = require('express');
const router = express.Router();

// Define the API endpoint that Sarv will call
router.get('/api/missed-call', (req, res) => {
    // Assuming Sarv sends data as query parameters
    const customerData = req.query;

    // Log the received data
    console.log('Received missed call data:', customerData);

    // Respond to Sarv with a success message
    res.send('Data received successfully');
});

module.exports = router;
