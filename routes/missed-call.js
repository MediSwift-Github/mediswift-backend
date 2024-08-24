const express = require('express');
const router = express.Router();
const axios = require('axios');  // Make sure axios is imported
const Queue = require('../database/queue-schema');  // Adjust the path as necessary
const { setConversationFlag } = require('../bot/whatsappbot');  // Import the function

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
        // Step 1: Check if the number is already in the queue
        const isInQueue = await isMobileNumberInQueue(callerNumber);
        if (isInQueue) {
            console.log(`Number ${callerNumber} is already in the queue. Ignoring missed call.`);
            return res.status(200).send('Number is already in the queue.');
        }

        // Step 2: Send the language selection template
        await sendTemplateMessage(callerNumber, 'language_selection');

        // Step 3: Set the fromMissedCall flag using the utility function
        setConversationFlag(callerNumber, 'fromMissedCall', true);

        res.status(200).send('Language selection template sent.');
    } catch (error) {
        console.error('Error handling missed call:', error);
        res.status(500).send('Failed to handle missed call.');
    }
});
const isMobileNumberInQueue = async (mobileNumber) => {
    try {
        console.log("Checking if mobile number is in queue:", mobileNumber);
        const queueEntry = await Queue.findOne({ patientMobileNumber: mobileNumber }).exec();
        console.log("Queue entry found:", JSON.stringify(queueEntry, null, 2));  // Log the queue entry result
        return !!queueEntry; // Returns true if an entry is found, otherwise false
    } catch (error) {
        console.error("Error checking mobile number in queue:", error);
        return false;
    }
};


module.exports = router;
