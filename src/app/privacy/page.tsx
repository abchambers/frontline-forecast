import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Frontline Forecast collects, uses, and protects account and forecast data.",
};

const effectiveDate = "August 2, 2026";

export default function PrivacyPolicyPage() {
  return <main className="legal-page">
    <div className="legal-page-inner">
      <p className="eyebrow">Legal</p>
      <h1>Privacy Policy</h1>
      <p className="legal-meta">Effective {effectiveDate}</p>
      <p className="legal-draft-notice">
        Frontline Forecast is currently in a pre-launch, proof-of-concept phase. This policy describes our
        practices today and will be reviewed by counsel before any commercial or public launch. If you have
        questions, contact <a href="mailto:privacy@frontline-forecast.com">privacy@frontline-forecast.com</a>.
      </p>

      <h2>1. Who this applies to</h2>
      <p>
        Frontline Forecast (&ldquo;we,&rdquo; &ldquo;us&rdquo;) provides weather forecasting, radar, and
        forecast-verification tools, including a classroom mode used by schools and instructors
        (&ldquo;School Users&rdquo;) and their students. There is no open, public self-registration —
        every account is created by us or by an authorized school administrator or instructor inviting a
        specific person. This policy covers all accounts on the platform.
      </p>

      <h2>2. Information we collect</h2>
      <ul>
        <li><strong>Account information:</strong> name, email address, and password (stored by our authentication provider in hashed form; we never see or store plaintext passwords).</li>
        <li><strong>Educational context:</strong> school or classroom affiliation, role (instructor or student), assignments, forecast submissions, instructor feedback, and verification scores.</li>
        <li><strong>Usage data:</strong> which forecast locations, radar layers, and reference data you view, to keep the app working and to improve it.</li>
        <li><strong>Technical data:</strong> IP address and basic request metadata, used only for rate-limiting abuse and for security logs.</li>
      </ul>
      <p>We do not knowingly collect information from the general public through an open sign-up form, because no such form exists.</p>

      <h2>3. How we use information</h2>
      <ul>
        <li>To operate your account, save your forecasts, and show you your own history.</li>
        <li>To let instructors review and score their own students&rsquo; work within their own classroom.</li>
        <li>To keep the service secure (for example, detecting abuse of shared infrastructure).</li>
        <li>To improve the product based on aggregate, non-identifying usage patterns.</li>
      </ul>
      <p>We do not sell personal information, and we do not use student data for advertising, profiling, or any purpose outside the educational service a school has engaged us to provide.</p>

      <h2>4. Children&rsquo;s privacy and school accounts (COPPA)</h2>
      <p>
        Frontline Forecast does not operate an open public registration page, and we do not knowingly collect
        personal information directly from children under 13 outside of a school relationship. Student
        accounts are created by a school or instructor, who is acting on behalf of the school and, where
        required, on behalf of parents, consistent with the Family Educational Rights and Privacy Act
        (FERPA) and the Children&rsquo;s Online Privacy Protection Act (COPPA) &ldquo;school official&rdquo;
        exception for services used strictly for an educational purpose. Schools are responsible for
        providing any parental notice required under applicable law before enrolling a student. We use
        student data only to provide the educational service the school directed, and for no other purpose.
      </p>

      <h2>5. Educational records (FERPA)</h2>
      <p>
        Forecast submissions, instructor feedback, and verification scores collected through a school&rsquo;s
        classroom may constitute education records under FERPA. We act as a school official with a legitimate
        educational interest, under the direct control of the school with respect to the use and maintenance
        of those records, and we do not disclose them except as directed by the school or as required by law.
      </p>

      <h2>6. Data sharing</h2>
      <p>
        We share data only with the service providers that operate the platform (currently our hosting and
        database providers), under agreements that restrict them to providing that infrastructure, and where
        required by law. We do not sell or rent personal information to third parties.
      </p>

      <h2>7. Data retention and deletion</h2>
      <p>
        You can request deletion of your account from the Control Panel, or by emailing{" "}
        <a href="mailto:privacy@frontline-forecast.com">privacy@frontline-forecast.com</a>. Deleting your
        account removes your login credentials and personal profile information. Where a school has an
        educational-record interest in your submitted classwork (for example, an instructor&rsquo;s grading
        record), that classwork may be retained in de-identified form as part of the school&rsquo;s records
        rather than fully erased, consistent with the school&rsquo;s own record-retention obligations.
      </p>

      <h2>8. Security</h2>
      <p>
        We use industry-standard practices to protect your data, including encrypted connections and
        row-level access controls that restrict who can read or write each record. No system is perfectly
        secure, and we will notify affected users if we become aware of a breach affecting their information.
      </p>

      <h2>9. Changes to this policy</h2>
      <p>We will update the effective date above when this policy changes, and will notify school administrators of material changes.</p>

      <h2>10. Contact</h2>
      <p>Questions about this policy or your data can be sent to <a href="mailto:privacy@frontline-forecast.com">privacy@frontline-forecast.com</a>.</p>

      <p className="legal-back"><Link href="/">Back to Frontline Forecast</Link></p>
    </div>
  </main>;
}
