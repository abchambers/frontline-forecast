import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms governing use of Frontline Forecast's weather, radar, and classroom tools.",
};

const effectiveDate = "August 2, 2026";

export default function TermsOfServicePage() {
  return <main className="legal-page">
    <div className="legal-page-inner">
      <p className="eyebrow">Legal</p>
      <h1>Terms of Service</h1>
      <p className="legal-meta">Effective {effectiveDate}</p>
      <p className="legal-draft-notice">
        Frontline Forecast is currently in a pre-launch, proof-of-concept phase. These terms will be reviewed
        by counsel before any commercial or public launch. Questions can be sent to{" "}
        <a href="mailto:hello@frontline-forecast.com">hello@frontline-forecast.com</a>.
      </p>

      <h2>1. Accounts</h2>
      <p>
        There is no open public sign-up. Accounts are created by us or by an authorized school administrator
        or instructor, and are intended for the specific person they were issued to. You are responsible for
        keeping your password confidential and for activity on your account. Schools are responsible for
        confirming they have the authority to enroll each student they invite, including any parental
        notice or consent required under applicable law.
      </p>

      <h2>2. Weather information is for planning and education — not a substitute for official warnings</h2>
      <p>
        Frontline Forecast&rsquo;s forecasts, radar, and model data are provided for planning and educational
        use. They are <strong>not</strong> a substitute for official watches, warnings, and advisories issued
        by the National Weather Service or other government authorities. Never rely on this application for
        life-safety decisions during severe weather. Always follow official guidance from the National
        Weather Service (weather.gov) and local emergency management.
      </p>

      <h2>3. Classroom use</h2>
      <p>
        Instructors are responsible for the assignments, feedback, and grading decisions they make within
        their classroom. Forecasts, scores, and feedback exchanged within a classroom are visible to the
        instructor(s) of that classroom and, where applicable, to school administrators, consistent with our{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>4. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Share your account credentials or access the platform under another person&rsquo;s account.</li>
        <li>Attempt to access another user&rsquo;s or another school&rsquo;s data without authorization.</li>
        <li>Interfere with or overload the service (including automated scraping or bulk requests beyond normal use).</li>
        <li>Use the service for anything unlawful or for a purpose other than weather education and forecasting.</li>
      </ul>

      <h2>5. Third-party data</h2>
      <p>
        Forecast, radar, and model data are sourced in part from third-party providers, including the
        National Weather Service and other public and commercial data sources. We do not control the
        accuracy, availability, or continuity of that underlying data.
      </p>

      <h2>6. Service availability</h2>
      <p>
        The service is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis during this
        pre-launch phase. We do not guarantee uninterrupted availability and may modify or discontinue
        features as the product develops.
      </p>

      <h2>7. Termination</h2>
      <p>
        We may suspend or terminate an account that violates these terms. A school or instructor may request
        removal of an account they administer at any time. You may request deletion of your own account as
        described in our <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>8. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, Frontline Forecast is not liable for damages arising from
        reliance on forecast or radar information, or from service interruptions, including during a
        pre-launch or pilot period.
      </p>

      <h2>9. Changes to these terms</h2>
      <p>We will update the effective date above when these terms change, and will notify school administrators of material changes.</p>

      <h2>10. Contact</h2>
      <p>Questions about these terms can be sent to <a href="mailto:hello@frontline-forecast.com">hello@frontline-forecast.com</a>.</p>

      <p className="legal-back"><Link href="/">Back to Frontline Forecast</Link></p>
    </div>
  </main>;
}
