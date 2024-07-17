// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    user_id: {
        type: String,
        required: true,
        unique: true
    },
    username: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        required: true
    },
    hospital_id: {
        type: String,
        required: true
    }
});

module.exports = mongoose.model('users', userSchema);
