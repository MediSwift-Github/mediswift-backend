// routes/login.js
const express = require("express");
const router = express.Router();
const User = require("../database/users"); // Make sure this path is correct
const jwt = require("jsonwebtoken");

const createToken = (_id) => {
  return jwt.sign({ _id }, process.env.SECRET, { expiresIn: "3d" });
};

router.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  console.log(
    `Attempting to find user: ${username} with password: ${password}`
  ); // Debug log
  try {
    const user = await User.findOne({ _id: username });
    console.log(user); // This logs null if user not found

    const token = createToken(user._id);

    console.log("token-->>", token);

    if (user && user.password === password) {
      // Authentication successful
      res.json({
        message: "Authentication successful",
        role: user.role,
        token,
      });
    } else {
      // Authentication failed
      res.status(401).json({ message: "Authentication failed" });
    }
  } catch (error) {
    console.error("Login error:", error);
    res
      .status(500)
      .json({ message: "An error occurred. Please try again later." });
  }
});

module.exports = router;
