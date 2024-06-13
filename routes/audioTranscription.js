const express = require('express');
const multer = require('multer');
const { transcribeAudio } = require('../bot/gptChat'); // Adjust the path as necessary
const router = express.Router();
const path = require('path');
const {storeTranscription} = require("./storeSessionJSON");
const fs = require('fs');

// Configure Multer for audio file uploads
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, 'uploads/audio/') // Make sure this directory exists
    },
    filename: function(req, file, cb) {
        // Generate a unique filename for the audio file
        cb(null, `${file.fieldname}-${Date.now()}.mp3`)
    }
});

const upload = multer({ storage: storage });


router.post('/api/audio/upload', upload.single('audioFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }


    try {
        const transcriptionResult = await transcribeAudio(req.file.path);
        if (transcriptionResult.success) {
            const patientId = req.body.patientId;
            const summaryDate = req.body.summaryDate ? new Date(req.body.summaryDate) : new Date();

            const storageSuccess = await storeTranscription(patientId, transcriptionResult.content, summaryDate);
            if (!storageSuccess) {
                throw new Error('Failed to store transcription.');
            }

            res.send({
                message: 'Audio file uploaded, transcribed, and transcription saved successfully.',
                transcription: transcriptionResult.content
            });

            deleteFile(req.file.path); // Cleanup: delete the audio file after processing
        } else {
            throw new Error(transcriptionResult.error);
        }
    } catch (error) {
        console.error('Error during file processing:', error.message);
        res.status(500).send({
            message: 'Server error during transcription.',
            error: error.message
        });
    }
});

const deleteFile = (filePath) => {
    fs.unlink(filePath, (err) => {
        if (err) {
            console.error('Error deleting file:', err);
        } else {
            console.log(`File deleted successfully: ${filePath}`);
        }
    });
};

module.exports = router;
