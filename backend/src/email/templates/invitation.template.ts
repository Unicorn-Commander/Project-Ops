export function getInvitationEmailTemplate(
  clientName: string,
  invitationUrl: string,
  firmName: string,
): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Client Portal Invitation</title>
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
    .info-box {
      background-color: #F5F9FC;
      border-left: 4px solid #005AF5;
      padding: 20px;
      margin: 20px 0;
      border-radius: 6px;
    }
    .info-box p {
      color: #4A5568;
      font-size: 14px;
      margin: 0;
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
      <h1>Welcome to Your Client Portal</h1>
      <p>Secure access to your project documents and information</p>
    </div>

    <div class="content">
      <p class="greeting">Hello ${clientName},</p>

      <p class="message">
        You've been invited to access the <strong>${firmName}</strong> client portal.
        Our secure portal provides you with 24/7 access to your tax cases, documents,
        and important communications.
      </p>

      <div class="info-box">
        <p><strong>What you can do in the portal:</strong></p>
        <ul style="margin-left: 20px; margin-top: 10px; color: #4A5568;">
          <li>View your projects and their current status</li>
          <li>Upload and download documents securely</li>
          <li>Communicate with your project team</li>
          <li>Track billing and payment information</li>
        </ul>
      </div>

      <div class="cta-container">
        <a href="${invitationUrl}" class="cta-button">
          Access Your Portal
        </a>
      </div>

      <div class="link-fallback">
        <p><strong>Button not working?</strong> Copy and paste this link into your browser:</p>
        <a href="${invitationUrl}">${invitationUrl}</a>
      </div>

      <hr class="divider">

      <p class="message" style="font-size: 14px; color: #6c757d;">
        <strong>Security Note:</strong> This invitation link is unique to you and will expire after
        first use or in 7 days. If you did not request access or have any concerns, please contact
        our office immediately.
      </p>
    </div>

    <div class="footer">
      <p class="firm-name">${firmName}</p>
      <p>Professional Project Management</p>
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

export function getTestEmailTemplate(firmName: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Configuration Test</title>
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
      background: linear-gradient(135deg, #28a745 0%, #218838 100%);
      padding: 40px 30px;
      text-align: center;
    }
    .header h1 {
      color: #ffffff;
      font-size: 28px;
      font-weight: 700;
    }
    .content {
      padding: 40px 30px;
      text-align: center;
    }
    .success-icon {
      font-size: 64px;
      margin-bottom: 20px;
    }
    .message {
      color: #10172B;
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 15px;
    }
    .info {
      color: #6c757d;
      font-size: 14px;
      line-height: 1.6;
    }
    .footer {
      background-color: #F5F9FC;
      padding: 20px;
      text-align: center;
      border-top: 1px solid #D4DADE;
    }
    .footer p {
      color: #A5A6AA;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Email Configuration Test</h1>
    </div>

    <div class="content">
      <div class="success-icon">✅</div>
      <p class="message">Your email configuration is working correctly!</p>
      <p class="info">
        This is a test email from <strong>${firmName}</strong>.<br>
        Your SMTP settings have been successfully configured and tested.
      </p>
    </div>

    <div class="footer">
      <p>Project Ops Platform - Email Service Test</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}
