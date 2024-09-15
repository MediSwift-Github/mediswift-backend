// gptChat.js using CommonJS
const { OpenAI } = require("openai");
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');
const { transcribeAudio } = require('../routes/transcribe-audio'); // Import the transcribeAudio function

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


async function chatWithGPT(prompt, conversationHistory, medicalHistory, language) {
    const conversationLanguage = language || conversationHistory.language || 'English'; // Default to English if no language is selected
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
    // Log the initial conversation history
    // console.log("Original conversation history:", conversationHistory);

    // Filter out system messages before summarization
    const filteredHistory = conversationHistory.filter(message => message.role !== "system");
    // console.log("Filtered conversation history (without system messages):", filteredHistory);

    // Construct a prompt that asks GPT to summarize the conversation
    const summaryPrompt = {
        role: "system",
        content: "You are part of a virtual medical assistant designed to aid doctors. A chatbot was deployed to talk to the patient to gather detailed information about their concerns, symptoms, medical history, etc., to help the doctor understand the purpose of the visit while providing all the details retrieved during the chat. Your job is to understand the conversation and extract all relevant information from the conversation in a structured JSON format that follows a predefined schema."
    };

    // Log the summary prompt
    // console.log("Summary prompt to be sent:", summaryPrompt);

    // Add the summary prompt at the beginning of the conversation history
    filteredHistory.unshift(summaryPrompt);

    // Define the JSON schema to enforce in the structured output
    const jsonSchema = {
        "type": "object",
        "properties": {
            "purpose_of_visit": { "type": "string" },
            "chronic_diseases": { "type": ["string", "null"] },
            "acute_symptoms": { "type": "string" },
            "allergies": { "type": ["string", "null"] },
            "medications": { "type": ["string", "null"] },
            "previous_treatments": { "type": ["string", "null"] },
            "patient_concerns": { "type": ["string", "null"] },
            "infectious_disease_exposure": { "type": ["string", "null"] },
            "nutritional_status": { "type": ["string", "null"] },
            "family_medical_history": { "type": ["string", "null"] },
            "lifestyle_factors": { "type": ["string", "null"] },
            "other_relevant_medical_history": { "type": ["string", "null"] }
        },
        "required": ["purpose_of_visit", "acute_symptoms"],
        "additionalProperties": false
    };

    // Log the final payload to be sent to OpenAI
    // console.log("Final payload (filtered history with prompt):", filteredHistory);

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-2024-08-06",
            messages: filteredHistory, // Use the filtered and updated history here
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "medical_summary",
                    strict: true,
                    schema: jsonSchema
                }
            }
        });

        // Log the full response from OpenAI
        // console.log("OpenAI response:", response);

        const structuredSummary = response.choices[0].message.content;
        // console.log("Generated structured summary:", structuredSummary);

        return { success: true, content: structuredSummary };
    } catch (error) {
        // Log any errors that occur
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

async function convertMedicalSummaryToNotes(summary, medicalHistory) {
    // Check if medicalHistory is empty or not provided and adjust the historyContext message accordingly
    const historyContext = medicalHistory && medicalHistory.length > 0
        ? medicalHistory.map(entry => `${entry.visitDate}: ${JSON.stringify(entry.notes)}`).join('\n')
        : "No prior medical history available.";

    // Define the same JSON schema for the response as before
    const jsonSchema = {
        "type": "object",
        "properties": {
            "purpose_of_visit": { "type": "string" },
            "chronic_diseases": { "type": ["string", "null"] },
            "acute_symptoms": { "type": "string" },
            "allergies": { "type": ["string", "null"] },
            "medications": { "type": ["string", "null"] },
            "previous_treatments": { "type": ["string", "null"] },
            "patient_concerns": { "type": ["string", "null"] },
            "infectious_disease_exposure": { "type": ["string", "null"] },
            "nutritional_status": { "type": ["string", "null"] },
            "family_medical_history": { "type": ["string", "null"] },
            "lifestyle_factors": { "type": ["string", "null"] },
            "other_relevant_medical_history": { "type": ["string", "null"] }
        },
        "required": ["purpose_of_visit", "acute_symptoms"],
        "additionalProperties": false
    };

    try {
        // Make a request to the API with handling for empty or nonexistent medical history
        const response = await openai.chat.completions.create({
            model: "gpt-4o-2024-08-06",
            messages: [
                {
                    role: "system",
                    content: `You are a technical medical assistant. Here is the existing medical history: ${historyContext}. Understand this history thoroughly, noting existing details such as allergies, family medical history, and other relevant information. Avoid repeating information already present in the medical history.`
                },
                {
                    role: "system",
                    content: "Based on this history, generate detailed notes for the new visit provided in the user input. Use medical jargon and ensure the output is in JSON format with the following fields: purpose_of_visit, chronic_diseases, acute_symptoms, allergies, medications, previous_treatments, patient_concerns, infectious_disease_exposure, nutritional_status, family_medical_history, lifestyle_factors, and other_relevant_medical_history."
                },
                {
                    role: "user",
                    content: summary
                }
            ],
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "medical_notes",
                    strict: true,
                    schema: jsonSchema
                }
            }
        });

        // Log and return the structured notes
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


