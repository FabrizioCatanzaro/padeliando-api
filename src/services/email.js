import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@padeliando.com';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

export async function sendPasswordResetEmail(email, token) {
  const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}`;
  
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: 'Recupera tu contraseña - Padeliando',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Padeliando</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;">
          <h2 style="color: #1f2937; margin-top: 0;">Recupera tu contraseña</h2>
          <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
          <p>Haz clic en el siguiente botón para crear una nueva contraseña:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
              Restablecer contraseña
            </a>
          </div>
          <p style="color: #6b7280; font-size: 14px;">Este enlace expira en 1 hora.</p>
          <p style="color: #6b7280; font-size: 14px;">Si no solicitaste restablecer tu contraseña, puedes ignorar este correo de forma segura.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">
            Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
            <a href="${resetUrl}" style="color: #667eea;">${resetUrl}</a>
          </p>
        </div>
      </body>
      </html>
    `
  });

  if (error) {
    console.error('Error enviando email de reset:', error);
    throw new Error('No se pudo enviar el email de recuperación');
  }
}
