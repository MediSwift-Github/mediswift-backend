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
        const writeStream = fs.createWriteStream(pdfPath);
        const logoPath = path.join(__dirname, '..', 'uploads', 'MediSwift.png');
        return new Promise((resolve, reject) => {
            doc.pipe(writeStream);

            // Add the logo and title
            doc.image(logoPath, 50, 45, { width: 100 }).moveDown(2);
            doc.fontSize(20).text('Prescription', { align: 'center' }).moveDown(1.5);

            // Add patient details dynamically
            let currentY = doc.y + 10; // Ensure space from the title
            doc
                .fontSize(12)
                .text(`Name: ${patient.name}`, 50, currentY)
                .text(`Phone Number: ${patient.mobile_number}`)
                .text(`Date: ${new Date().toLocaleDateString()}`)
                .moveDown(2);

            // Adjust currentY to align the table
            currentY = doc.y+30;

            // Add table headers
            doc
                .fontSize(14)
                .text('Prescriptions:', { underline: true })
                .moveDown(0.5);

            const srNoX = 50;
            const medicationX = 100;
            const dosageX = 220;
            const perDayX = 270;
            const daysX = 370;
            const instructionsX = 450;

            doc
                .fontSize(10)
                .text('Sr. No', srNoX, currentY)
                .text('Medication', medicationX, currentY)
                .text('Dosage', dosageX, currentY)
                .text('Times Per Day', perDayX, currentY)
                .text('No. of Days', daysX, currentY)
                .text('Instructions', instructionsX, currentY);

            doc.moveTo(srNoX, currentY + 15).lineTo(550, currentY + 15).stroke();
            currentY += 20; // Adjust for next row

            // Add prescription rows dynamically
            prescriptions.forEach((prescription, i) => {
                const defaultRowHeight = 20; // Default minimum row height

                // Measure text heights for "Medication" and "Instructions"
                const medicationHeight = doc.heightOfString(prescription.drug, {
                    width: dosageX - medicationX - 10,
                    align: 'left'
                });

                const instructionsHeight = doc.heightOfString(prescription.notes, {
                    width: 550 - instructionsX,
                    align: 'left'
                });

                // Determine the maximum height of the row
                const rowHeight = Math.max(medicationHeight, instructionsHeight, defaultRowHeight);

                // Render the text at the calculated current Y position
                doc
                    .fontSize(10)
                    .text(prescription.srNo, srNoX, currentY)
                    .text(prescription.dosagePerDay, dosageX, currentY)
                    .text(prescription.frequency, perDayX, currentY)
                    .text(prescription.days, daysX, currentY);

                // Wrap long medication names
                doc.text(prescription.drug, medicationX, currentY, {
                    width: dosageX - medicationX - 10,
                    align: 'left'
                });

                // Wrap long instructions
                doc.text(prescription.notes, instructionsX, currentY, {
                    width: 550 - instructionsX,
                    align: 'left'
                });

                // Draw a line below the row
                doc.moveTo(srNoX, currentY + rowHeight).lineTo(550, currentY + rowHeight).stroke();

                // Increment the current Y position by the height of the current row
                currentY += rowHeight + 10; // Add some extra padding between rows
            });

            // Space between table and footer
            currentY += 20;
            doc.moveTo(srNoX, currentY).stroke();

            // Add doctor's signature and additional notes after the table
            doc
                .fontSize(12)
                .text('Doctor\'s Signature:', srNoX, currentY)
                .moveDown(2)
                .text('_______________________', srNoX, doc.y)
                .moveDown(1)
                .text('Additional Notes:', srNoX)
                .moveDown(2)
                .text('_______________________', srNoX, doc.y);

            // Finalize the PDF
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
