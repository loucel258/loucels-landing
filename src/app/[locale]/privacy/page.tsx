import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { LegalShell } from "@/components/legal-shell";
import { siteConfig } from "@/lib/site-config";

const UPDATED = "2026-05-21";

export const metadata = {
  title: "Privacy Policy · Loucel Labs",
};

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const isES = locale === "es";

  return (
    <LegalShell
      locale={locale}
      title={isES ? "Política de Privacidad" : "Privacy Policy"}
      updated={UPDATED}
    >
      {isES ? (
        <>
          <p>
            En Loucel Labs respetamos tu privacidad. Esta política explica
            qué datos recopilamos, cómo los usamos y tus derechos.
          </p>

          <h2>Qué recopilamos</h2>
          <ul>
            <li>
              Datos que nos das voluntariamente al agendar una llamada o
              escribirnos por email (nombre, email, mensaje).
            </li>
            <li>
              Datos analíticos básicos del sitio (páginas vistas, dispositivo,
              referrer) recopilados de forma anónima.
            </li>
          </ul>

          <h2>Cómo lo usamos</h2>
          <ul>
            <li>Responder a tus consultas.</li>
            <li>Mejorar la calidad y rendimiento del sitio.</li>
            <li>Cumplir con obligaciones legales aplicables.</li>
          </ul>

          <h2>Compartir con terceros</h2>
          <p>
            No vendemos tus datos. Usamos proveedores cuidadosamente
            seleccionados para alojar el sitio (Vercel), agendar llamadas
            (Cal.com) y procesar email. Cada uno tiene su propia política
            de privacidad.
          </p>

          <h2>Datos procesados por sistemas de IA (clientes activos)</h2>
          <p>
            Cuando Loucel Labs opera agentes de IA para un cliente, los datos
            de ese cliente y sus clientes finales se procesan bajo principios
            estrictos de gobernanza:
          </p>
          <ul>
            <li>
              <strong>Zero Data Retention:</strong> usamos las APIs comerciales
              de Anthropic (Claude) bajo contratos que garantizan que tus datos
              nunca se almacenan en caché persistente ni se utilizan para
              entrenar modelos fundacionales de terceros.
            </li>
            <li>
              <strong>Cifrado:</strong> TLS 1.3 en tránsito y AES-256 en reposo
              a nivel de volumen de base de datos.
            </li>
            <li>
              <strong>Enmascaramiento de PII:</strong> los campos sensibles
              (SSN, tarjetas, direcciones, datos de identificación) se
              enmascaran antes de ser enviados al modelo de lenguaje.
            </li>
            <li>
              <strong>Audit trail inmutable:</strong> cada acción del agente
              queda registrada de forma append-only en logs que ni nuestro
              equipo técnico puede alterar.
            </li>
            <li>
              <strong>Aislamiento por workspace:</strong> los datos de cada
              cliente se aíslan mediante Row Level Security en la base de datos.
            </li>
          </ul>

          <h2>Tus derechos</h2>
          <p>
            Puedes solicitar acceso, corrección o eliminación de tus datos en
            cualquier momento escribiendo a{" "}
            <a href={`mailto:${siteConfig.contactEmail}`}>
              {siteConfig.contactEmail}
            </a>
            .
          </p>

          <h2>Contacto</h2>
          <p>
            Para cualquier consulta sobre privacidad escribinos a{" "}
            <a href={`mailto:${siteConfig.contactEmail}`}>
              {siteConfig.contactEmail}
            </a>
            .
          </p>
        </>
      ) : (
        <>
          <p>
            At Loucel Labs we respect your privacy. This policy explains what
            data we collect, how we use it, and your rights.
          </p>

          <h2>What we collect</h2>
          <ul>
            <li>
              Data you voluntarily provide when booking a call or emailing us
              (name, email, message).
            </li>
            <li>
              Basic anonymous analytics (page views, device, referrer).
            </li>
          </ul>

          <h2>How we use it</h2>
          <ul>
            <li>Respond to your inquiries.</li>
            <li>Improve site quality and performance.</li>
            <li>Comply with applicable legal obligations.</li>
          </ul>

          <h2>Third parties</h2>
          <p>
            We don&apos;t sell your data. We use carefully chosen providers
            for hosting (Vercel), scheduling (Cal.com), and email. Each has
            its own privacy policy.
          </p>

          <h2>Data processed by AI systems (active clients)</h2>
          <p>
            When Loucel Labs operates AI agents for a client, the client&apos;s
            data and end-customer data are processed under strict governance
            principles:
          </p>
          <ul>
            <li>
              <strong>Zero Data Retention:</strong> we use Anthropic&apos;s
              commercial Claude APIs under contracts guaranteeing your data
              is never persistently cached or used to train third-party
              foundation models.
            </li>
            <li>
              <strong>Encryption:</strong> TLS 1.3 in transit and AES-256 at
              rest at the database volume level.
            </li>
            <li>
              <strong>PII masking:</strong> sensitive fields (SSN, payment
              cards, addresses, identification data) are masked before they
              reach the language model.
            </li>
            <li>
              <strong>Immutable audit trail:</strong> every agent action is
              logged append-only. Not even our technical team can alter the
              record.
            </li>
            <li>
              <strong>Workspace isolation:</strong> client data is isolated
              using Row Level Security at the database layer.
            </li>
          </ul>

          <h2>Your rights</h2>
          <p>
            You can request access, correction, or deletion of your data at
            any time by emailing{" "}
            <a href={`mailto:${siteConfig.contactEmail}`}>
              {siteConfig.contactEmail}
            </a>
            .
          </p>

          <h2>Contact</h2>
          <p>
            For any privacy questions email{" "}
            <a href={`mailto:${siteConfig.contactEmail}`}>
              {siteConfig.contactEmail}
            </a>
            .
          </p>
        </>
      )}
    </LegalShell>
  );
}
