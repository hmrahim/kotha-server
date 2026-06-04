const https = require("https");

// ─────────────────────────────────────────────────────────────────────────────
// Brevo API helper
// ─────────────────────────────────────────────────────────────────────────────
const sendBrevoEmail = ({ to, toName, subject, htmlContent }) => {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      sender: { name: "Kotha", email: "h.m.rahimnet@gmail.com" },
      to: [{ email: to, name: toName }],
      subject,
      htmlContent,
    });

    const options = {
      hostname: "api.brevo.com",
      path: "/v3/smtp/email",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": process.env.BREVO_API_KEY,
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`Brevo API error: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// OTP Email Template
// ─────────────────────────────────────────────────────────────────────────────
const buildOtpTemplate = (name, otp) => {
  const digits = otp.toString().split("");
  const year = new Date().getFullYear();
  const colors = ["#7c6af7", "#9179f9", "#a78bfa", "#b89efc", "#c084fc", "#d0a0fe"];

  const digitBox = (d, color) =>
    `<td align="center" style="padding:0 4px;">
      <div style="width:40px;height:52px;line-height:52px;background:#0d0d14;border:2px solid ${color};border-radius:10px;font-family:Arial,sans-serif;font-size:24px;font-weight:800;color:#f0f0ff;text-align:center;mso-line-height-rule:exactly;">
        ${d}
      </div>
    </td>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Verify your Kotha account</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0 !important; padding: 0 !important; background-color: #0d0d14; width: 100% !important; }
    @media screen and (max-width: 600px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .pad { padding: 24px 20px !important; }
      .header-pad { padding: 28px 20px 20px !important; }
      .otp-title { font-size: 22px !important; }
      .sub-text { font-size: 14px !important; }
      .brand-name { font-size: 24px !important; }
      .info-box { padding: 12px 14px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#0d0d14;">
<div style="display:none;font-size:1px;color:#0d0d14;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
  ${otp} is your Kotha verification code — expires in 10 minutes.
</div>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#0d0d14;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table class="email-container" role="presentation" cellspacing="0" cellpadding="0" border="0" width="520" style="max-width:520px;width:100%;background-color:#13131f;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#7c6af7,#a78bfa,#c084fc,#7c6af7);line-height:4px;font-size:4px;">&nbsp;</td></tr>
        <tr>
          <td class="header-pad" align="center" style="padding:36px 40px 24px;">
            <div style="display:inline-block;width:60px;height:60px;border-radius:18px;background:linear-gradient(135deg,#7c6af7 0%,#c084fc 100%);line-height:60px;text-align:center;margin-bottom:14px;">
              <span style="font-size:26px;font-weight:900;color:#ffffff;font-family:Arial,sans-serif;">K</span>
            </div>
            <div class="brand-name" style="font-family:Arial,sans-serif;font-size:26px;font-weight:800;color:#f0f0ff;letter-spacing:-0.5px;margin-bottom:4px;">Kotha</div>
            <div style="font-family:Arial,sans-serif;font-size:11px;color:#5a5a7a;letter-spacing:3px;text-transform:uppercase;">Connect · Chat · Belong</div>
          </td>
        </tr>
        <tr>
          <td class="pad" style="padding:32px 40px 24px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:16px;">
              <tr>
                <td style="background:rgba(124,106,247,0.12);border-radius:20px;padding:5px 12px;">
                  <span style="font-family:Arial,sans-serif;font-size:11px;color:#a78bfa;font-weight:700;letter-spacing:2px;text-transform:uppercase;">✉ Email Verification</span>
                </td>
              </tr>
            </table>
            <div class="otp-title" style="font-family:Arial,sans-serif;font-size:24px;font-weight:700;color:#f0f0ff;line-height:1.3;margin-bottom:12px;">
              Hey ${name}, you're almost in! 👋
            </div>
            <div class="sub-text" style="font-family:Arial,sans-serif;font-size:15px;color:#8080a0;line-height:1.7;margin-bottom:28px;">
              Use the verification code below to confirm your email address and start connecting on Kotha.
            </div>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:20px;">
              <tr>
                <td style="background:linear-gradient(135deg,#1a1a2e,#1d1d33);border:1px solid rgba(124,106,247,0.2);border-radius:16px;padding:28px 20px;text-align:center;">
                  <div style="font-family:Arial,sans-serif;font-size:11px;color:#5a5a7a;letter-spacing:2.5px;text-transform:uppercase;margin-bottom:18px;font-weight:600;">Your Verification Code</div>
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto 18px;">
                    <tr>${digits.map((d, i) => digitBox(d, colors[i])).join("")}</tr>
                  </table>
                  <div style="font-family:Arial,sans-serif;font-size:12px;color:#5a5a7a;">
                    Full code: <strong style="color:#a78bfa;letter-spacing:3px;font-size:14px;">${otp}</strong>
                  </div>
                </td>
              </tr>
            </table>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:12px;">
              <tr>
                <td class="info-box" style="background:#1a1a2e;border-radius:10px;padding:13px 16px;">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                    <tr>
                      <td width="28" valign="middle" style="font-size:18px;">⏱</td>
                      <td valign="middle" style="font-family:Arial,sans-serif;font-size:13px;color:#8080a0;padding-left:8px;">
                        This code <strong style="color:#e0e0f0;">expires in 10 minutes.</strong> Request a new one from the app if needed.
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
              <tr>
                <td class="info-box" style="background:#180f0f;border:1px solid rgba(255,100,100,0.12);border-radius:10px;padding:13px 16px;">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                    <tr>
                      <td width="28" valign="middle" style="font-size:18px;">🔒</td>
                      <td valign="middle" style="font-family:Arial,sans-serif;font-size:13px;color:#8080a0;padding-left:8px;">
                        <strong style="color:#ff8080;">Never share this code.</strong> Kotha will never ask for it via chat or phone.
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:20px 32px 28px;">
            <div style="font-family:Arial,sans-serif;font-size:12px;color:#3a3a56;line-height:1.7;">
              Didn't create a Kotha account? You can safely ignore this email.<br/>
              © ${year} Kotha &nbsp;·&nbsp;
              <a href="#" style="color:#7c6af7;text-decoration:none;">Privacy</a>
              &nbsp;·&nbsp;
              <a href="#" style="color:#7c6af7;text-decoration:none;">Help</a>
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Send Verification Email
// ─────────────────────────────────────────────────────────────────────────────
exports.sendVerificationEmail = async (toEmail, name, otp) => {
  await sendBrevoEmail({
    to: toEmail,
    toName: name,
    subject: `${otp} is your Kotha verification code`,
    htmlContent: buildOtpTemplate(name, otp),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Send Password Reset Link Email
// ─────────────────────────────────────────────────────────────────────────────
exports.sendPasswordResetEmail = async (toEmail, name, resetToken) => {
  const resetUrl = `${process.env.CLIENT_URL}/reset-password/${resetToken}`;
  const year = new Date().getFullYear();

  await sendBrevoEmail({
    to: toEmail,
    toName: name,
    subject: "Reset your Kotha password",
    htmlContent: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Reset your Kotha password</title>
  <style>
    body { margin:0;padding:0;background-color:#0d0d14; }
    @media screen and (max-width:600px) {
      .email-container { width:100% !important; }
      .pad { padding:24px 20px !important; }
      .btn { padding:13px 24px !important; font-size:14px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#0d0d14;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#0d0d14;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table class="email-container" role="presentation" cellspacing="0" cellpadding="0" border="0" width="520" style="max-width:520px;width:100%;background:#13131f;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#7c6af7,#c084fc);font-size:4px;line-height:4px;">&nbsp;</td></tr>
        <tr>
          <td align="center" style="padding:36px 40px 24px;">
            <div style="display:inline-block;width:60px;height:60px;border-radius:18px;background:linear-gradient(135deg,#7c6af7,#c084fc);line-height:60px;text-align:center;margin-bottom:14px;">
              <span style="font-size:26px;font-weight:900;color:#fff;font-family:Arial,sans-serif;">K</span>
            </div>
            <div style="font-family:Arial,sans-serif;font-size:26px;font-weight:800;color:#f0f0ff;">Kotha</div>
          </td>
        </tr>
        <tr>
          <td class="pad" style="padding:8px 40px 36px;">
            <div style="font-family:Arial,sans-serif;font-size:22px;font-weight:700;color:#f0f0ff;margin-bottom:12px;">Hi ${name}, reset your password 🔑</div>
            <div style="font-family:Arial,sans-serif;font-size:15px;color:#8080a0;line-height:1.7;margin-bottom:24px;">
              Click the button below to reset your password. This link expires in <strong style="color:#e0e0f0;">1 hour</strong>.
            </div>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="border-radius:10px;background:linear-gradient(135deg,#7c6af7,#c084fc);">
                  <a class="btn" href="${resetUrl}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;">
                    Reset Password
                  </a>
                </td>
              </tr>
            </table>
            <div style="font-family:Arial,sans-serif;font-size:13px;color:#5a5a7a;margin-top:20px;">
              If you didn't request this, you can safely ignore this email.
            </div>
            <div style="font-family:Arial,sans-serif;font-size:12px;color:#3a3a56;margin-top:32px;">© ${year} Kotha</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Send Password Reset OTP Email
// ─────────────────────────────────────────────────────────────────────────────
exports.sendPasswordResetOtpEmail = async (toEmail, name, otp) => {
  const digits = otp.toString().split("");
  const year = new Date().getFullYear();
  const colors = ["#7c6af7", "#9179f9", "#a78bfa", "#b89efc", "#c084fc", "#d0a0fe"];

  const digitBox = (d, color) =>
    `<td align="center" style="padding:0 4px;">
      <div style="width:40px;height:52px;line-height:52px;background:#0d0d14;border:2px solid ${color};border-radius:10px;font-family:Arial,sans-serif;font-size:24px;font-weight:800;color:#f0f0ff;text-align:center;mso-line-height-rule:exactly;">
        ${d}
      </div>
    </td>`;

  await sendBrevoEmail({
    to: toEmail,
    toName: name,
    subject: `${otp} — Kotha password reset code`,
    htmlContent: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Reset your Kotha password</title>
  <style>
    body { margin:0;padding:0;background-color:#0d0d14; }
    @media screen and (max-width:600px) {
      .email-container { width:100% !important; }
      .pad { padding:24px 20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#0d0d14;">
<div style="display:none;font-size:1px;color:#0d0d14;line-height:1px;max-height:0px;overflow:hidden;">
  ${otp} is your Kotha password reset code — expires in 10 minutes.
</div>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#0d0d14;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table class="email-container" role="presentation" cellspacing="0" cellpadding="0" border="0" width="520"
        style="max-width:520px;width:100%;background-color:#13131f;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#7c6af7,#a78bfa,#c084fc,#7c6af7);line-height:4px;font-size:4px;">&nbsp;</td></tr>
        <tr>
          <td align="center" style="padding:36px 40px 24px;">
            <div style="display:inline-block;width:60px;height:60px;border-radius:18px;background:linear-gradient(135deg,#7c6af7,#c084fc);line-height:60px;text-align:center;margin-bottom:14px;">
              <span style="font-size:26px;font-weight:900;color:#fff;font-family:Arial,sans-serif;">K</span>
            </div>
            <div style="font-family:Arial,sans-serif;font-size:26px;font-weight:800;color:#f0f0ff;margin-bottom:4px;">Kotha</div>
            <div style="font-family:Arial,sans-serif;font-size:11px;color:#5a5a7a;letter-spacing:3px;text-transform:uppercase;">Connect · Chat · Belong</div>
          </td>
        </tr>
        <tr>
          <td class="pad" style="padding:0 40px 36px;">
            <div style="text-align:center;margin-bottom:20px;">
              <div style="display:inline-block;width:64px;height:64px;border-radius:50%;background:rgba(124,106,247,0.15);border:1.5px solid rgba(124,106,247,0.3);line-height:64px;text-align:center;">
                <span style="font-size:28px;">🔐</span>
              </div>
            </div>
            <h2 style="font-family:Arial,sans-serif;font-size:22px;font-weight:800;color:#f0f0ff;text-align:center;margin:0 0 10px;">Password Reset Code</h2>
            <p style="font-family:Arial,sans-serif;font-size:15px;color:#8888aa;text-align:center;margin:0 0 28px;line-height:22px;">
              হ্যালো ${name}, তোমার Kotha password reset করার জন্য নিচের OTP টি ব্যবহার করো।
            </p>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto 24px;">
              <tr>${digits.map((d, i) => digitBox(d, colors[i])).join("")}</tr>
            </table>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
              style="background:rgba(248,81,73,0.08);border:1px solid rgba(248,81,73,0.2);border-radius:12px;margin-bottom:20px;">
              <tr>
                <td style="padding:14px 16px;">
                  <p style="font-family:Arial,sans-serif;font-size:13px;color:#f85149;margin:0;line-height:20px;">
                    ⚠️ এই OTP <strong>10 মিনিটের</strong> মধ্যে expire হয়ে যাবে। যদি তুমি এই request না করে থাকো, এই email ignore করো।
                  </p>
                </td>
              </tr>
            </table>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
              style="background:#1a1a2e;border:1px solid rgba(255,255,255,0.06);border-radius:12px;">
              <tr>
                <td style="padding:14px 16px;">
                  <p style="font-family:Arial,sans-serif;font-size:13px;color:#6666aa;margin:0;line-height:20px;">
                    🔒 Kotha কখনো তোমার password চাইবে না। এই OTP শুধু password reset screen এ ব্যবহার করো।
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.05);">
            <p style="font-family:Arial,sans-serif;font-size:12px;color:#3a3a5a;text-align:center;margin:0;">
              © ${year} Kotha. All rights reserved.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`,
  });
};