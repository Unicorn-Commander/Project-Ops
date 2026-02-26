export function getPasswordResetEmailTemplate(
  userName: string,
  resetLink: string,
  firmName: string,
): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background-color: #F5F9FC;
      padding: 40px 20px;
      line-height: 1.6;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #005AF5 0%, #004CCE 100%);
      padding: 40px 30px;
      text-align: center;
    }
    .header h1 {
      color: #ffffff;
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 10px;
    }
    .header p {
      color: rgba(255, 255, 255, 0.9);
      font-size: 16px;
      font-weight: 400;
    }
    .content {
      padding: 40px 30px;
    }
    .greeting {
      color: #10172B;
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 20px;
    }
    .message {
      color: #4A5568;
      font-size: 16px;
      line-height: 1.8;
      margin-bottom: 30px;
    }
    .warning-box {
      background-color: #FFF3CD;
      border-left: 4px solid #FFC107;
      padding: 20px;
      margin: 20px 0;
      border-radius: 6px;
    }
    .warning-box p {
      color: #856404;
      font-size: 14px;
      margin: 0;
    }
    .cta-container {
      text-align: center;
      margin: 40px 0;
    }
    .cta-button {
      display: inline-block;
      background: #005AF5;
      color: #ffffff;
      font-size: 16px;
      font-weight: 600;
      text-decoration: none;
      padding: 16px 40px;
      border-radius: 8px;
      transition: background-color 0.3s ease;
      box-shadow: 0 4px 12px rgba(0, 90, 245, 0.3);
    }
    .cta-button:hover {
      background: #004CCE;
    }
    .divider {
      border: 0;
      border-top: 1px solid #D4DADE;
      margin: 30px 0;
    }
    .footer {
      background-color: #F5F9FC;
      padding: 30px;
      text-align: center;
      border-top: 1px solid #D4DADE;
    }
    .footer p {
      color: #A5A6AA;
      font-size: 14px;
      margin-bottom: 10px;
    }
    .footer .firm-name {
      color: #10172B;
      font-weight: 600;
      font-size: 16px;
      margin-bottom: 5px;
    }
    .link-fallback {
      margin-top: 20px;
      padding: 15px;
      background-color: #f8f9fa;
      border-radius: 6px;
      word-break: break-all;
    }
    .link-fallback p {
      color: #6c757d;
      font-size: 13px;
      margin-bottom: 8px;
    }
    .link-fallback a {
      color: #005AF5;
      text-decoration: none;
      font-size: 13px;
    }
    @media only screen and (max-width: 600px) {
      .header h1 {
        font-size: 24px;
      }
      .content {
        padding: 30px 20px;
      }
      .cta-button {
        padding: 14px 30px;
        font-size: 15px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Password Reset Request</h1>
      <p>Secure password reset for your account</p>
    </div>

    <div class="content">
      <p class="greeting">Hello ${userName},</p>

      <p class="message">
        We received a request to reset the password for your account at <strong>${firmName}</strong>.
        Click the button below to create a new password.
      </p>

      <div class="warning-box">
        <p><strong>⚠️ Security Notice:</strong> If you did not request a password reset, please ignore this email or contact our support team immediately. Your account remains secure.</p>
      </div>

      <div class="cta-container">
        <a href="${resetLink}" class="cta-button">
          Reset My Password
        </a>
      </div>

      <div class="link-fallback">
        <p><strong>Button not working?</strong> Copy and paste this link into your browser:</p>
        <a href="${resetLink}">${resetLink}</a>
      </div>

      <hr class="divider">

      <p class="message" style="font-size: 14px; color: #6c757d;">
        <strong>This link will expire in 1 hour</strong> for your security. If you need to reset your password after it expires, you can request a new reset link.
      </p>
    </div>

    <div class="footer">
      <p class="firm-name">${firmName}</p>
      <p>Professional Tax Services</p>
      <p style="margin-top: 20px;">
        This is an automated message. Please do not reply to this email.
      </p>
      <p style="font-size: 12px; color: #A5A6AA; margin-top: 10px;">
        Powered by Project Ops Platform
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}
