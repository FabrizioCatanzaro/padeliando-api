import { Button, Heading, Link, Text } from 'react-email';
import Layout from './Layout.jsx';

export default function ResetPassword({
  name = 'jugador',
  resetUrl = 'https://padeleando.ar/reset-password/preview-token',
}) {
  return (
    <Layout preview="Recuperá el acceso a tu cuenta de Padeleando">
      <Heading style={h1}>Hola {name},</Heading>
      <Text style={p}>
        Recibimos un pedido para resetear tu contraseña. Tocá el botón de
        abajo para elegir una nueva.
      </Text>
      <Button href={resetUrl} style={button}>
        Resetear contraseña
      </Button>
      <Text style={pSmall}>
        O pegá este enlace en tu navegador:
        <br />
        <Link href={resetUrl} style={link}>
          {resetUrl}
        </Link>
      </Text>
      <Text style={pMuted}>
        El enlace expira en 1 hora. Si no pediste cambiar la contraseña, ignorá este mail —
        tu contraseña no va a cambiar.
      </Text>
    </Layout>
  );
}

const h1 = {
  color: '#0f172a',
  fontSize: '22px',
  fontWeight: 700,
  margin: '0 0 16px',
};

const p = {
  color: '#334155',
  fontSize: '16px',
  lineHeight: '24px',
  margin: '0 0 24px',
};

const pSmall = {
  color: '#475569',
  fontSize: '13px',
  lineHeight: '20px',
  margin: '24px 0 8px',
  wordBreak: 'break-all',
};

const pMuted = {
  color: '#94a3b8',
  fontSize: '12px',
  margin: '16px 0 0',
};

const button = {
  backgroundColor: '#0f766e',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: 600,
  padding: '12px 24px',
  borderRadius: '8px',
  textDecoration: 'none',
  display: 'inline-block',
};

const link = {
  color: '#0f766e',
  textDecoration: 'underline',
};
