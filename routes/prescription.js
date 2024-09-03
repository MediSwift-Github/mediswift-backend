const express = require('express');
const router = express.Router();
const Patient = require('../database/patient-schema');
const PDFDocument = require('pdfkit');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const Grid = require('gridfs-stream');
const mongoose = require('mongoose');

// Initialize GridFS
let gfs;
const conn = mongoose.connection;
conn.once('open', () => {
    gfs = Grid(conn.db, mongoose.mongo);
    gfs.collection('uploads');
});

// Endpoint to save prescriptions and generate PDF
router.post('/api/savePrescriptions', async (req, res) => {
    const { patientId, prescriptions, summaryDate } = req.body;

    if (!patientId || !prescriptions || prescriptions.length === 0 || !summaryDate) {
        return res.status(400).send('Missing patient ID, prescriptions, or summary date.');
    }

    try {
        // Save prescription data
        await savePrescriptions(patientId, prescriptions, summaryDate);

        // Generate PDF for prescriptions
        const pdfPath = await generatePrescriptionPdf(patientId, prescriptions);

        // Upload the PDF and get the file ID
        const fileUrl = await uploadPdf(pdfPath);

        // Fetch the patient details using the patientId
        const patient = await Patient.findById(patientId);
        if (!patient) {
            throw new Error('Patient not found');
        }

        // Send the PDF to the customer via WhatsApp using the file ID
        await sendPdfToCustomer(patient.mobile_number, fileUrl);

        // Delete the PDF from local storage after sending
        fs.unlinkSync(pdfPath);

        res.json({ status: 'success', message: 'Prescriptions saved, PDF uploaded, sent, and deleted successfully!', patientId: patientId, fileUrl });
    } catch (error) {
        console.error("Failed to save prescriptions, generate PDF, upload, or delete:", error);
        res.status(500).send('Failed to save prescriptions, generate PDF, upload, or delete.');
    }
});




async function savePrescriptions(patientId, prescriptions, summaryDate) {
    try {
        // Convert summaryDate to a date range to match the day
        const dateStart = new Date(summaryDate);
        const dateEnd = new Date(summaryDate);
        dateEnd.setDate(dateEnd.getDate() + 1);

        // Find the patient and check if a session summary exists for the date
        const patient = await Patient.findOne({
            _id: patientId,
            'sessionSummaries.summaryDate': {
                $gte: dateStart,
                $lt: dateEnd
            }
        });

        if (patient) {
            // If a session summary exists, append the prescriptions
            const sessionSummaryIndex = patient.sessionSummaries.findIndex(summary =>
                summary.summaryDate >= dateStart && summary.summaryDate < dateEnd
            );

            if (sessionSummaryIndex !== -1) {
                // Update the existing session summary with new prescriptions
                await Patient.updateOne(
                    { _id: patientId, 'sessionSummaries._id': patient.sessionSummaries[sessionSummaryIndex]._id },
                    { $push: { 'sessionSummaries.$.prescriptions': { $each: prescriptions } } }
                );
            }
        } else {
            // If no session summary exists, create a new one with the prescriptions
            await Patient.findByIdAndUpdate(patientId, {
                $push: {
                    sessionSummaries: {
                        summaryDate: dateStart,
                        prescriptions: prescriptions
                    }
                }
            }, { new: true });
        }

        console.log("Successfully stored prescriptions.");
    } catch (error) {
        console.error("Error storing prescriptions:", error);
        throw error; // Rethrow to be caught by the calling function
    }
}



async function generatePrescriptionPdf(patientId, prescriptions) {
    try {
        const patient = await Patient.findById(patientId);
        if (!patient) {
            throw new Error('Patient not found');
        }

        const doc = new PDFDocument({ margin: 50 });
        const pdfFileName = `${patient.name.replace(/\s+/g, '_')}_prescription.pdf`;
        const pdfPath = path.join(__dirname, '..', 'uploads', pdfFileName);
        const writeStream = fs.createWriteStream(pdfPath)
        const logoPath = path.join(__dirname, '..', 'uploads', 'MediSwift.png');
        return new Promise((resolve, reject) => {
            doc.pipe(writeStream);

            // Add content to the PDF
            doc.image(logoPath, 50, 45, { width: 100 }).moveDown(2);
            doc.fontSize(20).text('Prescription', { align: 'center' }).moveDown(1.5);

            // Add patient details with adequate space from the logo
            doc
                .fontSize(12)
                .text(`Name: ${patient.name}`, 50, 200)  // Start text after the logo
                .text(`Phone Number: ${patient.mobile_number}`)
                .text(`Date: ${new Date().toLocaleDateString()}`)
                .moveDown(2);

            // Add a table for prescriptions
            doc
                .fontSize(14)
                .text('Prescriptions:', { underline: true })
                .moveDown(0.5);

            // Define table headers
            const tableTop = doc.y;
            const itemX = 50;
            const drugX = 100;
            const dosageX = 220;
            const daysX = 320;
            const freqX = 370;
            const notesX = 450;

            doc
                .fontSize(10)
                .text('Sr. No', itemX, tableTop)
                .text('Drug', drugX, tableTop)
                .text('Dosage Per Day', dosageX, tableTop)
                .text('Days', daysX, tableTop)
                .text('Frequency', freqX, tableTop)
                .text('Notes', notesX, tableTop);

            doc.moveTo(itemX, tableTop + 15)
                .lineTo(550, tableTop + 15)
                .stroke();

            // Add prescription rows
            prescriptions.forEach((prescription, i) => {
                const y = tableTop + 30 + (i * 20);
                doc
                    .fontSize(10)
                    .text(prescription.srNo, itemX, y)
                    .text(prescription.drug, drugX, y)
                    .text(prescription.dosagePerDay, dosageX, y)
                    .text(prescription.days, daysX, y)
                    .text(prescription.frequency, freqX, y)
                    .text(prescription.notes, notesX, y);
            });

            doc.moveDown(2);

            // Add doctor's signature and additional notes, properly aligned and spaced
            doc
                .fontSize(12)
                .text('Doctor\'s Signature:', itemX, doc.y)
                .moveDown(2)
                .text('_______________________', itemX, doc.y - 10) // Adjust for proper alignment
                .moveDown(1)
                .text('Additional Notes:', itemX)
                .moveDown(2)
                .text('_______________________', itemX, doc.y - 10); // Adjust for proper alignment

            // Finalize the PDF and end the stream
            doc.end();

            writeStream.on('finish', () => {
                resolve(pdfPath);
            });

            writeStream.on('error', (error) => {
                reject(error);
            });
        });
    } catch (error) {
        console.error("Error generating prescription PDF:", error);
        throw error;
    }
}

async function sendPdfToCustomer(to, documentLink) {
    if (!to || !documentLink) {
        throw new Error('Recipient number and document link are required.');
    }

    const data = {
        to: to,
        recipient_type: 'individual',
        type: 'template',
        template: {
            language: {
                policy: 'deterministic',
                code: 'en'
            },
            name: 'send_prescription',
            components: [
                {
                    type: 'header',
                    parameters: [
                        {
                            type: 'document',
                            document: {
                                link: documentLink
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
}


async function uploadPdf(pdfPath) {
    try {
        console.log(`Uploading file from path: ${pdfPath}`);

        // Prepare the form data
        const data = new FormData();
        data.append('file', fs.createReadStream(pdfPath)); // Use the dynamic path here

        // Configure the request
        const config = {
            method: 'post',
            timeout: 120000, // 2 minutes timeout
            maxBodyLength: Infinity, // Ensure there's no limit on the body size
            url: 'https://media-manager.1automations.com/api/uploadfile',
            headers: {
                'Authorization': `${process.env.UPLOAD_API_TOKEN}`, // Add your authorization token here
                ...data.getHeaders() // Important to include the correct headers
            },
            data: data // The form data containing the file
        };

        // Make the request
        const response = await axios(config);

        // Check if the response contains the file URL
        if (response.data && response.data.file && response.data.file.fileUrl) {
            console.log('PDF uploaded successfully, file URL:', response.data.file.fileUrl);
            return response.data.file.fileUrl; // Return the file URL
        } else {
            throw new Error('File URL not found in upload response.');
        }
    } catch (error) {
        console.error('Error uploading PDF:', error.response ? error.response.data : error.message);
        throw new Error('Failed to upload PDF.');
    }
}

module.exports = router;
