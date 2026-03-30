import nodemailer from "nodemailer";
import { exec } from "child_process";
import { readFileSync } from "fs";
import { basename } from "path";

const LOG = true;

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER || "",
    pass: process.env.GMAIL_PASS || "",
  },
});

interface SendEmailOptions {
  attachment?: string;
}

function sendEmailGmail(
  to: string | string[],
  subject: string,
  html: string,
  options: SendEmailOptions = {}
): Promise<string> {
  if (LOG) console.log("Sending email via Gmail");
  return new Promise((resolve, reject) => {
    const { attachment } = options;
    const mailOptions: nodemailer.SendMailOptions = {
      from: process.env.EMAIL_FROM || "Name",
      to,
      subject,
      html,
    };
    if (attachment) {
      mailOptions.attachments = [{ path: attachment, filename: basename(attachment) }];
    }
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        if (LOG) console.error("Error:", error);
        reject(error);
      } else {
        if (LOG) console.log("Email sent:", info.response);
        resolve(info.response);
      }
    });
  });
}

function sendEmailLinux(
  to: string | string[],
  subject: string,
  html: string,
  options: SendEmailOptions = {}
): Promise<void> {
  if (LOG) console.log("Sending email via Linux sendmail");
  return new Promise((resolve, reject) => {
    const { attachment } = options;
    const replyTo = process.env.EMAIL_REPLY_TO || process.env.EMAIL_FROM || "noreply@example.com";
    const from = process.env.EMAIL_FROM || "noreply@example.com";
    const recipient = Array.isArray(to) ? to[0] : to;
    let headers = `From: ${from}\nSubject: ${subject}\nTo: ${recipient}\nMIME-Version: 1.0\nReply-To: ${replyTo}\n`;

    let message: string;
    if (attachment) {
      const boundary = "----=_BunEmail_" + Date.now();
      headers += `Content-Type: multipart/mixed; boundary="${boundary}"\n\n`;
      const bodyPart = `--${boundary}\nContent-Type: text/html; charset="UTF-8"\n\n${html}\n`;
      const filename = basename(attachment);
      const fileContent = readFileSync(attachment).toString("base64");
      const attachmentPart =
        `--${boundary}\n` +
        `Content-Type: application/octet-stream; name="${filename}"\n` +
        `Content-Transfer-Encoding: base64\n` +
        `Content-Disposition: attachment; filename="${filename}"\n\n` +
        `${fileContent}\n` +
        `--${boundary}--`;
      message = headers + bodyPart + "\n" + attachmentPart;
    } else {
      headers += `Content-Type: text/html; charset="UTF-8"\n\n`;
      message = headers + html;
    }

    const child = exec(`sendmail ${recipient}`, (error) => {
      if (error) {
        if (LOG) console.error("Error:", error);
        return reject(error);
      }
      if (LOG) console.log("Email sent via sendmail");
      resolve();
    });
    child.stdin!.write(message);
    child.stdin!.end();
  });
}

export function sendEmail(
  to: string | string[],
  subject: string,
  html: string,
  options: SendEmailOptions = {}
): Promise<string | void> {
  if (process.env.EMAIL_TYPE === "linux") {
    return sendEmailLinux(to, subject, html, options);
  }
  return sendEmailGmail(to, subject, html, options);
}
