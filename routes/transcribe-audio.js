// transcribeAudio.js
const express = require('express');
const router = express.Router();

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { OpenAI } = require('openai');
require('dotenv').config();
// At the top of your transcribeAudio.js file
const pendingTranscriptions = {}; // This object holds transcription data keyed by jobId
ffmpeg.setFfmpegPath(ffmpegPath);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Diarization webhook to receive results from the diarization API
router.post('/diarization-webhook', (req, res) => {
    try {
        console.log('Diarization Webhook called. Received data:', JSON.stringify(req.body, null, 2));

        const { jobId, output } = req.body;

        if (!jobId || !output || !output.diarization) {
            throw new Error('Invalid webhook data.');
        }

        const diarizationData = output.diarization;

        if (pendingTranscriptions[jobId]) {
            const { transcriptionData, resolve } = pendingTranscriptions[jobId];

            // Use the new alignment function
            const conversation = alignTranscriptionSegmentsWithDiarization(
                transcriptionData.segments,
                diarizationData
            );

            // Resolve the promise with the final conversation
            if (resolve) {
                resolve({ success: true, content: conversation });
            }

            // Clean up
            delete pendingTranscriptions[jobId];
        } else {
            console.error('No pending transcription found for job ID:', jobId);
        }

        res.status(200).send('Diarization data received and processed.');
    } catch (error) {
        console.error('Error processing diarization webhook:', error.message);
        res.status(500).send('Error processing diarization data.');
    }
});

// Function to transcribe audio using the OpenAI Whisper API
// Function to get audio duration
async function getAudioDuration(filePath) {
    try {
        const mm = await import('music-metadata');
        const metadata = await mm.parseFile(filePath);
        console.log(`Audio duration: ${metadata.format.duration} seconds`);
        return metadata.format.duration;
    } catch (error) {
        console.error('Error getting audio duration:', error);
        throw error;
    }
}


// Modified transcribeAudio function
async function transcribeAudio(audioFilePath) {
    console.log('TranscribeAudio called with path:', audioFilePath);

    try {
        const fullPath = path.resolve(audioFilePath);
        console.log('Resolved full path:', fullPath);

        if (!fs.existsSync(fullPath)) {
            console.error('File does not exist at path:', fullPath);
            return { success: false, error: 'File does not exist' };
        }

        // Get audio duration
        const duration = await getAudioDuration(fullPath);
        console.log(`Audio duration: ${duration} seconds`);

        // Decide which transcription method to use
        const DURATION_THRESHOLD = 60; // 60 seconds threshold

        if (duration <= DURATION_THRESHOLD) {
            // Use simple transcription
            console.log('Using simple transcription method...');
            return await simpleTranscription(fullPath);
        } else {
            // Use transcription with diarization
            console.log('Using transcription with diarization...');
            return await transcriptionWithDiarization(fullPath);
        }
    } catch (error) {
        console.error('Error during transcription:', error.message);

        if (error.response) {
            console.error('API response:', error.response.data);
        }

        return { success: false, error: error.message };
    }
}
async function simpleTranscription(audioFilePath) {
    console.log('TranscribeAudio called with path:', audioFilePath);

    try {
        const fullPath = path.resolve(audioFilePath);
        console.log('Resolved full path:', fullPath);

        if (!fs.existsSync(fullPath)) {
            console.error('File does not exist at path:', fullPath);
            return { success: false, error: 'File does not exist' };
        }

        const formData = new FormData();
        formData.append('file', fs.createReadStream(fullPath), {
            filename: path.basename(fullPath),
            contentType: 'audio/ogg' // Adjust the content type if needed
        });
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
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
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
// Transcription with diarization function
async function transcriptionWithDiarization(fullPath) {
    console.log('Starting transcription with diarization...');

    try {
        // Start transcription
        const transcriptionPromise = transcribeWithWordTimestamps(fullPath);

        // Start diarization and get the job ID
        const diarizationJobId = await performDiarization(fullPath);

        // Wait for transcription to complete
        const transcriptionData = await transcriptionPromise;

        // Store transcription data using the job ID
        pendingTranscriptions[diarizationJobId] = {
            transcriptionData,
            resolve: null, // Will be used to resolve the final result
            conversation: null // Will hold the final conversation
        };

        console.log('Stored transcription data for job ID:', diarizationJobId);

        // Return a promise that will resolve when the final conversation is ready
        return new Promise((resolve, reject) => {
            pendingTranscriptions[diarizationJobId].resolve = resolve;

            // Optional: Set a timeout to reject if processing takes too long
            setTimeout(() => {
                if (pendingTranscriptions[diarizationJobId]) {
                    delete pendingTranscriptions[diarizationJobId];
                    reject(new Error('Processing timed out.'));
                }
            }, 5 * 60 * 1000); // 5 minutes timeout
        });
    } catch (error) {
        console.error('Error during transcription with diarization:', error.message);

        if (error.response) {
            console.error('API response:', error.response.data);
        }

        return { success: false, error: error.message };
    }
}


async function transcribeWithWordTimestamps(fullPath) {
    console.log('Starting transcription with word timestamps...');
    try {
        const response = await openai.audio.transcriptions.create({
            file: fs.createReadStream(fullPath),
            model: 'whisper-1',
            response_format: 'verbose_json',
            timestamp_granularity: 'word',
            word_timestamps: true, // Include this parameter
        });

        console.log('Transcription received.:',response);
        return response; // This includes 'text' and 'words' arrays at the top level
    } catch (error) {
        console.error('Error transcribing audio with OpenAI:', error.message);

        if (error.response) {
            console.error('OpenAI response:', error.response.data);
        }

        throw error;
    }
}

async function performDiarization(fullPath) {
    console.log('Starting diarization process...');
    try {
        // Convert audio to MP4 format
        const mp4FilePath = await convertAudioToMp4(fullPath);

        // Upload MP4 file to cloud to get a public URL
        const fileUrl = await uploadFileToCloud(mp4FilePath);

        // Send the URL to the diarization API and get the job ID
        const diarizationJobId = await sendDiarizationRequest(fileUrl);

        // Clean up the MP4 file after uploading
        fs.unlink(mp4FilePath, (err) => {
            if (err) console.error('Error deleting MP4 file:', err);
        });

        return diarizationJobId;
    } catch (error) {
        console.error('Error during diarization:', error.message);
        throw error;
    }
}

function convertAudioToMp4(inputPath) {
    console.log('Converting audio to MP4 format...');
    const outputPath = `${inputPath}.mp4`;

    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .setFfmpegPath(ffmpegPath)
            .output(outputPath)
            .on('end', () => {
                console.log('Audio conversion to MP4 completed.');
                resolve(outputPath);
            })
            .on('error', err => {
                console.error('Error converting audio to MP4:', err.message);
                reject(err);
            })
            .run();
    });
}

async function uploadFileToCloud(filePath) {
    console.log(`Uploading file to cloud: ${filePath}`);
    try {
        const data = new FormData();
        data.append('file', fs.createReadStream(filePath));

        const response = await axios.post(process.env.UPLOAD_API_URL, data, {
            headers: {
                'Authorization': `${process.env.UPLOAD_API_TOKEN}`,
                ...data.getHeaders()
            },
            timeout: 120000, // 2 minutes timeout
            maxBodyLength: Infinity
        });

        if (response.data && response.data.file && response.data.file.fileUrl) {
            console.log('File uploaded successfully. URL:', response.data.file.fileUrl);
            return response.data.file.fileUrl;
        } else {
            throw new Error('File URL not found in upload response.');
        }
    } catch (error) {
        console.error('Error uploading file:', error.response ? error.response.data : error.message);
        throw new Error('Failed to upload file.');
    }
}

async function sendDiarizationRequest(fileUrl) {
    console.log('Sending diarization request...');
    try {
        const webhookUrl = `${process.env.BASE_URL}/diarization-webhook`;

        const response = await axios.post('https://api.pyannote.ai/v1/diarize', {
            url: fileUrl,
            webhook: webhookUrl
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.PYANNOTE_API_TOKEN}`,
                'Content-Type': 'application/json',
            },
            responseType: 'json'
        });

        if (response.data && response.data.jobId) {
            console.log('Diarization job started:', response.data.jobId);
            return response.data.jobId;
        } else {
            throw new Error('Failed to start diarization job.');
        }

    } catch (error) {
        console.error('Error sending diarization request:', error.message);
        throw error;
    }
}

function alignTranscriptionSegmentsWithDiarization(transcriptionSegments, diarizationSegments) {
    console.log('Aligning transcription segments with diarization...');

    if (!transcriptionSegments || !Array.isArray(transcriptionSegments)) {
        console.error('Invalid transcription segments:', transcriptionSegments);
        return [];
    }
    if (!diarizationSegments || !Array.isArray(diarizationSegments)) {
        console.error('Invalid diarization segments:', diarizationSegments);
        return [];
    }

    const conversation = [];
    let diarizationIndex = 0;
    const tolerance = 0.5; // Adjust as needed

    transcriptionSegments.forEach(transSegment => {
        const transStart = transSegment.start;
        const transEnd = transSegment.end;

        // Find the diarization segment that overlaps with the transcription segment
        while (
            diarizationIndex < diarizationSegments.length &&
            diarizationSegments[diarizationIndex].end + tolerance < transStart
            ) {
            diarizationIndex++;
        }

        if (diarizationIndex < diarizationSegments.length) {
            const diarSegment = diarizationSegments[diarizationIndex];

            // Check if the diarization segment overlaps with the transcription segment
            if (
                diarSegment.start - tolerance <= transEnd &&
                diarSegment.end + tolerance >= transStart
            ) {
                conversation.push({
                    speaker: diarSegment.speaker,
                    text: transSegment.text.trim()
                });
            } else {
                // No overlapping diarization segment found
                conversation.push({
                    speaker: 'Unknown',
                    text: transSegment.text.trim()
                });
            }
        } else {
            // No remaining diarization segments
            conversation.push({
                speaker: 'Unknown',
                text: transSegment.text.trim()
            });
        }
    });

    return conversation;
}

module.exports = {
    transcribeAudio,
    router
};
