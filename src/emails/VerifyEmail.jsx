import { Button, Heading, Link, Text } from 'react-email';
import Layout from './Layout.jsx';

export default function VerifyEmail({
  name = 'jugador',
  verifyUrl = 'https://padeleando.ar/verify-email/preview-token',
}) {
  return (
    <Layout preview="Confirmá tu email para empezar a usar Padeleando">
      <Heading style={h1}>Bienvenido, {name} 👋</Heading>
      <Text style={p}>
        Estás a un pasito de empezar a usar Padeleando, tu compañero de padel. Confirmá tu email
        tocando el botón de abajo.
      </Text>
      <Button href={verifyUrl} style={button}>
        Confirmar email
      </Button>
      <Text style={pSmall}>
        O pegá este enlace en tu navegador:
        <br />
        <Link href={verifyUrl} style={link}>
          {verifyUrl}
        </Link>
      </Text>
      <Text style={pMuted}>El enlace expira en 24 horas. Si vos no solicitaste esto, ignorá este mail.</Text>
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
