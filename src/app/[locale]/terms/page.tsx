import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { LegalShell } from "@/components/legal-shell";
import { siteConfig } from "@/lib/site-config";

const UPDATED = "2026-05-21";

export const metadata = {
  title: "Terms of Service · Loucels",
};

export default async function TermsPage({
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
      title={isES ? "Términos de Servicio" : "Terms of Service"}
      updated={UPDATED}
    >
      {isES ? (
        <>
          <p>
            Al usar este sitio o contratar nuestros servicios aceptas los
            siguientes términos.
          </p>

          <h2>1. Servicios</h2>
          <p>
            Loucels ofrece diseño web (Web Foundation), agentes de IA
            especializados (Modelos SMV) y arquitectura/gobernanza de IA
            enterprise (Integration &amp; Control). El alcance específico de
            cada proyecto queda definido en la propuesta firmada (SOW) entre
            cliente y Loucels.
          </p>

          <h2>2. Pagos</h2>
          <p>
            Los proyectos se cobran según lo acordado en la propuesta.
            Típicamente: 50% al inicio, 50% a la entrega. Los retainers
            mensuales se cobran por adelantado el primer día del mes.
            Servicios paralizados por falta de pago se reanudan tras la
            regularización.
          </p>

          <h2>3. Propiedad intelectual</h2>
          <p>
            Una vez completado el pago total, el cliente recibe propiedad
            completa de los entregables específicos del proyecto: código
            fuente del agente, arquitectura desplegada, configuraciones
            personalizadas y documentación de operación. La filosofía es
            <em> tuyo por construcción</em>.
          </p>
          <p>
            Permanecen como propiedad de Loucels: librerías internas
            reutilizables, frameworks generales de gobernanza, plantillas de
            audit logging y metodología de implementación que aplicamos
            transversalmente entre clientes.
          </p>

          <h2>4. Retainer mensual (gobernanza)</h2>
          <p>
            El retainer mensual no es alquiler de software. Cubre
            <em> gobernanza continua</em> del agente desplegado:
          </p>
          <ul>
            <li>Monitoreo de outputs para detectar desviaciones (drift)</li>
            <li>Actualizaciones del guion del agente según nuevos casos</li>
            <li>Tuning de performance y métricas de conversión</li>
            <li>Despliegue de canales o integraciones adicionales</li>
            <li>Mantenimiento de controles de seguridad alineados a estándares vigentes</li>
            <li>Reporte mensual de actividad y recomendaciones</li>
          </ul>
          <p>
            El cliente puede cancelar el retainer con aviso de 30 días. La
            arquitectura desplegada permanece operativa, pero la gobernanza
            activa cesa al final del período pagado.
          </p>

          <h2>5. Confidencialidad</h2>
          <p>
            Tratamos toda información de cliente como confidencial.
            Acuerdos NDA específicos están disponibles a solicitud.
          </p>

          <h2>6. Limitación de responsabilidad</h2>
          <p>
            Nuestra responsabilidad total queda limitada al monto pagado
            por el proyecto en cuestión. No nos hacemos responsables por
            daños indirectos, lucro cesante o consecuenciales.
          </p>

          <h2>7. Cambios a estos términos</h2>
          <p>
            Podemos actualizar estos términos. Cambios materiales serán
            notificados a clientes activos vía email.
          </p>

          <h2>Contacto</h2>
          <p>
            Preguntas:{" "}
            <a href={`mailto:${siteConfig.contactEmail}`}>
              {siteConfig.contactEmail}
            </a>
            .
          </p>
        </>
      ) : (
        <>
          <p>
            By using this site or hiring our services you accept the
            following terms.
          </p>

          <h2>1. Services</h2>
          <p>
            Loucels offers web design (Web Foundation), specialized AI
            agents (SMV Models), and enterprise AI architecture and
            governance (Integration &amp; Control). The specific scope of
            each project is defined in the signed proposal (SOW) between
            client and Loucels.
          </p>

          <h2>2. Payments</h2>
          <p>
            Projects are billed as agreed in the proposal. Typically: 50%
            upfront, 50% on delivery. Monthly retainers are billed in
            advance on the first day of each month. Services paused for
            non-payment resume after the balance is settled.
          </p>

          <h2>3. Intellectual property</h2>
          <p>
            Upon full payment, the client receives complete ownership of
            project-specific deliverables: agent source code, deployed
            architecture, custom configurations, and operations
            documentation. The philosophy is <em>owned by you, built by us</em>.
          </p>
          <p>
            What remains property of Loucels: internal reusable
            libraries, general governance frameworks, audit logging
            templates, and the implementation methodology we apply across
            clients.
          </p>

          <h2>4. Monthly retainer (governance)</h2>
          <p>
            The monthly retainer is not software rental. It covers
            <em> continuous governance</em> of the deployed agent:
          </p>
          <ul>
            <li>Output monitoring to detect drift</li>
            <li>Script updates as new cases appear</li>
            <li>Performance tuning and conversion metrics</li>
            <li>Deployment of additional channels or integrations</li>
            <li>Maintenance of security controls aligned to current standards</li>
            <li>Monthly activity report and recommendations</li>
          </ul>
          <p>
            The client may cancel the retainer with 30 days&apos; notice. The
            deployed architecture remains operational, but active governance
            ceases at the end of the paid period.
          </p>

          <h2>5. Confidentiality</h2>
          <p>
            We treat all client information as confidential. Specific NDAs
            are available on request.
          </p>

          <h2>6. Limitation of liability</h2>
          <p>
            Our total liability is limited to the amount paid for the
            project in question. We are not liable for indirect, lost
            profits, or consequential damages.
          </p>

          <h2>7. Changes to these terms</h2>
          <p>
            We may update these terms. Material changes will be notified to
            active clients via email.
          </p>

          <h2>Contact</h2>
          <p>
            Questions:{" "}
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
