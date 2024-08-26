const express = require('express');
const router = express.Router();
const axios = require('axios');  // Make sure axios is imported
const Queue = require('../database/queue-schema');  // Adjust the path as necessary
const TempQueue = require('../database/temp-queue');  // Import the TempQueue schema

// Function to send a template message
const sendTemplateMessage = async (to, templateName) => {
    if (!to) {
        throw new Error('Recipient number is required.');
    }

    const videoLink = 'https://drive.google.com/uc?export=download&id=13fvsClbScVkuFZWOOwWnsVKwoU0Un80t';  // Define video link

    const data = {
        to: to,
        recipient_type: 'individual',
        type: 'template',
        template: {
            language: {
                policy: 'deterministic',
                code: 'en'
            },
            name: templateName,
            components: [
                {
                    type: 'header',
                    parameters: [
                        {
                            type: 'video',
                            video: {
                                link: videoLink
                            }
                        }
                    ]
                }
            ]
        }
    };

    try {
        const response = await axios.post(process.env.API_URL, data, {
            headers: {
                'Authorization': `Bearer ${process.env.BEARER_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('Template message sent:', response.data);
        return response.data;
    } catch (error) {
        console.error('Error sending template message:', error.response ? error.response.data : error.message);
        throw new Error('Failed to send template message.');
    }
};

// Define the API endpoint that Sarv will call
router.get('/api/missed-call', async (req, res) => {
    const customerData = req.query;
    const callerNumber = customerData.Caller;

    console.log('Received missed call from number:', callerNumber);

    try {
        // Step 1: Check if the number is already in the temp queue
        const isInTempQueue = await isNumberInTempQueue(callerNumber);
        if (isInTempQueue) {
            console.log(`Number ${callerNumber} is already in the temporary queue. Ignoring missed call.`);
            return res.status(200).send('Number is already in the temporary queue.');
        }

        // Step 2: Send the language selection template
        await sendTemplateMessage(callerNumber, 'language_selection');

        // Step 3: Set the fromMissedCall flag in the temporary queue
        await setMissedCallFlagInTempQueue(callerNumber);
        console.log(`Missed call flag set for ${callerNumber} in temporary queue.`);

        res.status(200).send('Language selection template sent.');
    } catch (error) {
        console.error('Error handling missed call:', error);
        res.status(500).send('Failed to handle missed call.');
    }
});

const isNumberInTempQueue = async (mobileNumber) => {
    try {
        console.log("Checking if mobile number is in temporary queue:", mobileNumber);
        const tempQueueEntry = await TempQueue.findOne({ patientMobileNumber: mobileNumber }).exec();
        console.log("Temp queue entry found:", JSON.stringify(tempQueueEntry, null, 2));  // Log the temp queue entry result
        return !!tempQueueEntry; // Returns true if an entry is found, otherwise false
    } catch (error) {
        console.error("Error checking mobile number in temporary queue:", error);
        return false;
    }
};

const setMissedCallFlagInTempQueue = async (callerNumber) => {
    try {
        await TempQueue.updateOne(
            { patientMobileNumber: callerNumber },
            { $set: { fromMissedCall: true } },
            { upsert: true }  // Create a new record if one doesn't exist
        );
        console.log(`fromMissedCall flag set for ${callerNumber} in temporary queue.`);
    } catch (error) {
        console.error(`Failed to set fromMissedCall flag for ${callerNumber} in temporary queue:`, error);
    }
};

module.exports = router;
