const express = require('express');
require('./database/database'); // Connect to MongoDB
const cors = require('cors');
const bodyParser = require('body-parser');
const loginRoute = require('./routes/login'); // Make sure to create this route file
const patientRoutes = require('./routes/add-patient');
const searchPatient = require('./routes/search-patient');
const queue = require('./routes/queue-add');
const setupRealtimeUpdates = require('./realtimeUpdates');
const http = require('http');
const audioTranscription = require('./routes/audioTranscription');
const documentationRoute = require('./routes/documentation');
const saveHealthRecordRouter = require('./routes/saveHealthRecord');
const patientHandoutRoutes = require('./routes/savePatientHandout');
const whatsappBot = require('./bot/whatsappbot');
const savePrescriptionsRoute = require('./routes/prescription');
const missedCallRoute = require('./routes/missed-call');




const app = express();
const port = process.env.PORT || 3000;
const server = http.createServer(app);


const corsOptions = {
    origin: function (origin, callback) {
        console.log("Origin attempting to access:", origin);  // Log the origin
        const allowed = ['http://localhost:3001', 'https://mediswift-frontend.vercel.app','http://localhost:3000','http://localhost:3003']
            .some(baseURL => origin && origin.startsWith(baseURL));
        console.log("Allowed:", allowed);  // Log if it's allowed

        if (!origin || allowed) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

// Apply CORS with these options
app.use(cors(corsOptions));
app.use(bodyParser.json());


// Use the login route
app.use(loginRoute);
app.use(patientRoutes);
app.use(searchPatient);
app.use(queue);
app.use(audioTranscription);
app.use(documentationRoute);
app.use(saveHealthRecordRouter);
app.use(patientHandoutRoutes);
app.use(whatsappBot);
app.use(express.json()); // for parsing application/json
app.use(express.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
app.use(missedCallRoute);
app.use(savePrescriptionsRoute);

setupRealtimeUpdates(server);

app.get('/', (req, res) => res.send('MediSwift API Running'));

// Start the server
server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});


