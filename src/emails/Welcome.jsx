import { Button, Heading, Section, Text } from 'react-email';
import Layout from './Layout.jsx';

const FEATURES = [
  { emoji: '🏆', title: 'Organizá torneos', desc: 'Formato Liga o Americano, con parejas fijas o jugadores libres.' },
  { emoji: '📊', title: 'Seguimiento en vivo', desc: 'Cargá partidos, mirá posiciones y estadísticas al instante.' },
  { emoji: '👥', title: 'Invitá y armá grupos', desc: 'Sumá a tus compañeros y llevá tus categorías en un solo lugar.' },
  { emoji: '🔗', title: 'Compartí con un link', desc: 'Publicá tus torneos para que cualquiera siga los resultados.' },
  { emoji: '👤', title: 'Tu perfil de padelero', desc: 'Win %, rachas, compañeros frecuentes y campeonatos ganados.' },
];

export default function Welcome({
  name = 'jugador',
  appUrl = 'https://padeleando.ar',
}) {
  return (
    <Layout preview="¡Bienvenido a Padeleando! Tu cuenta ya está activa">
      <Heading style={h1}>¡Tu cuenta ya está activa, {name}! 🎾</Heading>
      <Text style={p}>
        Confirmaste tu email y ya sos parte de Padeleando, tu compañero de padel.
        Esto es lo que podés hacer:
      </Text>

      <Section style={featureList}>
        {FEATURES.map((f) => (
          <Text key={f.title} style={featureRow}>
            <span style={featureEmoji}>{f.emoji}</span>{' '}
            <strong style={featureTitle}>{f.title}</strong>
            <br />
            <span style={featureDesc}>{f.desc}</span>
          </Text>
        ))}
      </Section>

      <Button href={appUrl} style={button}>
        Empezar a jugar
      </Button>

      <Text style={pMuted}>
        ¿Dudas o sugerencias? Respondé este mail y te leemos. ¡Nos vemos en la cancha!
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

const featureList = {
  margin: '0 0 28px',
};

const featureRow = {
  margin: '0 0 16px',
  paddingLeft: '32px',
  textIndent: '-32px',
};

const featureEmoji = {
  fontSize: '20px',
};

const featureTitle = {
  color: '#0f172a',
  fontSize: '15px',
  fontWeight: 600,
};

const featureDesc = {
  color: '#475569',
  fontSize: '14px',
  lineHeight: '20px',
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

const pMuted = {
  color: '#94a3b8',
  fontSize: '12px',
  margin: '24px 0 0',
  lineHeight: '18px',
};
