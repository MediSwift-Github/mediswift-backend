// gptChat.js using CommonJS
const { OpenAI } = require("openai");
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

const openai = new OpenAI(process.env.OPENAI_API_KEY);


// Function to create a system-level prompt from the patient's medical history
function createSystemPrompt(medicalHistory, conversationLanguage) {
    if (medicalHistory && medicalHistory.length > 0) {
        const historyJSON = JSON.stringify(medicalHistory, null, 2); // Convert array of objects to JSON
        return {
            role: "system",
            content: `You are MediSwift, a virtual medical assistant designed to aid doctors. The patient is here for a follow-up visit or a new consultation. Here is the patient's medical history: """${historyJSON}""".
  Start by asking the patient if this visit is a follow-up appointment or a new visit. Use their response to guide the conversation while considering the existing medical history. Use """${conversationLanguage}""" for the conversation. The user may reply in any language, but you should reply only in """${conversationLanguage}""".
  Begin by summarizing the key points of their medical history. Ask questions based on their response and the provided medical history. Gather detailed information that will help the doctor understand the patient's current condition better. 
  If the patient provides incomplete or unclear information, politely ask for clarification.
  Maintain a tone that conveys empathy and understanding, and keep the language simple, avoiding medical jargon where possible.`
        };
    } else {
        // No medical history present
        return {
            role: "system",
            content: `You are MediSwift, a virtual medical assistant designed to aid doctors. You are chatting with a patient inside a hospital waiting area right before their visit to the doctor. Your role is to gather information about the patient's current health concerns in a step-by-step manner. You do not provide diagnoses or medical advice. As soon as you receive a message, start asking questions (try to start the conversation with a message like "Can you please tell me the problem you are facing?"). Ask one question at a time based on the patient's responses. Gather detailed information that will help the doctor understand the patient's condition better. Since the doctor does not know about the patient, help him know about underlying conditions like allergies or past medical issues by asking the patient. Use ${conversationLanguage} for the conversation. The user may reply in any language but you should reply only in ${conversationLanguage}. If the patient provides incomplete or unclear information, politely ask follow-up questions for clarification. Keep questions concise but ensure they gather all necessary information. Maintain a tone that conveys empathy and understanding.`
        };
    }
}


async function chatWithGPT(prompt, conversationHistory, medicalHistory) {

    const conversationLanguage = conversationHistory.language || 'English'; // Default to English if no language is selected
    const systemLevelPrompt = createSystemPrompt(medicalHistory, conversationLanguage);

    // Ensure the system-level prompt is always at the beginning of the conversation history
    if (conversationHistory.length === 0 || (conversationHistory[0] && conversationHistory[0].role !== "system")) {
        conversationHistory.unshift(systemLevelPrompt);
    }

    conversationHistory.push({ role: "user", content: prompt });

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: conversationHistory,
        });

        const modelMessage = response.choices[0].message.content;
        conversationHistory.push({ role: "assistant", content: modelMessage });

        return { success: true, content: modelMessage, conversationHistory };
    } catch (error) {
        console.error('Error communicating with OpenAI:', error);
        return { success: false, error: error.message, conversationHistory };
    }
}
async function summarizeConversation(conversationHistory) {
    // Filter out system messages before summarization
    const filteredHistory = conversationHistory.filter(message => message.role !== "system");
    console.log(filteredHistory);
    // Construct a prompt that asks GPT to summarize the conversation
    const summaryPrompt = {
        role: "system",
        content: "You are part of a virtual medical assistant designed to aid doctors. A chatbot was deployed to talk to the patient to gather detailed information about their concerns, symptoms, medical history, etc., to help the doctor understand the purpose of the visit while providing all the details retrieved during the chat. Your job is to understand the conversation and make detailed clinical notes that include all relevant medical details without adding any noise or unwanted details. The notes should be structured and include sections for chronic diseases, acute diseases, allergies, and other relevant medical history based on the conversation. Follow these steps: 1. Extract and list all relevant information from the conversation in a structured manner. 2. Create a comprehensive medical history based on the extracted information. 3. Compile detailed clinical notes, ensuring they are accurate and technically sound, suitable for a doctor's review. Ensure the total length of the clinical notes can be read within 1-2 minutes. This is the conversation:"
};

    // Add the summary prompt at the beginning of the conversation history
    filteredHistory.unshift(summaryPrompt);

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: filteredHistory, // Use the filtered and updated history here
        });

        const summaryMessage = response.choices[0].message.content;
        console.log(summaryMessage);
        // Call convertSummaryToJSON right after the summary is generated
        await convertSummaryToJSON(summaryMessage);
        return { success: true, content: summaryMessage };
    } catch (error) {
        console.error('Error generating summary with OpenAI:', error);
        return { success: false, error: error.message };
    }
}

async function convertSummaryToJSON(summary) {
    const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            {
                role: "system",
                content: "You are a helpful assistant designed to output JSON. Given a medical summary, output a structured JSON object. The JSON should include fields such as Purpose of Visit, Chronic Diseases, Acute Symptoms, Allergies, Medications, Previous Treatments, Patient Concerns, Infectious Disease Exposure, Nutritional Status, Family Medical History, and Lifestyle Factors. These fields are suggestions and not a fixed scheme.Add and remove fields as needed. Use the information available in the summary to populate the fields. If information for a field is not available, either omit the field or set it to null. Ensure the JSON is formatted in a user-friendly manner as it will be displayed to and read by doctors."
            },
            {
                role: "user",
                content: summary
            }
        ],
        response_format: { type: "json_object" },
    });
    console.log(completion.choices[0].message.content);
    return completion.choices[0].message.content;
}

// Function to transcribe audio using the OpenAI Whisper API
async function transcribeAudio(audioFilePath) {
    console.log('TranscribeAudio called with path:', audioFilePath);

    try {
        const fullPath = path.resolve(audioFilePath);
        console.log('Resolved full path:', fullPath);

        if (!fs.existsSync(fullPath)) {
            console.error('File does not exist at path:', fullPath);
            return { success: false, error: 'File does not exist' };
        }

        const formData = new FormData();
        formData.append('file', fs.createReadStream(fullPath));
        formData.append('model', 'whisper-1');
        // Log the headers and API URL before the request
        const apiURL = 'https://api.openai.com/v1/audio/transcriptions';
        console.log('API URL:', apiURL);
        console.log('Headers:', { ...formData.getHeaders(), 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` });

        console.log('Sending request to OpenAI for transcription...');
        const response = await axios.post(apiURL, formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            responseType: 'json'
        });

        console.log('Transcription received:', response.data);
        return { success: true, content: response.data.text };
    } catch (error) {
        console.error('Error transcribing audio with OpenAI:', error.message);

        // Log the error response from OpenAI, if available
        if (error.response) {
            console.error('OpenAI response:', error.response.data);
        }

        return { success: false, error: error.message };
    }
}

async function convertMedicalSummaryToNotes(summary, medicalHistory) {
    // Check if medicalHistory is empty or not provided and adjust the historyContext message accordingly
    const historyContext = medicalHistory && medicalHistory.length > 0
        ? medicalHistory.map(entry => `${entry.visitDate}: ${JSON.stringify(entry.notes)}`).join('\n')
        : "No prior medical history available.";

    try {
        // Make a request to the API with handling for empty or nonexistent medical history
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are a technical medical assistant. Here is the existing medical history: ${historyContext}. Understand this history thoroughly, noting existing details such as allergies, family medical history, and other relevant information. Avoid repeating information already present in the medical history.`
                },
                {
                    role: "system",
                    content: "Based on this history, generate detailed notes for the new visit provided in the user input. Use medical jargon and ensure the output is in JSON format with the following fields: purposeOfVisit, chronicDiseases, acuteSymptoms, allergies, medications, previousTreatments, patientConcerns, infectiousDiseaseExposure, nutritionalStatus, familyMedicalHistory, and lifestyleFactors."
                },
                {
                    role: "user",
                    content: summary
                }
            ],
            response_format: { type: "json_object" },
        });
        console.log('Converted Notes:', response.choices[0].message.content);
        return response.choices[0].message.content;
    } catch (error) {
        console.error('Error in convertMedicalSummaryToNotes:', error);
        return null;
    }
}


module.exports = {
    chatWithGPT,
    summarizeConversation,
    convertSummaryToJSON,
    transcribeAudio,
    convertMedicalSummaryToNotes
};


