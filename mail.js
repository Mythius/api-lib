// npm i nodemailer nodemailer-smtp-transport
var nodemailer = require("nodemailer");
var smtpTransport = require("nodemailer-smtp-transport");
const fs = require("fs");
const LOG = true;

// https://myaccount.google.com/apppasswords
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: "", // Your Gmail address
        pass: "", // Your application-specific password
    },
});

exports.sendEmail = function(to, subject, html) {
    if (LOG) console.log('Sending Email');
    return new Promise((res, rej) => {
        // Email content
        const mailOptions = {
            from: "Name",
            to,
            subject,
            html,
            // attachments: [{
            //     filename: 'document.pdf', // Name of the attached file
            //     content: fs.createReadStream('./document.pdf'), // Path to the PDF file
            // }, ],
        };
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                if (LOG) console.error("Error:", error);
                rej(error);
            } else {
                if (LOG) console.log("Email sent:", info.response);
                res(info.response);
            }
        });
    });
};