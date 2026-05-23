// src/services/notification.ts

async function sendViaBrevoAPI(to: string, subject: string, html: string, text: string) {
  const API_KEY = process.env.BREVO_API_KEY || '';
  const FROM_EMAIL = process.env.EMAIL_FROM || 'codebyshivamsahu@gmail.com';

  if (!API_KEY) {
    console.warn('⚠️  BREVO_API_KEY not set — emails disabled');
    return;
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'FindThem India', email: FROM_EMAIL },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Brevo API error: ${err}`);
  }
  console.log(`✅ Email sent via Brevo API to ${to}`);
}

// ── Email Templates ──────────────────────────────────────────────────────────

function sightingMatchTemplate(data: {
  personName: string;
  caseId: string;
  confidence: number;
  location: string;
  description: string;
  reporterName: string;
  reportedAt: string;
  photoUrl?: string;
}) {
  const confColor = data.confidence >= 75 ? '#16a34a' : data.confidence >= 55 ? '#d97706' : '#6b7280';
  return {
    subject: `🔔 Sighting Alert: ${data.personName} — ${data.confidence}% Match | FindThem India`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f9fafb; margin: 0; padding: 20px; }
  .container { max-width: 560px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
  .header { background: linear-gradient(135deg, #ea580c, #f97316); padding: 28px 32px; color: white; }
  .header h1 { margin: 0; font-size: 22px; font-weight: 700; }
  .header p  { margin: 6px 0 0; opacity: 0.85; font-size: 14px; }
  .body { padding: 28px 32px; }
  .badge { display: inline-block; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 700; margin-bottom: 16px; }
  .info-row { display: flex; margin-bottom: 12px; }
  .info-label { color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; width: 130px; flex-shrink: 0; padding-top: 2px; }
  .info-value { color: #111827; font-size: 14px; font-weight: 500; }
  .confidence-bar { background: #f3f4f6; border-radius: 8px; height: 10px; margin: 4px 0 16px; }
  .confidence-fill { height: 10px; border-radius: 8px; background: ${confColor}; width: ${data.confidence}%; }
  .footer { background: #f9fafb; padding: 16px 32px; text-align: center; color: #9ca3af; font-size: 12px; border-top: 1px solid #f3f4f6; }
  .alert-box { background: #fef3c7; border: 1px solid #fde68a; border-radius: 10px; padding: 14px 16px; margin-bottom: 16px; }
</style></head>
<body>
<div class="container">
  <div class="header">
    <h1>🔍 FindThem India</h1>
    <p>National Missing Persons Portal — Sighting Alert</p>
  </div>
  <div class="body">
    <div class="alert-box">
      <strong>⚠️ Action Required:</strong> A sighting has been reported that may match your missing person case.
    </div>
    <span class="badge" style="background:${confColor}20; color:${confColor}; border: 1px solid ${confColor}40;">
      ${data.confidence}% AI Match Confidence
    </span>
    <div class="confidence-bar"><div class="confidence-fill"></div></div>
    <div class="info-row">
      <span class="info-label">Case ID</span>
      <span class="info-value" style="font-family:monospace; color:#ea580c;">${data.caseId}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Person</span>
      <span class="info-value">${data.personName}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Spotted At</span>
      <span class="info-value">${data.location}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Reported By</span>
      <span class="info-value">${data.reporterName}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Date & Time</span>
      <span class="info-value">${new Date(data.reportedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Description</span>
      <span class="info-value">${data.description}</span>
    </div>
    <p style="color:#374151; font-size:14px; margin-top:16px; line-height:1.6;">
      Please contact the local police immediately with this case ID and verify the sighting.
      Time is critical — act as soon as possible.
    </p>
    <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:14px; margin-top:16px;">
      <p style="margin:0; font-size:13px; color:#166534;">
        📞 <strong>Emergency:</strong> 112 &nbsp;|&nbsp;
        👶 <strong>Child Helpline:</strong> 1098 &nbsp;|&nbsp;
        🌐 <strong>Portal:</strong> findthemindia.vercel.app
      </p>
    </div>
  </div>
  <div class="footer">
    <p>FindThem India — Government of India Initiative | Ministry of Home Affairs</p>
    <p>Case ${data.caseId} • This is an automated alert. Do not reply.</p>
  </div>
</div>
</body></html>
    `,
    text: `
FindThem India — Sighting Alert

Case ID: ${data.caseId}
Person:  ${data.personName}
Match:   ${data.confidence}%
Location: ${data.location}
Reported by: ${data.reporterName}
Description: ${data.description}
Time: ${new Date(data.reportedAt).toLocaleString('en-IN')}

Please contact police immediately. Emergency: 112 | Child Helpline: 1098
    `.trim(),
  };
}

function caseFiledTemplate(data: {
  personName: string;
  caseId: string;
  reporterName: string;
  lastSeenLocation: string;
  lastSeenDate: string;
  district: string;
  state: string;
}) {
  return {
    subject: `✅ Case Filed: ${data.personName} — ${data.caseId} | FindThem India`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f9fafb; margin: 0; padding: 20px; }
  .container { max-width: 560px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
  .header { background: linear-gradient(135deg, #ea580c, #f97316); padding: 28px 32px; color: white; }
  .header h1 { margin: 0; font-size: 22px; font-weight: 700; }
  .body { padding: 28px 32px; }
  .case-id-box { background: #1f2937; color: #f97316; font-family: monospace; font-size: 24px; font-weight: 700; padding: 16px; border-radius: 12px; text-align: center; letter-spacing: 2px; margin: 16px 0; }
  .info-row { display: flex; margin-bottom: 12px; }
  .info-label { color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; width: 130px; flex-shrink: 0; padding-top: 2px; }
  .info-value { color: #111827; font-size: 14px; font-weight: 500; }
  .footer { background: #f9fafb; padding: 16px 32px; text-align: center; color: #9ca3af; font-size: 12px; }
</style></head>
<body>
<div class="container">
  <div class="header">
    <h1>✅ Case Successfully Filed</h1>
    <p>FindThem India — Missing Persons Portal</p>
  </div>
  <div class="body">
    <p style="color:#374151; font-size:15px;">Dear <strong>${data.reporterName}</strong>,</p>
    <p style="color:#374151; font-size:14px; line-height:1.6;">
      Your missing person case has been successfully filed. Save your Case ID — you will need it to track updates.
    </p>
    <div class="case-id-box">${data.caseId}</div>
    <div class="info-row">
      <span class="info-label">Person</span>
      <span class="info-value">${data.personName}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Last Seen</span>
      <span class="info-value">${data.lastSeenLocation}, ${data.district}, ${data.state}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Date</span>
      <span class="info-value">${data.lastSeenDate}</span>
    </div>
    <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:14px; margin-top:20px;">
      <p style="margin:0; font-size:13px; color:#166534; font-weight:600;">What happens next?</p>
      <ul style="margin:8px 0 0; padding-left:18px; font-size:13px; color:#166534; line-height:1.8;">
        <li>Nearby police stations will be notified</li>
        <li>Volunteers in the area will receive alerts</li>
        <li>AI face matching will run on all sightings</li>
        <li>You will receive email when a sighting is reported</li>
      </ul>
    </div>
    <div style="background:#fef9c3; border:1px solid #fde68a; border-radius:10px; padding:14px; margin-top:12px;">
      <p style="margin:0; font-size:13px; color:#92400e;">
        📞 <strong>Emergency:</strong> 112 &nbsp;|&nbsp;
        👶 <strong>Child Helpline:</strong> 1098 &nbsp;|&nbsp;
        🚔 <strong>Police:</strong> 100
      </p>
    </div>
  </div>
  <div class="footer">
    <p>FindThem India — Government of India | Ministry of Home Affairs</p>
    <p>Case ${data.caseId} • Automated confirmation. Do not reply.</p>
  </div>
</div>
</body></html>
    `,
    text: `Case Filed: ${data.caseId}\nPerson: ${data.personName}\nLast Seen: ${data.lastSeenLocation}\nEmergency: 112`,
  };
}

// ── Public functions ─────────────────────────────────────────────────────────

export async function sendSightingAlert(to: string, data: Parameters<typeof sightingMatchTemplate>[0]) {
  try {
    const { subject, html, text } = sightingMatchTemplate(data);
    await sendViaBrevoAPI(to, subject, html, text);
    console.log(`✅ Sighting alert email sent to ${to}`);
  } catch (err: any) {
    console.error(`❌ Email failed to ${to}:`, err.message);
  }
}

export async function sendCaseFiledConfirmation(to: string, data: Parameters<typeof caseFiledTemplate>[0]) {
  try {
    const { subject, html, text } = caseFiledTemplate(data);
    await sendViaBrevoAPI(to, subject, html, text);
    console.log(`✅ Case filed confirmation sent to ${to}`);
  } catch (err: any) {
    console.error(`❌ Email failed to ${to}:`, err.message);
  }
}