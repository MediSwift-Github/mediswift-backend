const express = require('express');
const router = express.Router();
const Patient = require('../database/patient-schema');
const { OpenAI } = require("openai");
const userLanguages = require('../database/languageStore');

const openai = new OpenAI(process.env.OPENAI_API_KEY);

router.get('/getSummary', async (req, res) => {
    try {
        const { _id, date } = req.query;
        console.log("Received params:", req.query);

        const patient = await Patient.findById(_id);
        if (!patient) {
            return res.status(404).json({ message: 'Patient not found' });
        }

        const summaryDate = new Date(date);
        summaryDate.setHours(0, 0, 0, 0);
        const summary = patient.sessionSummaries.find(s => {
            const sDate = new Date(s.summaryDate);
            sDate.setHours(0, 0, 0, 0);
            return sDate.getTime() === summaryDate.getTime();
        });

        if (!summary) {
            return res.status(404).json({ message: 'Summary for the specified date not found' });
        }

        const ehrResponse = await createEHRentry(summary.summaryContent, summary.transcription);
        const handoutResponse = await createHandout(summary.summaryContent, summary.transcription, patient.mobile_number);
        console.log('Data type of EHR content:', typeof ehrResponse.content);
        console.log('Data type of Handout content:', typeof handoutResponse.content);
        if (ehrResponse.success && handoutResponse.success) {
            res.json({ ehrContent: ehrResponse.content, handoutContent: handoutResponse.content });
        } else {
            res.status(500).json({
                message: 'Failed to create EHR or Handout entry',
                errors: { ehrError: ehrResponse.error, handoutError: handoutResponse.error }
            });
        }
    } catch (error) {
        console.error('Error retrieving patient summary:', error);
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

async function createEHRentry(summaryContent, transcription) {
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
        "required": [
            "purpose_of_visit",
            "chronic_diseases",
            "acute_symptoms",
            "allergies",
            "medications",
            "previous_treatments",
            "patient_concerns",
            "infectious_disease_exposure",
            "nutritional_status",
            "family_medical_history",
            "lifestyle_factors",
            "other_relevant_medical_history"
        ],
        "additionalProperties": false
    };

    return await createOpenAIResponse(
        "You are a highly proficient medical assistant with extensive knowledge in medical jargon, designed to output comprehensive and detailed JSON. Given a summary of the purpose of visit received through a text conversation before the consultation and a transcription of the conversation between doctor and patient, output a structured JSON object suitable for a medical record (doctor's notes). Ensure the output is highly detailed, technically accurate, and includes every single detail mentioned in the transcription and summary. The JSON object should cover all medical details of the visit. Output only the JSON object.",
        summaryContent, transcription, jsonSchema
    );
}

async function createHandout(summaryContent, transcription, userId) {
    const language = userLanguages[userId];
    let systemInstruction;

    if (language && language.toLowerCase() !== 'english') {
        systemInstruction = `Create a patient-friendly handout based on the patient's problems. The handout should be in JSON format, written in simple and subtle language suitable for WhatsApp, and should avoid medical jargon. Include sections for Do's, Don'ts, and Dietary restrictions. If there are better suggestions, include those too. The handout should be concise and readable in 2-3 minutes. Additionally, provide the handout in both English and the language specified in the UserLanguages variable. Here is an example format for English and ${language}:
{
    "English": "Please rest and eat your food on time.",
    "${language}": "Translation in ${language}"
}`;
    } else {
        systemInstruction = "Create a patient-friendly handout based on the patient's problems. The handout should be a JSON in simple and subtle language, suitable for WhatsApp, and should avoid medical jargon. It should include Do's, Don'ts, and Dietary restrictions, but if there are better suggestions, include those too. The handout should be concise, readable within 1 minute. Output only the JSON object.";
    }
    return await createOpenAIResponse(systemInstruction, summaryContent, transcription);
}

async function createOpenAIResponse(systemInstruction, summaryContent, transcription, jsonSchema = null) {
    const systemPrompt = {
        role: "system",
        content: systemInstruction
    };

    const userPrompt = {
        role: "user",
        content: `Summary: """${summaryContent}"""  Transcription: """${transcription}"""`
    };

    try {
        const requestOptions = {
            model: "gpt-4o-2024-08-06",
            messages: [systemPrompt, userPrompt],
        };

        if (jsonSchema) {
            requestOptions.response_format = {
                type: "json_schema",
                json_schema: {
                    name: "medical_notes",
                    strict: true,
                    schema: jsonSchema
                }
            };
        } else {
            requestOptions.response_format = { type: "json_object" };
        }

        const response = await openai.chat.completions.create(requestOptions);

        const jsonResponse = response.choices[0].message.content;
        const parsedResponse = JSON.parse(jsonResponse);
        console.log('Data type of the parsed JSON response:', typeof parsedResponse);
        return { success: true, content: parsedResponse };
    } catch (error) {
        console.error(`Error creating response with OpenAI:`, error);
        return { success: false, error: error.message };
    }
}

module.exports = router;
