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
const { transcribeAudio } = require('../bot/gptChat');
const TempQueue  = require("../database/temp-queue"); // Adjust the path as necessary
const User = require('../database/users');  // Import the User model

const SESSION_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds
const SHORT_MESSAGE_THRESHOLD = 20; // Define what constitutes a short message (in characters)
const INACTIVITY_TIMEOUT = 5000; // 3 seconds
const MONITORING_PHASE_DURATION = 120000; // 2 minutes in milliseconds

const messageBuffers = {}; // Temporary storage for messages
const inactivityTimers = {}; // Timers for inactivity detection
const userBehavior = {}; // To track user behavior
const conversationState = {};

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

    const videoLink = 'https://drive.google.com/uc?export=download&id=13fvsClbScVkuFZWOOwWnsVKwoU0Un80t';

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



function initializeHistory(from, language = null, fromMissedCall = false) {
    if (!medicalHistory[from]) {
        medicalHistory[from] = [];
    }
    if (!conversationHistory[from]) {
        conversationHistory[from] = [];  // Initialize as an array for chat history
        conversationState[from] = {      // Separate object to track conversation state
            language: language,
            name: null,
            hospitalCode: null,
            fromMissedCall: fromMissedCall,
            currentStep: 'name'  // Track the current step for the missed call flow
        };
    } else if (language) {
        conversationState[from].language = language;
    }

}



async function handleGPTResponse(from, text) {
    let queueRecord = await Queue.findOne({ patientMobileNumber: from }).populate('patientId').exec();
    if (!queueRecord) {
        return { success: false, error: 'No queue record found for this number.' };
    }

    let patient = queueRecord.patientId;
    if (!patient) {
        return { success: false, error: 'Patient record not found.' };
    }

    const medicalHistory = patient.medical_history;

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

        // Check if the user has an existing language preference
        const existingLanguage = conversationHistory[from] ? conversationHistory[from].language : null;

        if (language && existingLanguage && language !== existingLanguage) {
            // New language selected, reset the conversation
            console.log(`User ${from} switched to a new language: ${language}. Resetting the conversation.`);

            // Clear session data
            delete sessionStartTimes[from];
            delete conversationHistory[from];
            delete lastMessageIds[from];
            delete messageBuffers[from];
            clearTimeout(inactivityTimers[from]);
            delete inactivityTimers[from];
            delete userBehavior[from];
            delete sessionStates[from];

            // Initialize history with the new language
            initializeHistory(from, language);
        }

        if (language) {
            console.log(`User ${from} switched to language: ${language}`);
            initializeHistory(from, language); // Ensure history is initialized with the new language
        }

        // If the conversation was initiated by a missed call
        const isInTempQueue = await isMobileNumberInTempQueue(from);
        if (isInTempQueue) {
            if (!conversationHistory[from].currentStep) {
                conversationHistory[from].currentStep = 'name';
                await sendTemplateMessage(from, 'name');
                return res.status(200).send({ success: true, message: 'Language selected, requesting name.' });
            }

            if (conversationHistory[from].currentStep === 'name') {
                conversationHistory[from].name = text;
                console.log("Name received: " + text);
                conversationHistory[from].currentStep = 'hospitalId';
                await sendTemplateMessage(from, 'hospitalId');
                return res.status(200).send({ success: true, message: 'Name received, requesting hospital ID.' });
            }

            if (conversationHistory[from].currentStep === 'hospitalId') {
                const hospitalCode = text;  // Get the hospital code from user input
                try {
                    // Find the corresponding hospital ID based on the hospital code
                    const user = await User.findOne({ hospital_code: hospitalCode }).exec();

                    if (!user) {
                        console.error('No hospital found with the provided hospital code:', hospitalCode);
                        return res.status(400).send({ error: 'Invalid hospital code provided.' });
                    }

                    // Save the hospital ID in the conversation history
                    conversationHistory[from].hospitalId = user.hospital_id;
                    console.log("Hospital ID found and saved: " + user.hospital_id);

                    // Add the patient to the database
                    const patientId = await addPatientToDatabase(from);
                    console.log('Patient ID:', patientId);

                    // Add the patient to the queue
                    await addPatientToQueue(patientId, user.hospital_id);

                    // Reset currentStep as the initial steps are complete
                    conversationHistory[from].currentStep = null;

                    // Ensure all conversation metadata is transferred correctly
                    conversationHistory[from].name = conversationState[from].name;
                    conversationHistory[from].hospitalId = user.hospital_id;
                    conversationHistory[from].language = conversationState[from].language;

                    // Set session start time and last message ID
                    if (!sessionStartTimes[from]) {
                        sessionStartTimes[from] = new Date();
                        lastMessageIds[from] = messageId;

                        setTimeout(() => {
                            endSessionActions(from, lastMessageIds[from]);
                        }, SESSION_DURATION);
                    }

                    // Initialize medical history
                    if (!medicalHistory[from]) {
                        medicalHistory[from] = []; // Initialize if not already set
                    }
                    // Remove the country code from the mobile number before deleting from TempQueue
                    const mobileNumberWithoutCountryCode = removeCountryCode(from);

                    await TempQueue.deleteOne({ patientMobileNumber: mobileNumberWithoutCountryCode });
                    console.log('Patient removed from TempQueue:', mobileNumberWithoutCountryCode);
                    // Transition to normal chat flow
                    await processAndRespond(from, text);  // Start the session processing

                    return res.status(200).send({ success: true, message: 'Hospital ID received, patient added to queue, and session started.' });
                } catch (error) {
                    console.error('Error processing hospital code:', error);
                    return res.status(500).send({ error: 'Failed to process hospital code.' });
                }
            }
        }
        // Existing logic for handling sessions not initiated by a missed call
        if (!sessionStartTimes[from]) {
            const isInQueue = await isMobileNumberInQueue(from);

            if (!isInQueue && !isInTempQueue) {
                console.log(`Number ${from} is not in queue or temp queue. Ignoring message.`);
                return res.status(200).send({ success: true, message: 'Number not in queue or temp queue. Ignoring message.' });
            }

            sessionStartTimes[from] = new Date();
            lastMessageIds[from] = messageId;

            setTimeout(() => {
                endSessionActions(from, lastMessageIds[from]);
            }, SESSION_DURATION);
        } else {
            lastMessageIds[from] = messageId;
        }

        if (!userBehavior[from]) {
            userBehavior[from] = {
                shortMessageCount: 0,
                longMessageCount: 0,
                isMonitoring: true,
                aggregationEnabled: true,
                startTime: Date.now()
            };
        }

        const user = userBehavior[from];

        if (user.isMonitoring) {
            if (text && text.length < SHORT_MESSAGE_THRESHOLD) {
                user.shortMessageCount++;
            } else {
                user.longMessageCount++;
            }

            if (Date.now() - user.startTime > MONITORING_PHASE_DURATION) {
                user.isMonitoring = false;
                if (user.longMessageCount > user.shortMessageCount) {
                    user.aggregationEnabled = false;
                }
            }
        }

        let userMessage = text;

        if (audio) {
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

            const transcriptionResult = await transcribeAudio(audioFilePath);
            if (!transcriptionResult.success) {
                console.error('Transcription failed:', transcriptionResult.error);
                fs.unlinkSync(audioFilePath); // Cleanup audio file immediately
                return res.status(500).send({ error: 'Failed to transcribe audio message.' });
            }

            userMessage = transcriptionResult.content; // Use transcription as the user message
            fs.unlinkSync(audioFilePath); // Cleanup audio file immediately
        }

        if (user.aggregationEnabled) {
            if (!messageBuffers[from]) {
                messageBuffers[from] = [];
            }

            messageBuffers[from].push(userMessage);

            if (userMessage.length < SHORT_MESSAGE_THRESHOLD) {
                if (inactivityTimers[from]) {
                    clearTimeout(inactivityTimers[from]);
                }

                inactivityTimers[from] = setTimeout(() => {
                    processAggregatedMessages(from);
                }, INACTIVITY_TIMEOUT);
            } else {
                if (inactivityTimers[from]) {
                    clearTimeout(inactivityTimers[from]);
                }
                await processAggregatedMessages(from);
            }
        } else {
            await processAndRespond(from, userMessage);
        }

        return res.status(200).send({ success: true });

    } catch (error) {
        console.error('Error processing incoming message:', error);
        return res.status(500).send({ error: 'Internal Server Error', details: error.message });
    }
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
    delete lastMessageIds[chatId];
    delete messageBuffers[chatId];
    clearTimeout(inactivityTimers[chatId]);
    delete inactivityTimers[chatId];
    delete userBehavior[chatId];
    delete sessionStates[chatId];

    setTimeout(() => {
        delete sessionStates[chatId];
        console.log(`Session state for ${chatId} has been cleared after one hour.`);
    }, 60 * 60 * 1000);  // 1 hour in milliseconds
}

const processAggregatedMessages = async (from) => {
    if (!messageBuffers[from] || messageBuffers[from].length === 0) {
        return;
    }

    const aggregatedMessage = messageBuffers[from].join(' ');
    messageBuffers[from] = []; // Clear buffer after processing
    delete inactivityTimers[from];

    await processAndRespond(from, aggregatedMessage);
};

const processAndRespond = async (from, message) => {
    console.log(`Processing message for ${from}: ${message}`);

    const language = conversationHistory[from].language || 'English';
    const { success, content, error } = await chatWithGPT(message, conversationHistory[from], medicalHistory[from], language);

    if (success) {
        console.log(`Sending reply to ${from} in language: ${language}`);
        await sendReply(from, content, lastMessageIds[from]);
    } else {
        console.error('Error in chatWithGPT:', error);
    }
};
const isMobileNumberInTempQueue = async (mobileNumber) => {
    try {
        // Remove the country code "91" if it's present
        const mobileNumberWithoutCountryCode = mobileNumber.startsWith('91')
            ? mobileNumber.slice(2)
            : mobileNumber;

        console.log("Checking if mobile number is in temporary queue:", mobileNumberWithoutCountryCode);
        const tempQueueEntry = await TempQueue.findOne({ patientMobileNumber: mobileNumberWithoutCountryCode }).exec();
        console.log("Temp queue entry found:", JSON.stringify(tempQueueEntry, null, 2));  // Log the temp queue entry result
        return !!tempQueueEntry; // Returns true if an entry is found, otherwise false
    } catch (error) {
        console.error("Error checking mobile number in temporary queue:", error);
        return false;
    }
};


const sendTemplateMessage = async (to, templateName) => {
    const languageCode = conversationHistory[to].language === 'English' ? 'en' : 'hi';
    const templateMap = {
        "name": {
            "en": "name_english",
            "hi": "name_request_hindi"
        },
        "hospitalId": {
            "en": "hospitalid_request_english",
            "hi": "hosptialid_hindi"
        }
    };

    const data = {
        to: to,
        recipient_type: 'individual',
        type: 'template',
        template: {
            language: {
                policy: 'deterministic',
                code: languageCode
            },
            name: templateMap[templateName][languageCode],
            components: []
        }
    };

    try {
        const response = await axios.post(`${process.env.API_URL}`, data, {
            headers: {
                'Authorization': `Bearer ${process.env.BEARER_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`${templateMap[templateName][languageCode]} template sent:`, response.data);
    } catch (error) {
        console.error(`Error sending ${templateMap[templateName][languageCode]} template:`, error.response ? error.response.data : error.message);
        throw new Error(`Failed to send ${templateMap[templateName][languageCode]} template.`);
    }
};

const addPatientToDatabase = async (from) => {
    const { name, hospitalId } = conversationHistory[from];

    const patientData = {
        name,
        mobile_number: from,
        medical_history: [], // Empty array as a placeholder
        hospitalId
    };

    try {
        const response = await axios.post(`${process.env.BASE_URL}/api/newpatient`, patientData, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const newPatient = response.data;
        console.log('Patient added successfully:', newPatient);
        return newPatient._id;
    } catch (error) {
        console.error('Error adding patient to the database:', error.response ? error.response.data : error.message);
        throw new Error('Failed to add patient to the database.');
    }
};

const addPatientToQueue = async (patientId, hospitalId) => {
    try {
        const queueData = {
            patientId,
            hospitalId,
            skipTemplate: true // Skip sending the template again
        };

        const response = await axios.post(`${process.env.BASE_URL}/api/queue/add`, queueData, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log('Patient added to the queue successfully:', response.data);
    } catch (error) {
        console.error('Error adding patient to the queue:', error.response ? error.response.data : error.message);
        throw new Error('Failed to add patient to the queue.');
    }
};
const removeCountryCode = (mobileNumber) => {
    return mobileNumber.startsWith('91') ? mobileNumber.slice(2) : mobileNumber;
};
module.exports = router;
