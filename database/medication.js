const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const medicationSchema = new Schema({
    product_name: { type: String, required: true },
    salt_composition: { type: String },
    product_price: { type: String },
    product_manufactured: { type: String },
    medicine_desc: { type: String },
    side_effects: { type: String },
    drug_interactions: { type: String },
    medicine_type: { type: String },
    Instructions: { type: String }
});

const Medication = mongoose.model('Medication', medicationSchema, 'prescription_collection'); // Replace with your actual collection name
module.exports = Medication;
