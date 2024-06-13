const Patient = require('../database/patient-schema');


async function storeSessionSummary(patientId, summaryJSON) {
    try {
        // Find the patient by ID and update their record with the new summary
        await Patient.findByIdAndUpdate(patientId, {
            $push: { sessionSummaries: { summaryContent: summaryJSON } } // Use $push to add to the array
        }, { new: true }); // Return the updated document

        console.log("Successfully stored session summary.");
    } catch (error) {
        console.error("Error storing session summary:", error);
    }
}

async function storeTranscription(patientId, transcription, summaryDate) {
    try {
        const dateStart = new Date(summaryDate);
        dateStart.setHours(0, 0, 0, 0);
        const dateEnd = new Date(summaryDate);
        dateEnd.setDate(dateEnd.getDate() + 1);
        dateEnd.setHours(0, 0, 0, 0);


        const patient = await Patient.findById(patientId);
        if (!patient) {
            console.error(`Patient with ID ${patientId} not found`);
            return false;
        }

        const existingSummary = patient.sessionSummaries.find(s => {
            const sDate = new Date(s.summaryDate);
            sDate.setHours(0, 0, 0, 0);
            return sDate.getTime() >= dateStart.getTime() && sDate.getTime() < dateEnd.getTime();
        });

        if (existingSummary) {
            existingSummary.transcription = transcription;
        } else {
            patient.sessionSummaries.push({
                summaryDate: dateStart,
                transcription: transcription,
                summaryContent: "" // Initialize with empty content if necessary
            });
        }

        await patient.save();
        return true; // Return true to indicate success
    } catch (error) {
        return false; // Return false or throw an error to handle it upstream
    }
}




module.exports = { storeSessionSummary,storeTranscription};
