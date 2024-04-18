const TelegramBot = require('node-telegram-bot-api');
const { chatWithGPT, summarizeConversation, convertSummaryToJSON } = require('./gptChat');
const Queue = require('../database/queue-schema');
const Patient = require('../database/patient-schema');
const {storeSessionSummary} = require("../routes/storeSessionJSON");
const token = '6966801360:AAF7d2ec-Fq5yWKO9bgwn9N-CtgdbvhIAsk';
const bot = new TelegramBot(token, {polling: true});

// const chatIds = [7125737634, 1039076028, 1948780510];

// Store conversation histories indexed by chat ID
let conversations = {};
let sessionStartTimes = {};

const SESSION_DURATION = 5 * 60 * 1000; // 10 minutes in milliseconds



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


    // Function to handle end of session actions
async function endSessionActions(chatId) {
    console.log(`Session for ${chatId} has ended.`);
    // Log the complete conversation before ending the session
    console.log(`Complete conversation for chat ID ${chatId}:`, JSON.stringify(conversations[chatId], null, 2));

    // Retrieve the conversation history for summarization
    let conversationHistory = conversations[chatId].messages.map(message => ({
        role: message.sender === 'user' ? 'user' : 'assistant',
        content: message.content
    }));

    // Generate the summary
    const { success, content } = await summarizeConversation(conversationHistory);

    if (success) {
        // Send the conversation summary to the user
        await bot.sendMessage(chatId, `Here's a summary of our conversation: ${content}`);

        // Find the queue entry to retrieve patientId
        const queueEntry = await Queue.findOne({ patientMobileNumber: chatId.toString() }).exec();
        if (queueEntry && queueEntry.patientId) {
            // Convert the summary to JSON and store it
            const summaryJSON = await convertSummaryToJSON(content);
            // Now store the summary JSON in the patient's record using the patientId from the queue
            await storeSessionSummary(queueEntry.patientId, summaryJSON);
            console.log("Session summary successfully stored in patient's record.");
        } else {
            console.error("No queue entry found for chat ID:", chatId);
        }
    } else {
        // Handle errors or inability to generate a summary
        await bot.sendMessage(chatId, "I couldn't generate a summary due to an error.");
    }

    // Notify the user that their session has ended
    await bot.sendMessage(chatId, "Your session has ended. Thank you for chatting with us!");
    // Clean up session data
    delete sessionStartTimes[chatId];
}




bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userMessage = msg.text;

    if (userMessage === '/chat') {
        await bot.sendMessage(chatId, `Your chat ID is: ${chatId}`);
        return; // Stop further processing in this callback
    }

    if (!conversations[chatId]) {
        // Initialize conversation and session start time only if this is a new conversation
        conversations[chatId] = { medicalHistory: [], messages: [] };
        sessionStartTimes[chatId] = new Date();

        // Check if the mobile number is in queue and handle accordingly
        const isInQueue = await isMobileNumberInQueue(chatId.toString());
        if (!isInQueue) {
            await bot.sendMessage(chatId, "You are not currently in the queue or your session has expired.");
            endSessionActions(chatId); // End the session immediately if not in queue
            return;
        }

        // Start session timeout
        setTimeout(() => {
            endSessionActions(chatId);
        }, SESSION_DURATION);

        // Proceed to check queue and patient information as before...
    }

    // Existing logic for handling messages, querying GPT, and updating conversation history
    let conversationHistory = conversations[chatId].messages;
    let medicalHistory = conversations[chatId].medicalHistory || [];

    const { success, content, conversationHistory: updatedHistory } = await chatWithGPT(userMessage, conversationHistory, medicalHistory);

    conversations[chatId].messages = updatedHistory;

    if (success) {
        await bot.sendMessage(chatId, content);
    } else {
        await bot.sendMessage(chatId, `Sorry, I encountered an error: ${content}`);
    }
});




module.exports = bot;
