const axios = require('axios');
const bodyParser = require('body-parser');
require('dotenv').config();
const OpenAI = require("openai");
const express = require('express');
const router = express.Router();
const { chatWithGPT, summarizeConversation, convertSummaryToJSON } = require('./gptChat');  // Import necessary functions
const { storeSessionSummary } = require("../routes/storeSessionJSON");  // Import the storeSessionSummary function
const Queue = require('../database/queue-schema');  // Import the Queue schema
const Patient = require('../database/patient-schema');  // Import the Patient schema
const userLanguages = require('../database/languageStore');
// Ensure to initialize conversationHistory
const conversationHistory = {};
const medicalHistory = {};
const sessionStartTimes = {}; // Add this line
const lastMessageIds = {};  // Add this line
const baseUrl = process.env.NODE_ENV === 'production' ? process.env.BASE_URL : `http://localhost:${process.env.PORT || 3000}`;
const sessionStates = {}; // Add this line to track session states
const fs = require('fs');
const path = require('path');
const { transcribeAudio } = require('../bot/gptChat'); // Adjust the path as necessary

const SESSION_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds


const isMobileNumberInQueue = async (mobileNumber) => {
    try {
        console.log("Checking if mobile number is in queue:", mobileNumber);
        const queueEntry = await Queue.findOne({ patientMobileNumber: mobileNumber }).exec();
        console.log("Queue entry found:", queueEntry);
        return !!queueEntry; // Returns true if an entry is found, otherwise false
    } catch (error) {
        console.error("Error checking mobile number in queue:", error);
        return false;
    }
};



// Add this new endpoint to send a template message
router.post('/send-template-message', async (req, res) => {
    const { to } = req.body;

    if (!to) {
        return res.status(400).send({ error: 'Recipient number is required.' });
    }

    try {
        const data = {
            to: to,
            recipient_type: 'individual',
            type: 'template',
            template: {
                language: {
                    policy: 'deterministic',
                    code: 'en'
                },
                name: 'language_selection',
                components: []
            }
        };

        const response = await axios.post(process.env.API_URL, data, {
            headers: {
                'Authorization': `Bearer ${process.env.BEARER_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('Template message sent:', response.data);
        res.status(200).send(response.data);
    } catch (error) {
        console.error('Error sending template message:', error.response ? error.response.data : error.message);
        res.status(500).send({ error: 'Failed to send template message.' });
    }
});



// Endpoint to send message
router.post('/send-message', async (req, res) => {
    const { to, body } = req.body;

    if (!to || !body) {
        return res.status(400).send({ error: 'Recipient number and message body are required.' });
    }

    try {
        const data = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: to,
            type: 'text',
            text: {
                preview_url: false,
                body: body
            }
        };

        const response = await axios.post(process.env.API_URL, data, {
            headers: {
                'Authorization': `Bearer ${process.env.BEARER_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('Message sent:', response.data);
        res.status(200).send(response.data);
    } catch (error) {
        console.error('Error sending message:', error.response ? error.response.data : error.message);
        res.status(500).send({ error: 'Failed to send message.' });
    }
});

// Webhook challenge response endpoint
router.get('/webhook', (req, res) => {
    try {
        const challenge = req.query['challange'];
        if (challenge) {
            res.status(200).send(challenge);
        } else {
            res.status(400).send('No challenge parameter found');
        }
    } catch (error) {
        res.status(500).send(error.message);
    }
});

function parseWebhookRequest(req) {
    const entry = req.body.entry ? req.body.entry[0] : null;
    const changes = entry ? entry.changes[0] : null;
    const message = changes ? changes.value.messages[0] : null;
    const from = message ? message.from : null;
    const messageId = message ? message.id : null;
    let text = null;
    let language = null;
    let audio = null;  // Add this line

    if (message && message.type === 'button') {
        text = message.button.text;
        language = text;
    } else if (message && message.text) {
        text = message.text.body;
    } else if (message && message.type === 'audio') {  // Add this block
        audio = message.audio;
    }
    if (from && language) {
        userLanguages[from] = language;
    }

    return { from, text, language, messageId, message, audio };  // Add audio here
}



function initializeHistory(from, language = null) {
    if (!conversationHistory[from]) {
        conversationHistory[from] = [];
    }

    if (!medicalHistory[from]) {
        medicalHistory[from] = [];
    }

    if (language) {
        conversationHistory[from].language = language;
    }
}


async function handleGPTResponse(from, text) {
    // Assuming 'from' can be used to fetch the corresponding queue record
    let queueRecord = await Queue.findOne({ patientMobileNumber: from }).populate('patientId').exec();
    if (!queueRecord) {
        return { success: false, error: 'No queue record found for this number.' };
    }

    // Accessing the patient's medical history
    let patient = queueRecord.patientId;
    if (!patient) {
        return { success: false, error: 'Patient record not found.' };
    }

    const medicalHistory = patient.medical_history;

    // Now you have access to medicalHistory, proceed with handling the GPT response
    const { success, content, conversationHistory: updatedHistory } = await chatWithGPT(text, conversationHistory[from], medicalHistory);

    if (success) {
        conversationHistory[from] = updatedHistory;
        return { success: true, content };
    } else {
        return { success: false, error: content };
    }
}

async function sendReply(to, body, messageId) {
    const data = {
        to: to,
        body: body,
        messageId: messageId
    };

    const localApiUrl = `http://localhost:${process.env.PORT || 3000}/reply-message`;

    const response = await axios.post(`${baseUrl}/reply-message`, data, {
        headers: {
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}

router.post('/webhook', async (req, res) => {
    console.log('Received webhook:', JSON.stringify(req.body, null, 2));

    try {
        const { from, text, language, messageId, message, audio } = parseWebhookRequest(req);

        if (!from) {
            console.error('Invalid message structure:', message);
            return res.status(400).send({ error: 'Invalid message structure.' });
        }

        if (!text && !audio) {
            console.error('No text or audio message found:', message);
            return res.status(400).send({ error: 'No text or audio message found.' });
        }

        if (sessionStates[from] === 'ended') {
            console.log('Ignoring message as session has already ended for:', from);
            return res.status(200).send({ success: true, message: 'Session has already ended. Ignoring message.' });
        }

        initializeHistory(from, language);

        if (!sessionStartTimes[from]) {
            const isInQueue = await isMobileNumberInQueue(from);
            if (!isInQueue) {
                console.log(`Number ${from} is not in queue. Ignoring message.`);
                return res.status(200).send({ success: true, message: 'Number not in queue. Ignoring message.' });
            }

            sessionStartTimes[from] = new Date();
            lastMessageIds[from] = messageId;

            setTimeout(() => {
                endSessionActions(from, lastMessageIds[from]);
            }, SESSION_DURATION);
        } else {
            lastMessageIds[from] = messageId;
        }

        let userMessage = text;

        if (audio) {
            // Fetch and save audio file
            const mediaIdEndpoint = `https://crmapi.com.bot/api/meta/v19.0/${audio.id}`;
            const mediaResponse = await axios({
                method: 'get',
                url: mediaIdEndpoint,
                headers: { 'Authorization': `Bearer ${process.env.BEARER_TOKEN}` },
                responseType: 'arraybuffer'
            });

            const audioDir = path.join(__dirname, 'audio');
            if (!fs.existsSync(audioDir)) {
                fs.mkdirSync(audioDir);
            }
            const audioFilePath = path.join(audioDir, `${audio.id}.ogg`);
            fs.writeFileSync(audioFilePath, mediaResponse.data);

            // Transcribe the audio file
            const transcriptionResult = await transcribeAudio(audioFilePath);
            if (!transcriptionResult.success) {
                console.error('Transcription failed:', transcriptionResult.error);
                fs.unlinkSync(audioFilePath); // Cleanup audio file immediately
                return res.status(500).send({ error: 'Failed to transcribe audio message.' });
            }

            userMessage = transcriptionResult.content; // Use transcription as the user message
            fs.unlinkSync(audioFilePath); // Cleanup audio file immediately
        }

        if (userMessage) {
            const { success, content, error } = await handleGPTResponse(from, userMessage);

            if (success) {
                await sendReply(from, content, messageId);
            } else {
                console.error('Error in chatWithGPT:', error);
                return res.status(500).send({ error: 'Failed to process incoming message.' });
            }
        } else {
            return res.status(400).send({ error: 'No valid user message found after transcription.' });
        }
    } catch (error) {
        console.error('Error processing incoming message:', error);
        return res.status(500).send({ error: 'Internal Server Error', details: error.message });
    }

    return res.status(200).send({ success: true });
});




// Endpoint to reply to a message
router.post('/reply-message', async (req, res) => {
    const { to, body, messageId } = req.body;

    if (!to || !body || !messageId) {
        return res.status(400).send({ error: 'Recipient number, message body, and message ID are required.' });
    }

    try {
        const data = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: to,
            context: {
                message_id: messageId
            },
            type: 'text',
            text: {
                preview_url: false,
                body: body
            }
        };

        const response = await axios.post(process.env.API_URL, data, {
            headers: {
                'Authorization': `Bearer ${process.env.BEARER_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('Reply sent:', response.data);
        res.status(200).send(response.data);
    } catch (error) {
        console.error('Error sending reply:', error.response ? error.response.data : error.message);
        res.status(500).send({ error: 'Failed to send reply.' });
    }
});

// Function to handle end of session actions
async function endSessionActions(chatId, messageId) {
    console.log(`Session for ${chatId} has ended.`);
    console.log(`Complete conversation for chat ID ${chatId}:`, JSON.stringify(conversationHistory[chatId], null, 2));

    // Mark the session as ended
    sessionStates[chatId] = 'ended';

    // Retrieve the conversation history for summarization
    let conversationHistoryForSummary = conversationHistory[chatId].map(message => ({
        role: message.role,  // Use existing role property
        content: message.content
    }));

    // Generate the summary
    const { success, content } = await summarizeConversation(conversationHistoryForSummary);

    if (success) {
        // Send the conversation summary to the user
        // await sendReply(chatId, `Here's a summary of our conversation: ${content}`, messageId);

        // Find the patient record to store the summary
        const queueEntry = await Queue.findOne({ patientMobileNumber: chatId.toString() }).exec();
        if (queueEntry && queueEntry.patientId) {
            const summaryJSON = await convertSummaryToJSON(content);
            await storeSessionSummary(queueEntry.patientId, summaryJSON);
            console.log("Session summary successfully stored in patient's record.");
        } else {
            console.error("No queue entry found for chat ID:", chatId);
        }
    } else {
        await sendReply(chatId, "I couldn't generate a summary due to an error.", messageId);
    }

    // Notify the user that their session has ended
    await sendReply(chatId, "Session Complete. Thank you. I have recorded all your information and forwarded it to the doctor. The doctor will attend to you shortly.\n\n\"धन्यवाद। मैंने आपकी सभी जानकारी दर्ज कर ली है और उसे डॉक्टर को भेज दिया है। डॉक्टर कुछ ही मिनटों में आपसे मिलेंगे।\"", messageId);
    // Clean up session data
    delete sessionStartTimes[chatId];
    delete conversationHistory[chatId];
    delete lastMessageIds[chatId];  // Clean up the last message ID

    setTimeout(() => {
        delete sessionStates[chatId];
        console.log(`Session state for ${chatId} has been cleared after one hour.`);
    }, 60 * 60 * 1000);  // 1 hour in milliseconds
}


module.exports = router;
