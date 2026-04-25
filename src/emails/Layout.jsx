import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from 'react-email';

const LOGO_TEXTO = 'https://res.cloudinary.com/dm80qflwa/image/upload/v1777082473/padeleando-txt_rokifd.png';
const LOGO_ICONO = 'https://res.cloudinary.com/dm80qflwa/image/upload/v1777081413/padeleando_lnbtop.png'

export default function Layout({ preview, children }) {
  return (
    <Html lang="es">
      <Head />
      {preview ? <Preview>{preview}</Preview> : null}
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Img
              src={LOGO_TEXTO}
              alt="Padeleando"
              width="160"
              style={logo}
            />
          </Section>
          <Section style={card}>{children}</Section>
          <Hr style={hr} />
          <Section style={footerSection}>
            <Img
              src={LOGO_ICONO}
              alt="Padeleando"
              width="100"
              style={logoFooter}
            />
            <Text style={footer}>
              Padeleando — tu compañero de pádel.
            </Text>
            <Text style={footerSmall}>
              Si no tenes nada que ver con el contenido de este mail, solo ignoralo.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const body = {
  backgroundColor: '#f4f6f8',
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif",
  margin: 0,
  padding: '24px 0',
};

const container = {
  maxWidth: '560px',
  margin: '0 auto',
  padding: '0 16px',
};

const header = {
  textAlign: 'center',
  padding: '16px 0',
};

const logo = {
  display: 'block',
  margin: '0 auto',
  height: 'auto',
};

const logoFooter = {
  display: 'block',
  margin: '0 auto 12px',
  height: 'auto',
  opacity: 0.7,
};

const footerSection = {
  textAlign: 'center',
};

const card = {
  backgroundColor: '#ffffff',
  borderRadius: '12px',
  padding: '32px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
};

const hr = {
  borderColor: '#e2e8f0',
  margin: '24px 0 12px',
};

const footer = {
  color: '#64748b',
  fontSize: '13px',
  textAlign: 'center',
  margin: '0 0 4px',
};

const footerSmall = {
  color: '#94a3b8',
  fontSize: '12px',
  textAlign: 'center',
  margin: 0,
};
