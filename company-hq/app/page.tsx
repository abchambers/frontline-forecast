const areas = [
  ["Company", "Organizations, licensing, seats, and support", "Foundation"],
  ["Product", "Release readiness, feature access, and pilot feedback", "Foundation"],
  ["Data", "Source health, provider rights, and usage controls", "Foundation"],
  ["Security", "Access review, incidents, and audit records", "Foundation"],
];

const sequence = [
  ["1", "Protect access", "Owner authentication, least-privilege roles, audit events."],
  ["2", "Connect safely", "Server-only integrations with explicit, reversible operations."],
  ["3", "Operate clearly", "Source health, cost signals, licensing, and support in one view."],
];

export default function Home() {
  return (
    <main className="shell">
      <header className="masthead">
        <div className="brand"><span className="mark" aria-hidden="true">FF</span><span>Frontline Forecast HQ</span></div>
        <span className="private">Private foundation · not connected</span>
      </header>

      <section className="hero">
        <p className="eyebrow">Company control plane</p>
        <h1>Operate the company<br />without crowding the product.</h1>
        <p>This is an isolated HQ foundation. It has no production credentials, customer records, live controls, or deployment connection yet.</p>
      </section>

      <section className="overview" aria-label="HQ foundations">
        {areas.map(([title, description, status]) => (
          <article key={title}>
            <p>{title}</p><h2>{description}</h2><span>{status}</span>
          </article>
        ))}
      </section>

      <section className="focus">
        <div><p className="eyebrow">Build order</p><h2>Deliberate controls, not a dashboard of decorative buttons.</h2></div>
        <ol>
          {sequence.map(([number, title, body]) => <li key={number}><b>{number}</b><div><strong>{title}</strong><p>{body}</p></div></li>)}
        </ol>
      </section>

      <section className="boundary">
        <p className="eyebrow">Production boundary</p>
        <h2>HQ will eventually use narrow, audited server actions—not browser-side access to the Forecast app, its users, or its secrets.</h2>
        <p>Before deployment, it requires separate authentication, a separate Vercel project, its own environment variables, and a written authorization model.</p>
      </section>
    </main>
  );
}
