// Sign in (FR-IAM-002, design §6.6): split card — form on the left, an illustrated product hero on the right.
import { useMemo, useState } from 'react';
import { CheckCircleIcon, EyeIcon } from '../../components/Icons';
import { db, C, session } from '../../store';
import type { User, Company, Tenant, Plan } from '../../store';
import { Backdrop, BrandMark, GoogleMark, MicrosoftMark, deviceTrust } from './Frame';
import { StorysetAnimated } from '../../components/ui/storyset';

interface LoginProps {
  onLogin?: () => void;
  onCreateAccount?: () => void;
}

export default function Login({ onLogin, onCreateAccount }: LoginProps) {
  const [email, setEmail] = useState('aarav@elixirglobal.in');
  const [password, setPassword] = useState('••••••••••');
  const [agreed, setAgreed] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const banner = session.get().loginBanner;
  const users = db.get<User>(C.users);
  const preview = useMemo(() => {
    const co = db.find<Company>(C.companies, 'co_acme') ?? db.get<Company>(C.companies)[0];
    const tenant = db.find<Tenant>(C.tenants, co?.tenantId);
    const plan = db.find<Plan>(C.plans, tenant?.planId);
    return { co, tenant, plan };
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!agreed) { setError('Please accept the Terms & Conditions to continue.'); return; }
    const user = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user) { setError('No account found for that email. Try one of the demo users below.'); return; }
    if (user.status === 'Invited') { setError('This invitation has not been accepted yet — open the invitation link to set a password.'); return; }
    if (user.status === 'Suspended') { setError('This account is suspended — contact your company administrator (AUTH_SUSPENDED).'); return; }
    if (user.status === 'Deactivated') { setError('This account has been deactivated and can no longer sign in (AUTH_DEACTIVATED).'); return; }
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      try {
        session.login(user.id, { skipMfa: user.mfaEnabled && deviceTrust.isTrusted(user.id) });
        onLogin?.();
      } catch (err: any) {
        setError(err?.message ?? 'Sign-in failed');
      }
    }, 500);
  };

  const pitch = [
    'GST-ready invoicing, e-invoices and e-way bills',
    'Approvals, audit trail and period locks on every posting',
    'Live cash, receivables and payables on one dashboard',
  ];

  return (
    <Backdrop>
      <div className="auth-split" style={{ width: '100%', maxWidth: 960, background: 'var(--surface)', borderRadius: 16, boxShadow: '0 8px 48px rgba(0,0,0,0.10)', display: 'flex', overflow: 'hidden', minHeight: 560 }}>
        {/* Left – form */}
        <div className="auth-main" style={{ width: 420, flexShrink: 0, padding: '48px 40px', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--hairline)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 36 }}>
            <BrandMark />
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.02em' }}>Elixir Books</span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', marginBottom: 4, lineHeight: 1.3 }}>Welcome back</h1>
          <p style={{ fontSize: 14, color: 'var(--ink-3)', marginBottom: 28 }}>Sign in to {preview.tenant?.name ?? 'your workspace'} · {preview.plan?.name ?? 'Growth'} Edition</p>

          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            <button type="button" className="btn-secondary" style={{ flex: 1, justifyContent: 'center', gap: 8 }} title="SSO is configured per edition (FR-IAM-007)" onClick={() => setError('Google SSO is not configured for this workspace — sign in with your work email, or ask the tenant owner to enable SSO (FR-IAM-007).')}>
              <GoogleMark /> Google
            </button>
            <button type="button" className="btn-secondary" style={{ flex: 1, justifyContent: 'center', gap: 8 }} onClick={() => setError('Microsoft SSO is not configured for this workspace — sign in with your work email, or ask the tenant owner to enable SSO (FR-IAM-007).')}>
              <MicrosoftMark /> Microsoft
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--line)' }} /><span style={{ fontSize: 12, color: 'var(--ink-5)' }}>or</span><div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
          </div>

          {banner && <div className="banner success" style={{ marginBottom: 14 }}>{banner}</div>}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label className="section-label" style={{ display: 'block', marginBottom: 6 }}>Work Email</label>
              <input className="field-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="username" />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <label className="section-label">Password</label>
                <button type="button" style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--accent)', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }} onClick={() => session.setAuth('forgot', { loginBanner: undefined })}>Forgot password?</button>
              </div>
              <div style={{ position: 'relative' }}>
                <input className="field-input" type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" style={{ paddingRight: 44 }} autoComplete="current-password" />
                <button type="button" aria-label={showPw ? 'Hide password' : 'Show password'} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: showPw ? 'var(--accent)' : 'var(--ink-3)', display: 'flex' }} onClick={() => setShowPw(!showPw)}>
                  <EyeIcon size={16} />
                </button>
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--ink-3)' }}>
              <input type="checkbox" className="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 1 }} />
              <span>I agree to the <a href="#/" onClick={(e) => e.preventDefault()} style={{ color: 'var(--accent)', textDecoration: 'none' }}>Terms & Conditions</a> and <a href="#/" onClick={(e) => e.preventDefault()} style={{ color: 'var(--accent)', textDecoration: 'none' }}>Privacy Policy</a></span>
            </label>
            {error && <div className="banner danger" role="alert">{error}</div>}
            <button type="submit" className="btn-primary" style={{ justifyContent: 'center', height: 44, marginTop: 4 }} disabled={loading}>
              {loading ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" strokeWidth="3" /><path d="M12 2a10 10 0 0110 10" stroke="white" strokeWidth="3" strokeLinecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" /></path></svg>
              ) : null}
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <div style={{ marginTop: 16 }}>
            <div className="section-label" style={{ marginBottom: 6 }}>Demo users (any password)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {users.filter((u) => u.status === 'Active').slice(0, 12).map((u) => (
                <button key={u.id} type="button" className={`chip ${email === u.email ? 'selected' : ''}`} onClick={() => { setEmail(u.email); setError(null); }} title={`${u.email}${u.mfaEnabled ? ' · MFA' : ''}${u.isPlatformAdmin ? ' · platform' : ''}`}>{u.name}</button>
              ))}
              {users.filter((u) => u.status === 'Suspended').slice(0, 1).map((u) => (
                <button key={u.id} type="button" className="chip" onClick={() => { setEmail(u.email); setError(null); }} title="Suspended account — sign-in is refused">{u.name} (suspended)</button>
              ))}
              {users.filter((u) => u.status === 'Invited' && u.inviteToken).slice(0, 1).map((u) => (
                <button key={u.id} type="button" className="chip" onClick={() => session.setAuth('invite', { inviteToken: u.inviteToken, loginBanner: undefined })}>Open invitation link</button>
              ))}
            </div>
          </div>
          <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 16, textAlign: 'center' }}>
            {"Don't have an account? "}
            <button type="button" onClick={onCreateAccount} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 500, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Start free trial</button>
          </p>
        </div>

        {/* Right – hero */}
        <div className="auth-aside" style={{ flex: 1, background: 'var(--surface-2)', borderLeft: '1px solid var(--hairline)', padding: '32px 36px', display: 'flex', flexDirection: 'column', gap: 16, overflow: 'hidden' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>Elixir Books {preview.plan?.name ?? 'Growth'} · {preview.co?.legalName ?? 'Elixir Business Solution Pvt Ltd'}</div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, minHeight: 0 }}>
            <StorysetAnimated name="finance" width={300} label="A finance team reviewing charts and coins" />
            <div style={{ maxWidth: 360 }}>
              <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em', lineHeight: 1.3, textAlign: 'center', marginBottom: 12 }}>Books that stay closed</h2>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pitch.map((line) => (
                  <li key={line} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.45 }}>
                    <span style={{ color: 'var(--good)', display: 'inline-flex', marginTop: 1, flexShrink: 0 }}><CheckCircleIcon size={15} /></span>{line}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center' }}>{preview.co?.legalName ?? 'Elixir Business Solution Pvt Ltd'} · {preview.co?.address.city ?? 'Mumbai'} · FY {preview.co ? (preview.co.fiscalYearStartMonth === 4 ? '2026–27' : '2026') : '2026–27'} · Sep 2026 ● Open</p>
        </div>
      </div>
    </Backdrop>
  );
}
