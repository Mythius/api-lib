// npm i nodemailer
var nodemailer = require("nodemailer");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const LOG = true;

// https://myaccount.google.com/apppasswords
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.GMAIL_USER || "", // Your Gmail address
        pass: process.env.GMAIL_PASS || "", // Your application-specific password
    },
});

/**
 * Sends email using Gmail via nodemailer
 */
function sendEmailGmail(to, subject, html) {
    if (LOG) console.log('Sending Email via Gmail');
    return new Promise((res, rej) => {
        const mailOptions = {
            from: process.env.EMAIL_FROM || "Name",
            to,
            subject,
            html,
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
}

/**
 * Sends email using local postfix sendmail command (Linux)
 */
function sendEmailLinux(to, subject, html, options = {}) {
    if (LOG) console.log('Sending Email via Linux sendmail');
    return new Promise((resolve, reject) => {
        const { attachment } = options;
        const replyTo = process.env.EMAIL_REPLY_TO || process.env.EMAIL_FROM || "noreply@example.com";
        const from = process.env.EMAIL_FROM || "noreply@example.com";
        const recipient = Array.isArray(to) ? to[0] : to;
        const sendmail = `sendmail ${recipient}`;
        let headers = `From: ${from}\nSubject: ${subject}\nTo: ${recipient}\nMIME-Version: 1.0\nReply-To: ${replyTo}\n`;

        let message;
        if (attachment) {
            const boundary = "----=_NodeJS_Email_Boundary_" + Date.now();
            headers += `Content-Type: multipart/mixed; boundary="${boundary}"\n\n`;

            let bodyPart = html
                ? `--${boundary}\nContent-Type: text/html; charset="UTF-8"\n\n${html}\n`
                : `--${boundary}\nContent-Type: text/plain; charset="UTF-8"\n\n${html}\n`;

            const filename = path.basename(attachment);
            const fileContent = fs.readFileSync(attachment).toString("base64");

            let attachmentPart =
                `--${boundary}\n` +
                `Content-Type: application/octet-stream; name="${filename}"\n` +
                `Content-Transfer-Encoding: base64\n` +
                `Content-Disposition: attachment; filename="${filename}"\n\n` +
                `${fileContent}\n` +
                `--${boundary}--`;

            message = headers + bodyPart + "\n" + attachmentPart;
        } else if (html) {
            headers += `Content-Type: text/html; charset="UTF-8"\n\n`;
            message = headers + html;
        } else {
            headers += `Content-Type: text/plain; charset="UTF-8"\n\n`;
            message = headers + html;
        }

        const child = exec(sendmail, (error) => {
            if (error) {
                if (LOG) console.error("Error:", error);
                return reject(error);
            }
            if (LOG) console.log("Email sent via sendmail");
            resolve();
        });
        child.stdin.write(message);
        child.stdin.end();
    });
}

/**
 * Sends email using configured method based on EMAIL_TYPE env variable
 * Defaults to Gmail if not specified
 * @param {string|Array} to - Recipient email address(es)
 * @param {string} subject - Email subject
 * @param {string} html - Email body (HTML)
 */
exports.sendEmail = function(to, subject, html) {
    if (process.env.EMAIL_TYPE === "linux") {
        return sendEmailLinux(to, subject, html);
    }
    return sendEmailGmail(to, subject, html);
};
