export function getTaskReminderEmailTemplate(
  userName: string,
  taskTitle: string,
  dueDate: string,
  projectNumber: string,
  taskUrl: string,
  firmName: string,
): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Task Reminder</title>
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
      background: linear-gradient(135deg, #c5a48e 0%, #a88969 100%);
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
    .task-details {
      background-color: #FFF9F5;
      border-left: 4px solid #c5a48e;
      padding: 20px;
      margin: 20px 0;
      border-radius: 6px;
    }
    .task-details h3 {
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
    .due-date-urgent {
      color: #DC2626;
      font-weight: 700;
    }
    .urgency-banner {
      background-color: #FEE2E2;
      border: 1px solid #FCA5A5;
      padding: 15px;
      margin: 20px 0;
      border-radius: 6px;
      text-align: center;
    }
    .urgency-banner p {
      color: #DC2626;
      font-size: 14px;
      font-weight: 600;
      margin: 0;
    }
    .cta-container {
      text-align: center;
      margin: 40px 0;
    }
    .cta-button {
      display: inline-block;
      background: #c5a48e;
      color: #ffffff;
      font-size: 16px;
      font-weight: 600;
      text-decoration: none;
      padding: 16px 40px;
      border-radius: 8px;
      transition: background-color 0.3s ease;
      box-shadow: 0 4px 12px rgba(197, 164, 142, 0.3);
    }
    .cta-button:hover {
      background: #a88969;
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
      <h1>⏰ Task Reminder</h1>
      <p>You have an upcoming task deadline</p>
    </div>

    <div class="content">
      <p class="greeting">Hello ${userName},</p>

      <p class="message">
        This is a friendly reminder about an upcoming task that requires your attention.
      </p>

      <div class="urgency-banner">
        <p>⚠️ This task is due soon. Please complete it before the deadline.</p>
      </div>

      <div class="task-details">
        <h3>Task Details</h3>
        <div class="detail-row">
          <span class="detail-label">Task:</span>
          <span class="detail-value">${taskTitle}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Due Date:</span>
          <span class="detail-value due-date-urgent">${dueDate}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Project Number:</span>
          <span class="detail-value">${projectNumber}</span>
        </div>
      </div>

      <div class="cta-container">
        <a href="${taskUrl}" class="cta-button">
          View Task
        </a>
      </div>

      <p class="message" style="font-size: 14px; color: #6c757d;">
        To avoid delays, please complete this task as soon as possible. If you need assistance or have questions, contact your supervisor or project manager.
      </p>
    </div>

    <div class="footer">
      <p class="firm-name">${firmName}</p>
      <p>Professional Project Management</p>
      <p style="margin-top: 20px;">
        This is an automated reminder. Please do not reply to this email.
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
