// routes/login.js
const express = require("express");
const router = express.Router();
const User = require("../database/users"); // Make sure this path is correct
const jwt = require("jsonwebtoken");

const createToken = (user) => {
  const payload = { _id: user._id, hospital_id: user.hospital_id };

  return jwt.sign(payload, process.env.SECRET, { expiresIn: "3d" });
};

router.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username: username });
    if (user && user.password === password) {
      const token = createToken(user);
      res.json({
        message: "Authentication successful",
        role: user.role,
        token,
      });
    } else {
      res.status(401).json({ message: "Authentication failed" });
    }
  } catch (error) {
    res.status(500).json({ message: "An error occurred. Please try again later." });
  }
});


module.exports = router;
