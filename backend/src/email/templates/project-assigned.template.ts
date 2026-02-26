export function getProjectAssignedEmailTemplate(
  userName: string,
  projectNumber: string,
  projectName: string,
  assignedBy: string,
  projectUrl: string,
  firmName: string,
): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Project Assigned</title>
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
    .project-details {
      background-color: #F5F9FC;
      border-left: 4px solid #005AF5;
      padding: 20px;
      margin: 20px 0;
      border-radius: 6px;
    }
    .project-details h3 {
      color: #10172B;
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 15px;
    }
    .detail-row {
      display: flex;
      padding: 8px 0;
      border-bottom: 1px solid #E5E7EB;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      color: #6B7280;
      font-size: 14px;
      font-weight: 500;
      min-width: 120px;
    }
    .detail-value {
      color: #10172B;
      font-size: 14px;
      font-weight: 600;
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
    @media only screen and (max-width: 600px) {
      .header h1 {
        font-size: 24px;
      }
      .content {
        padding: 30px 20px;
      }
      .detail-row {
        flex-direction: column;
      }
      .detail-label {
        margin-bottom: 4px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>New Project Assigned</h1>
      <p>You have been assigned to a new project</p>
    </div>

    <div class="content">
      <p class="greeting">Hello ${userName},</p>

      <p class="message">
        You have been assigned to a new project by <strong>${assignedBy}</strong>.
        Please review the project details and take necessary action.
      </p>

      <div class="project-details">
        <h3>Project Details</h3>
        <div class="detail-row">
          <span class="detail-label">Project Number:</span>
          <span class="detail-value">${projectNumber}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Project Name:</span>
          <span class="detail-value">${projectName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Assigned By:</span>
          <span class="detail-value">${assignedBy}</span>
        </div>
      </div>

      <div class="cta-container">
        <a href="${projectUrl}" class="cta-button">
          View Project Details
        </a>
      </div>

      <p class="message" style="font-size: 14px; color: #6c757d;">
        You can access this project anytime from your dashboard. Make sure to update the project status and add any relevant notes as you progress.
      </p>
    </div>

    <div class="footer">
      <p class="firm-name">${firmName}</p>
      <p>Professional Project Management</p>
      <p style="margin-top: 20px;">
        This is an automated notification. Please do not reply to this email.
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
