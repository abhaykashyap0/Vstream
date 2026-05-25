import React, { useState, useContext, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { auth } from '../firebase';
import { AuthContext } from '../context/AuthContext';
import { Music, Mail, Phone, ArrowLeft } from 'lucide-react';

const API = process.env.REACT_APP_API_URL || '';

const Login = () => {
  const [method, setMethod]       = useState('email');
  const [loginType, setLoginType] = useState('password');
  const [step, setStep]           = useState(1);
  const [formData, setFormData]   = useState({ email: '', phone: '', password: '' });
  const [otp, setOtp]             = useState(['','','','','','']);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');
  const [confirmResult, setConfirmResult] = useState(null);
  const otpRefs      = useRef([]);
  const hiddenInputRef = useRef(null);
  const recaptchaRef = useRef(null);
  const { login }    = useContext(AuthContext);
  const navigate     = useNavigate();

  const reset = () => { setStep(1); setOtp(['','','','','','']); setError(''); setSuccess(''); };

  useEffect(() => {
    if (method === 'phone' && !recaptchaRef.current) {
      recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container-login', { size: 'invisible' });
    }
  }, [method]);

  // Single hidden input approach — no per-box clicking needed
  
  const handleOtpInput = (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    const arr = value.split('');
    const newOtp = ['','','','','',''];
    arr.forEach((d, i) => { newOtp[i] = d; });
    setOtp(newOtp);
  };

  // ── Password login ─────────────────────────────────────────────
  const handlePasswordLogin = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const { data } = await axios.post(`${API}/api/auth/login`, { email: formData.email, password: formData.password });
      login(data); navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed');
    } finally { setLoading(false); }
  };

  // ── Email OTP login ────────────────────────────────────────────
  const handleEmailSendOtp = async (e) => {
    e?.preventDefault();
    setLoading(true); setError(''); setSuccess('');
    try {
      const { data } = await axios.post(`${API}/api/auth/login/send-otp`, { email: formData.email });
      setSuccess(data.message); setStep(2);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send OTP');
    } finally { setLoading(false); }
  };

  const handleEmailVerifyOtp = async () => {
    const otpString = otp.join('');
    if (otpString.length !== 6) return setError('Enter complete 6-digit OTP');
    setLoading(true); setError('');
    try {
      const { data } = await axios.post(`${API}/api/auth/login/verify-otp`, { email: formData.email, otp: otpString });
      login(data); navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid OTP');
      setOtp(['','','','','','']); otpRefs.current[0]?.focus();
    } finally { setLoading(false); }
  };

  // ── Phone login via Firebase ───────────────────────────────────
  const handlePhoneSendOtp = async (e) => {
    e?.preventDefault();
    setLoading(true); setError('');
    try {
      if (!recaptchaRef.current) {
        recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container-login', { size: 'invisible' });
      }
      const result = await signInWithPhoneNumber(auth, formData.phone, recaptchaRef.current);
      setConfirmResult(result);
      setSuccess(`OTP sent to ${formData.phone}`);
      setStep(2);
    } catch (err) {
      console.error('Firebase OTP error:', err);
      setError('Failed to send OTP. Check phone format (+91XXXXXXXXXX)');
      recaptchaRef.current = null;
    } finally { setLoading(false); }
  };

  const handlePhoneVerifyOtp = async () => {
    const otpString = otp.join('');
    if (otpString.length !== 6) return setError('Enter complete 6-digit OTP');
    setLoading(true); setError('');
    try {
      const result    = await confirmResult.confirm(otpString);
      const token     = await result.user.getIdToken();
      const { data }  = await axios.post(`${API}/api/auth/phone/firebase-verify`, { firebaseToken: token });
      if (data.needsUsername) {
        return setError('No account found. Please sign up first.');
      }
      login(data); navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid OTP');
      setOtp(['','','','','','']); otpRefs.current[0]?.focus();
    } finally { setLoading(false); }
  };

  const OtpBoxes = ({ onVerify }) => (
    <>
      {/* Single hidden input captures all typing */}
      <input
        ref={hiddenInputRef}
        type="tel"
        inputMode="numeric"
        value={otp.join('')}
        onChange={handleOtpInput}
        maxLength={6}
        style={{
          position: 'absolute', opacity: 0, pointerEvents: 'none',
          width: 0, height: 0, border: 'none', outline: 'none'
        }}
        autoComplete="one-time-code"
      />

      {/* Visual boxes — clicking any box focuses hidden input */}
      <div
        style={{ display: 'flex', gap: 'clamp(6px, 2vw, 12px)', justifyContent: 'center', marginBottom: '24px', cursor: 'text' }}
        onClick={() => hiddenInputRef.current?.focus()}
      >
        {otp.map((digit, i) => {
          const isActive = otp.filter(Boolean).length === i ||
                           (i === 5 && otp.filter(Boolean).length === 6);
          return (
            <div
              key={i}
              onClick={() => hiddenInputRef.current?.focus()}
              style={{
                width: '44px', height: '54px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.6rem', fontWeight: 700,
                background: digit ? 'rgba(29,185,84,0.15)' : '#1a1a1a',
                border: `2px solid ${isActive ? '#1db954' : digit ? '#1db954' : '#444'}`,
                borderRadius: '10px', color: 'white',
                transition: 'all 0.15s',
                boxShadow: isActive ? '0 0 0 3px rgba(29,185,84,0.2)' : 'none',
                userSelect: 'none', cursor: 'text'
              }}
            >
              {digit || (isActive ?
                <span style={{ width: '2px', height: '24px', background: '#1db954', animation: 'blink 1s infinite' }} />
                : ''
              )}
            </div>
          );
        })}
      </div>

      <button onClick={onVerify} className="btn-primary" disabled={loading}
        style={{ width: '100%', borderRadius: '8px', padding: '13px', fontSize: '1rem' }}>
        {loading ? 'Verifying...' : 'Verify OTP'}
      </button>
    </>
  );

  return (
    <div className="auth-form">
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <Music color="#1db954" size={36} style={{ marginBottom: '10px' }} />
        <h2 style={{ margin: 0 }}>Welcome back</h2>
        <p style={{ color: '#b3b3b3', marginTop: '6px', fontSize: '0.9rem' }}>Log in to VStream</p>
      </div>

      {step === 1 && (
        <div style={{ display: 'flex', background: '#121212', borderRadius: '8px', padding: '4px', marginBottom: '20px' }}>
          {['email','phone'].map(m => (
            <button key={m} onClick={() => { setMethod(m); reset(); setLoginType('password'); }}
              style={{
                flex: 1, padding: '9px', border: 'none', borderRadius: '6px', cursor: 'pointer',
                fontWeight: 600, fontSize: '0.88rem', transition: 'all 0.2s',
                background: method === m ? '#1db954' : 'transparent',
                color: method === m ? 'white' : '#b3b3b3',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
              }}>
              {m === 'email' ? <Mail size={15}/> : <Phone size={15}/>}
              {m === 'email' ? 'Email' : 'Phone'}
            </button>
          ))}
        </div>
      )}

      {error && <div style={{ background: '#2a1a1a', border: '1px solid #ff4444', borderRadius: '8px', padding: '10px 14px', color: '#ff6666', fontSize: '0.85rem', marginBottom: '14px' }}>{error}</div>}
      {success && <div style={{ background: '#1a2a1a', border: '1px solid #1db954', borderRadius: '8px', padding: '10px 14px', color: '#1db954', fontSize: '0.85rem', marginBottom: '14px' }}>{success}</div>}

      {/* ── STEP 1 EMAIL ── */}
      {step === 1 && method === 'email' && (
        <>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            {['password','otp'].map(t => (
              <button key={t} onClick={() => { setLoginType(t); setError(''); }}
                style={{
                  flex: 1, padding: '8px', border: `1px solid ${loginType === t ? '#1db954' : '#333'}`,
                  borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem',
                  background: loginType === t ? 'rgba(29,185,84,0.1)' : 'transparent',
                  color: loginType === t ? '#1db954' : '#b3b3b3', transition: 'all 0.2s'
                }}>
                {t === 'password' ? '🔑 Password' : '📧 Email OTP'}
              </button>
            ))}
          </div>
          {loginType === 'password' ? (
            <form onSubmit={handlePasswordLogin}>
              <input type="email" placeholder="Email address" required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
              <input type="password" placeholder="Password" required value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
              <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', borderRadius: '8px', padding: '13px', fontSize: '1rem' }}>
                {loading ? 'Logging in...' : 'Log In'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleEmailSendOtp}>
              <input type="email" placeholder="Email address" required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
              <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', borderRadius: '8px', padding: '13px', fontSize: '1rem' }}>
                {loading ? 'Sending...' : 'Send OTP'}
              </button>
            </form>
          )}
        </>
      )}

      {/* ── STEP 1 PHONE ── */}
      {step === 1 && method === 'phone' && (
        <form onSubmit={handlePhoneSendOtp}>
          <input type="tel" placeholder="+91 9876543210" required value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
          <p style={{ color: '#666', fontSize: '0.78rem', marginTop: '-8px', marginBottom: '14px' }}>Include country code e.g. +91 for India</p>
          <div id="recaptcha-container-login"></div>
          <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', borderRadius: '8px', padding: '13px', fontSize: '1rem' }}>
            {loading ? 'Sending...' : 'Send OTP via SMS'}
          </button>
        </form>
      )}

      {/* ── STEP 2 OTP ── */}
      {step === 2 && (() => { setTimeout(() => hiddenInputRef.current?.focus(), 100); return null; })()}
      {step === 2 && (
        <div>
          <button onClick={reset} style={{ background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '20px', padding: 0 }}>
            <ArrowLeft size={16} /> Back
          </button>
          <p style={{ color: '#b3b3b3', fontSize: '0.9rem', marginBottom: '20px', textAlign: 'center' }}>
            Enter the 6-digit code sent to<br />
            <strong style={{ color: 'white' }}>{method === 'email' ? formData.email : formData.phone}</strong>
          </p>
          <OtpBoxes onVerify={method === 'phone' ? handlePhoneVerifyOtp : handleEmailVerifyOtp} />
          <button onClick={method === 'phone' ? handlePhoneSendOtp : handleEmailSendOtp}
            style={{ width: '100%', background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', marginTop: '12px', fontSize: '0.85rem' }}>
            Didn't receive it? <span style={{ color: '#1db954' }}>Resend OTP</span>
          </button>
        </div>
      )}

      <p style={{ marginTop: '20px', textAlign: 'center', color: '#b3b3b3', fontSize: '0.9rem' }}>
        Don't have an account?{' '}
        <Link to="/signup" style={{ color: '#1db954', fontWeight: 600 }}>Sign up free</Link>
      </p>
    </div>
  );
};

export default Login;

// import React, { useState, useContext, useRef, useEffect } from 'react';
// import { useNavigate, Link } from 'react-router-dom';
// import axios from 'axios';
// import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
// import { auth } from '../firebase';
// import { AuthContext } from '../context/AuthContext';
// import { Music, Mail, Phone, ArrowLeft } from 'lucide-react';

// const API = process.env.REACT_APP_API_URL || '';

// const Login = () => {
//   const [method, setMethod]       = useState('email');
//   const [loginType, setLoginType] = useState('password');
//   const [step, setStep]           = useState(1);
//   const [formData, setFormData]   = useState({ email: '', phone: '', password: '' });
//   const [otp, setOtp]             = useState(['','','','','','']);
//   const [loading, setLoading]     = useState(false);
//   const [error, setError]         = useState('');
//   const [success, setSuccess]     = useState('');
//   const [confirmResult, setConfirmResult] = useState(null);
//   const otpRefs      = useRef([]);
//   const recaptchaRef = useRef(null);
//   const { login }    = useContext(AuthContext);
//   const navigate     = useNavigate();

//   const reset = () => { setStep(1); setOtp(['','','','','','']); setError(''); setSuccess(''); };

//   useEffect(() => {
//     if (method === 'phone' && !recaptchaRef.current) {
//       recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container-login', { size: 'invisible' });
//     }
//   }, [method]);

//   const handleOtpChange = (index, e) => {
//     const value = e.target.value.replace(/\D/g, ''); // digits only

//     // Handle paste of full OTP
//     if (value.length > 1) {
//       const digits = value.slice(0, 6).split('');
//       const newOtp = ['','','','','',''];
//       digits.forEach((d, i) => { newOtp[i] = d; });
//       setOtp(newOtp);
//       otpRefs.current[Math.min(digits.length, 5)]?.focus();
//       return;
//     }

//     const newOtp = [...otp];
//     newOtp[index] = value.slice(-1); // take last digit typed
//     setOtp(newOtp);

//     // Move forward immediately
//     if (value && index < 5) {
//       otpRefs.current[index + 1]?.focus();
//     }
//   };

//   const handleOtpKeyDown = (index, e) => {
//     if (e.key === 'Backspace') {
//       if (otp[index]) {
//         // Clear current box
//         const newOtp = [...otp];
//         newOtp[index] = '';
//         setOtp(newOtp);
//       } else if (index > 0) {
//         // Move back and clear
//         const newOtp = [...otp];
//         newOtp[index - 1] = '';
//         setOtp(newOtp);
//         otpRefs.current[index - 1]?.focus();
//       }
//       e.preventDefault();
//     }
//     if (e.key === 'ArrowLeft' && index > 0) otpRefs.current[index - 1]?.focus();
//     if (e.key === 'ArrowRight' && index < 5) otpRefs.current[index + 1]?.focus();
//   };

//   // ── Password login ─────────────────────────────────────────────
//   const handlePasswordLogin = async (e) => {
//     e.preventDefault();
//     setLoading(true); setError('');
//     try {
//       const { data } = await axios.post(`${API}/api/auth/login`, { email: formData.email, password: formData.password });
//       login(data); navigate('/');
//     } catch (err) {
//       setError(err.response?.data?.message || 'Login failed');
//     } finally { setLoading(false); }
//   };

//   // ── Email OTP login ────────────────────────────────────────────
//   const handleEmailSendOtp = async (e) => {
//     e?.preventDefault();
//     setLoading(true); setError(''); setSuccess('');
//     try {
//       const { data } = await axios.post(`${API}/api/auth/login/send-otp`, { email: formData.email });
//       setSuccess(data.message); setStep(2);
//     } catch (err) {
//       setError(err.response?.data?.message || 'Failed to send OTP');
//     } finally { setLoading(false); }
//   };

//   const handleEmailVerifyOtp = async () => {
//     const otpString = otp.join('');
//     if (otpString.length !== 6) return setError('Enter complete 6-digit OTP');
//     setLoading(true); setError('');
//     try {
//       const { data } = await axios.post(`${API}/api/auth/login/verify-otp`, { email: formData.email, otp: otpString });
//       login(data); navigate('/');
//     } catch (err) {
//       setError(err.response?.data?.message || 'Invalid OTP');
//       setOtp(['','','','','','']); otpRefs.current[0]?.focus();
//     } finally { setLoading(false); }
//   };

//   // ── Phone login via Firebase ───────────────────────────────────
//   const handlePhoneSendOtp = async (e) => {
//     e?.preventDefault();
//     setLoading(true); setError('');
//     try {
//       if (!recaptchaRef.current) {
//         recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container-login', { size: 'invisible' });
//       }
//       const result = await signInWithPhoneNumber(auth, formData.phone, recaptchaRef.current);
//       setConfirmResult(result);
//       setSuccess(`OTP sent to ${formData.phone}`);
//       setStep(2);
//     } catch (err) {
//       console.error('Firebase OTP error:', err);
//       setError('Failed to send OTP. Check phone format (+91XXXXXXXXXX)');
//       recaptchaRef.current = null;
//     } finally { setLoading(false); }
//   };

//   const handlePhoneVerifyOtp = async () => {
//     const otpString = otp.join('');
//     if (otpString.length !== 6) return setError('Enter complete 6-digit OTP');
//     setLoading(true); setError('');
//     try {
//       const result    = await confirmResult.confirm(otpString);
//       const token     = await result.user.getIdToken();
//       const { data }  = await axios.post(`${API}/api/auth/phone/firebase-verify`, { firebaseToken: token });
//       if (data.needsUsername) {
//         return setError('No account found. Please sign up first.');
//       }
//       login(data); navigate('/');
//     } catch (err) {
//       setError(err.response?.data?.message || 'Invalid OTP');
//       setOtp(['','','','','','']); otpRefs.current[0]?.focus();
//     } finally { setLoading(false); }
//   };

//   const OtpBoxes = ({ onVerify }) => (
//     <>
//       <div style={{ display: 'flex', gap: 'clamp(6px, 2vw, 10px)', justifyContent: 'center', marginBottom: '24px' }}>
//         {otp.map((digit, i) => (
//           <input key={i} ref={el => otpRefs.current[i] = el}
//             type="tel" inputMode="numeric" maxLength={2} value={digit}
//             onChange={e => handleOtpChange(i, e)}
//             onKeyDown={e => handleOtpKeyDown(i, e)}
//             onFocus={e => e.target.select()}
//             onPaste={e => {
//               e.preventDefault();
//               const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
//               const newOtp = ['','','','','',''];
//               text.split('').forEach((d, idx) => { newOtp[idx] = d; });
//               setOtp(newOtp);
//               otpRefs.current[Math.min(text.length, 5)]?.focus();
//             }}
//             onClick={e => e.target.select()}
//             style={{
//               width: '42px', height: '52px', textAlign: 'center',
//               fontSize: '1.4rem', fontWeight: 700,
//               background: digit ? 'rgba(29,185,84,0.15)' : '#1a1a1a',
//               border: `2px solid ${digit ? '#1db954' : '#444'}`,
//               borderRadius: '10px', color: 'white', outline: 'none',
//               transition: 'all 0.15s', caretColor: '#1db954',
//               WebkitUserSelect: 'none'
//             }} />
//         ))}
//       </div>
//       <button onClick={onVerify} className="btn-primary" disabled={loading}
//         style={{ width: '100%', borderRadius: '8px', padding: '13px', fontSize: '1rem' }}>
//         {loading ? 'Verifying...' : 'Verify OTP'}
//       </button>
//     </>
//   );

//   return (
//     <div className="auth-form">
//       <div style={{ textAlign: 'center', marginBottom: '24px' }}>
//         <Music color="#1db954" size={36} style={{ marginBottom: '10px' }} />
//         <h2 style={{ margin: 0 }}>Welcome back</h2>
//         <p style={{ color: '#b3b3b3', marginTop: '6px', fontSize: '0.9rem' }}>Log in to VStream</p>
//       </div>

//       {step === 1 && (
//         <div style={{ display: 'flex', background: '#121212', borderRadius: '8px', padding: '4px', marginBottom: '20px' }}>
//           {['email','phone'].map(m => (
//             <button key={m} onClick={() => { setMethod(m); reset(); setLoginType('password'); }}
//               style={{
//                 flex: 1, padding: '9px', border: 'none', borderRadius: '6px', cursor: 'pointer',
//                 fontWeight: 600, fontSize: '0.88rem', transition: 'all 0.2s',
//                 background: method === m ? '#1db954' : 'transparent',
//                 color: method === m ? 'white' : '#b3b3b3',
//                 display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
//               }}>
//               {m === 'email' ? <Mail size={15}/> : <Phone size={15}/>}
//               {m === 'email' ? 'Email' : 'Phone'}
//             </button>
//           ))}
//         </div>
//       )}

//       {error && <div style={{ background: '#2a1a1a', border: '1px solid #ff4444', borderRadius: '8px', padding: '10px 14px', color: '#ff6666', fontSize: '0.85rem', marginBottom: '14px' }}>{error}</div>}
//       {success && <div style={{ background: '#1a2a1a', border: '1px solid #1db954', borderRadius: '8px', padding: '10px 14px', color: '#1db954', fontSize: '0.85rem', marginBottom: '14px' }}>{success}</div>}

//       {/* ── STEP 1 EMAIL ── */}
//       {step === 1 && method === 'email' && (
//         <>
//           <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
//             {['password','otp'].map(t => (
//               <button key={t} onClick={() => { setLoginType(t); setError(''); }}
//                 style={{
//                   flex: 1, padding: '8px', border: `1px solid ${loginType === t ? '#1db954' : '#333'}`,
//                   borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem',
//                   background: loginType === t ? 'rgba(29,185,84,0.1)' : 'transparent',
//                   color: loginType === t ? '#1db954' : '#b3b3b3', transition: 'all 0.2s'
//                 }}>
//                 {t === 'password' ? '🔑 Password' : '📧 Email OTP'}
//               </button>
//             ))}
//           </div>
//           {loginType === 'password' ? (
//             <form onSubmit={handlePasswordLogin}>
//               <input type="email" placeholder="Email address" required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
//               <input type="password" placeholder="Password" required value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
//               <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', borderRadius: '8px', padding: '13px', fontSize: '1rem' }}>
//                 {loading ? 'Logging in...' : 'Log In'}
//               </button>
//             </form>
//           ) : (
//             <form onSubmit={handleEmailSendOtp}>
//               <input type="email" placeholder="Email address" required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
//               <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', borderRadius: '8px', padding: '13px', fontSize: '1rem' }}>
//                 {loading ? 'Sending...' : 'Send OTP'}
//               </button>
//             </form>
//           )}
//         </>
//       )}

//       {/* ── STEP 1 PHONE ── */}
//       {step === 1 && method === 'phone' && (
//         <form onSubmit={handlePhoneSendOtp}>
//           <input type="tel" placeholder="+91 9876543210" required value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
//           <p style={{ color: '#666', fontSize: '0.78rem', marginTop: '-8px', marginBottom: '14px' }}>Include country code e.g. +91 for India</p>
//           <div id="recaptcha-container-login"></div>
//           <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', borderRadius: '8px', padding: '13px', fontSize: '1rem' }}>
//             {loading ? 'Sending...' : 'Send OTP via SMS'}
//           </button>
//         </form>
//       )}

//       {/* ── STEP 2 OTP ── */}
//       {step === 2 && (
//         <div>
//           <button onClick={reset} style={{ background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '20px', padding: 0 }}>
//             <ArrowLeft size={16} /> Back
//           </button>
//           <p style={{ color: '#b3b3b3', fontSize: '0.9rem', marginBottom: '20px', textAlign: 'center' }}>
//             Enter the 6-digit code sent to<br />
//             <strong style={{ color: 'white' }}>{method === 'email' ? formData.email : formData.phone}</strong>
//           </p>
//           <OtpBoxes onVerify={method === 'phone' ? handlePhoneVerifyOtp : handleEmailVerifyOtp} />
//           <button onClick={method === 'phone' ? handlePhoneSendOtp : handleEmailSendOtp}
//             style={{ width: '100%', background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', marginTop: '12px', fontSize: '0.85rem' }}>
//             Didn't receive it? <span style={{ color: '#1db954' }}>Resend OTP</span>
//           </button>
//         </div>
//       )}

//       <p style={{ marginTop: '20px', textAlign: 'center', color: '#b3b3b3', fontSize: '0.9rem' }}>
//         Don't have an account?{' '}
//         <Link to="/signup" style={{ color: '#1db954', fontWeight: 600 }}>Sign up free</Link>
//       </p>
//     </div>
//   );
// };

// export default Login;


//login signup sonlist  otp and playlist

// import React, { useState, useContext, useRef, useEffect } from 'react';
// import { useNavigate, Link } from 'react-router-dom';
// import axios from 'axios';
// import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
// import { auth } from '../firebase';
// import { AuthContext } from '../context/AuthContext';
// import { Music, Mail, Phone, ArrowLeft } from 'lucide-react';

// const API = process.env.REACT_APP_API_URL || '';

// const Login = () => {
//   const [method, setMethod]       = useState('email');
//   const [loginType, setLoginType] = useState('password');
//   const [step, setStep]           = useState(1);
//   const [formData, setFormData]   = useState({ email: '', phone: '', password: '' });
//   const [otp, setOtp]             = useState(['','','','','','']);
//   const [loading, setLoading]     = useState(false);
//   const [error, setError]         = useState('');
//   const [success, setSuccess]     = useState('');
//   const [confirmResult, setConfirmResult] = useState(null);
//   const otpRefs      = useRef([]);
//   const recaptchaRef = useRef(null);
//   const { login }    = useContext(AuthContext);
//   const navigate     = useNavigate();

//   const reset = () => { setStep(1); setOtp(['','','','','','']); setError(''); setSuccess(''); };

//   useEffect(() => {
//     if (method === 'phone' && !recaptchaRef.current) {
//       recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container-login', { size: 'invisible' });
//     }
//   }, [method]);

//   const handleOtpChange = (index, value) => {
//     // Handle paste — distribute digits across boxes
//     if (value.length > 1) {
//       const digits = value.replace(/\D/g, '').slice(0, 6).split('');
//       const newOtp = [...otp];
//       digits.forEach((d, i) => { if (index + i < 6) newOtp[index + i] = d; });
//       setOtp(newOtp);
//       const nextIndex = Math.min(index + digits.length, 5);
//       otpRefs.current[nextIndex]?.focus();
//       return;
//     }
//     if (!/^\d*$/.test(value)) return;
//     const newOtp = [...otp];
//     newOtp[index] = value.slice(-1);
//     setOtp(newOtp);
//     // Auto move to next box
//     if (value && index < 5) {
//       setTimeout(() => otpRefs.current[index + 1]?.focus(), 10);
//     }
//   };

//   const handleOtpKeyDown = (index, e) => {
//     if (e.key === 'Backspace' && !otp[index] && index > 0) {
//       otpRefs.current[index - 1]?.focus();
//     }
//     // Arrow key navigation
//     if (e.key === 'ArrowLeft' && index > 0) otpRefs.current[index - 1]?.focus();
//     if (e.key === 'ArrowRight' && index < 5) otpRefs.current[index + 1]?.focus();
//   };

//   // ── Password login ─────────────────────────────────────────────
//   const handlePasswordLogin = async (e) => {
//     e.preventDefault();
//     setLoading(true); setError('');
//     try {
//       const { data } = await axios.post(`${API}/api/auth/login`, { email: formData.email, password: formData.password });
//       login(data); navigate('/');
//     } catch (err) {
//       setError(err.response?.data?.message || 'Login failed');
//     } finally { setLoading(false); }
//   };

//   // ── Email OTP login ────────────────────────────────────────────
//   const handleEmailSendOtp = async (e) => {
//     e?.preventDefault();
//     setLoading(true); setError(''); setSuccess('');
//     try {
//       const { data } = await axios.post(`${API}/api/auth/login/send-otp`, { email: formData.email });
//       setSuccess(data.message); setStep(2);
//     } catch (err) {
//       setError(err.response?.data?.message || 'Failed to send OTP');
//     } finally { setLoading(false); }
//   };

//   const handleEmailVerifyOtp = async () => {
//     const otpString = otp.join('');
//     if (otpString.length !== 6) return setError('Enter complete 6-digit OTP');
//     setLoading(true); setError('');
//     try {
//       const { data } = await axios.post(`${API}/api/auth/login/verify-otp`, { email: formData.email, otp: otpString });
//       login(data); navigate('/');
//     } catch (err) {
//       setError(err.response?.data?.message || 'Invalid OTP');
//       setOtp(['','','','','','']); otpRefs.current[0]?.focus();
//     } finally { setLoading(false); }
//   };

//   // ── Phone login via Firebase ───────────────────────────────────
//   const handlePhoneSendOtp = async (e) => {
//     e?.preventDefault();
//     setLoading(true); setError('');
//     try {
//       if (!recaptchaRef.current) {
//         recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container-login', { size: 'invisible' });
//       }
//       const result = await signInWithPhoneNumber(auth, formData.phone, recaptchaRef.current);
//       setConfirmResult(result);
//       setSuccess(`OTP sent to ${formData.phone}`);
//       setStep(2);
//     } catch (err) {
//       console.error('Firebase OTP error:', err);
//       setError('Failed to send OTP. Check phone format (+91XXXXXXXXXX)');
//       recaptchaRef.current = null;
//     } finally { setLoading(false); }
//   };

//   const handlePhoneVerifyOtp = async () => {
//     const otpString = otp.join('');
//     if (otpString.length !== 6) return setError('Enter complete 6-digit OTP');
//     setLoading(true); setError('');
//     try {
//       const result    = await confirmResult.confirm(otpString);
//       const token     = await result.user.getIdToken();
//       const { data }  = await axios.post(`${API}/api/auth/phone/firebase-verify`, { firebaseToken: token });
//       if (data.needsUsername) {
//         return setError('No account found. Please sign up first.');
//       }
//       login(data); navigate('/');
//     } catch (err) {
//       setError(err.response?.data?.message || 'Invalid OTP');
//       setOtp(['','','','','','']); otpRefs.current[0]?.focus();
//     } finally { setLoading(false); }
//   };

//   const OtpBoxes = ({ onVerify }) => (
//     <>
//       <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginBottom: '24px' }}>
//         {otp.map((digit, i) => (
//           <input key={i} ref={el => otpRefs.current[i] = el}
//             type="text" inputMode="numeric" maxLength={1} value={digit}
//             onChange={e => handleOtpChange(i, e.target.value)}
//             onKeyDown={e => handleOtpKeyDown(i, e)}
//             onFocus={e => e.target.select()}
//             onPaste={e => { e.preventDefault(); handleOtpChange(i, e.clipboardData.getData('text')); }}
//             style={{
//               width: '46px', height: '56px', textAlign: 'center',
//               fontSize: '1.5rem', fontWeight: 700,
//               background: digit ? 'rgba(29,185,84,0.1)' : '#121212',
//               border: `2px solid ${digit ? '#1db954' : '#333'}`,
//               borderRadius: '8px', color: 'white', outline: 'none', transition: 'all 0.2s'
//             }} />
//         ))}
//       </div>
//       <button onClick={onVerify} className="btn-primary" disabled={loading}
//         style={{ width: '100%', borderRadius: '8px', padding: '13px', fontSize: '1rem' }}>
//         {loading ? 'Verifying...' : 'Verify OTP'}
//       </button>
//     </>
//   );

//   return (
//     <div className="auth-form">
//       <div style={{ textAlign: 'center', marginBottom: '24px' }}>
//         <Music color="#1db954" size={36} style={{ marginBottom: '10px' }} />
//         <h2 style={{ margin: 0 }}>Welcome back</h2>
//         <p style={{ color: '#b3b3b3', marginTop: '6px', fontSize: '0.9rem' }}>Log in to VStream</p>
//       </div>

//       {step === 1 && (
//         <div style={{ display: 'flex', background: '#121212', borderRadius: '8px', padding: '4px', marginBottom: '20px' }}>
//           {['email','phone'].map(m => (
//             <button key={m} onClick={() => { setMethod(m); reset(); setLoginType('password'); }}
//               style={{
//                 flex: 1, padding: '9px', border: 'none', borderRadius: '6px', cursor: 'pointer',
//                 fontWeight: 600, fontSize: '0.88rem', transition: 'all 0.2s',
//                 background: method === m ? '#1db954' : 'transparent',
//                 color: method === m ? 'white' : '#b3b3b3',
//                 display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
//               }}>
//               {m === 'email' ? <Mail size={15}/> : <Phone size={15}/>}
//               {m === 'email' ? 'Email' : 'Phone'}
//             </button>
//           ))}
//         </div>
//       )}

//       {error && <div style={{ background: '#2a1a1a', border: '1px solid #ff4444', borderRadius: '8px', padding: '10px 14px', color: '#ff6666', fontSize: '0.85rem', marginBottom: '14px' }}>{error}</div>}
//       {success && <div style={{ background: '#1a2a1a', border: '1px solid #1db954', borderRadius: '8px', padding: '10px 14px', color: '#1db954', fontSize: '0.85rem', marginBottom: '14px' }}>{success}</div>}

//       {/* ── STEP 1 EMAIL ── */}
//       {step === 1 && method === 'email' && (
//         <>
//           <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
//             {['password','otp'].map(t => (
//               <button key={t} onClick={() => { setLoginType(t); setError(''); }}
//                 style={{
//                   flex: 1, padding: '8px', border: `1px solid ${loginType === t ? '#1db954' : '#333'}`,
//                   borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem',
//                   background: loginType === t ? 'rgba(29,185,84,0.1)' : 'transparent',
//                   color: loginType === t ? '#1db954' : '#b3b3b3', transition: 'all 0.2s'
//                 }}>
//                 {t === 'password' ? '🔑 Password' : '📧 Email OTP'}
//               </button>
//             ))}
//           </div>
//           {loginType === 'password' ? (
//             <form onSubmit={handlePasswordLogin}>
//               <input type="email" placeholder="Email address" required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
//               <input type="password" placeholder="Password" required value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
//               <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', borderRadius: '8px', padding: '13px', fontSize: '1rem' }}>
//                 {loading ? 'Logging in...' : 'Log In'}
//               </button>
//             </form>
//           ) : (
//             <form onSubmit={handleEmailSendOtp}>
//               <input type="email" placeholder="Email address" required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
//               <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', borderRadius: '8px', padding: '13px', fontSize: '1rem' }}>
//                 {loading ? 'Sending...' : 'Send OTP'}
//               </button>
//             </form>
//           )}
//         </>
//       )}

//       {/* ── STEP 1 PHONE ── */}
//       {step === 1 && method === 'phone' && (
//         <form onSubmit={handlePhoneSendOtp}>
//           <input type="tel" placeholder="+91 9876543210" required value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
//           <p style={{ color: '#666', fontSize: '0.78rem', marginTop: '-8px', marginBottom: '14px' }}>Include country code e.g. +91 for India</p>
//           <div id="recaptcha-container-login"></div>
//           <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', borderRadius: '8px', padding: '13px', fontSize: '1rem' }}>
//             {loading ? 'Sending...' : 'Send OTP via SMS'}
//           </button>
//         </form>
//       )}

//       {/* ── STEP 2 OTP ── */}
//       {step === 2 && (
//         <div>
//           <button onClick={reset} style={{ background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '20px', padding: 0 }}>
//             <ArrowLeft size={16} /> Back
//           </button>
//           <p style={{ color: '#b3b3b3', fontSize: '0.9rem', marginBottom: '20px', textAlign: 'center' }}>
//             Enter the 6-digit code sent to<br />
//             <strong style={{ color: 'white' }}>{method === 'email' ? formData.email : formData.phone}</strong>
//           </p>
//           <OtpBoxes onVerify={method === 'phone' ? handlePhoneVerifyOtp : handleEmailVerifyOtp} />
//           <button onClick={method === 'phone' ? handlePhoneSendOtp : handleEmailSendOtp}
//             style={{ width: '100%', background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', marginTop: '12px', fontSize: '0.85rem' }}>
//             Didn't receive it? <span style={{ color: '#1db954' }}>Resend OTP</span>
//           </button>
//         </div>
//       )}

//       <p style={{ marginTop: '20px', textAlign: 'center', color: '#b3b3b3', fontSize: '0.9rem' }}>
//         Don't have an account?{' '}
//         <Link to="/signup" style={{ color: '#1db954', fontWeight: 600 }}>Sign up free</Link>
//       </p>
//     </div>
//   );
// };

// export default Login;

//profile edit and opt focus login signup server index profilerout profilepage.js navbar

// import React, { useState, useContext, useRef, useEffect } from 'react';
// import { useNavigate, Link } from 'react-router-dom';
// import axios from 'axios';
// import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
// import { auth } from '../firebase';
// import { AuthContext } from '../context/AuthContext';
// import { Music, Mail, Phone, ArrowLeft } from 'lucide-react';

// const API = process.env.REACT_APP_API_URL || '';

// const Login = () => {
//   const [method, setMethod]       = useState('email');
//   const [loginType, setLoginType] = useState('password');
//   const [step, setStep]           = useState(1);
//   const [formData, setFormData]   = useState({ email: '', phone: '', password: '' });
//   const [otp, setOtp]             = useState(['','','','','','']);
//   const [loading, setLoading]     = useState(false);
//   const [error, setError]         = useState('');
//   const [success, setSuccess]     = useState('');
//   const [confirmResult, setConfirmResult] = useState(null);
//   const otpRefs      = useRef([]);
//   const recaptchaRef = useRef(null);
//   const { login }    = useContext(AuthContext);
//   const navigate     = useNavigate();

//   const reset = () => { setStep(1); setOtp(['','','','','','']); setError(''); setSuccess(''); };

//   useEffect(() => {
//     if (method === 'phone' && !recaptchaRef.current) {
//       recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container-login', { size: 'invisible' });
//     }
//   }, [method]);

//   const handleOtpChange = (index, value) => {
//     if (!/^\d*$/.test(value)) return;
//     const newOtp = [...otp];
//     newOtp[index] = value.slice(-1);
//     setOtp(newOtp);
//     if (value && index < 5) otpRefs.current[index + 1]?.focus();
//   };

//   const handleOtpKeyDown = (index, e) => {
//     if (e.key === 'Backspace' && !otp[index] && index > 0)
//       otpRefs.current[index - 1]?.focus();
//   };

//   // ── Password login ─────────────────────────────────────────────
//   const handlePasswordLogin = async (e) => {
//     e.preventDefault();
//     setLoading(true); setError('');
//     try {
//       const { data } = await axios.post(`${API}/api/auth/login`, { email: formData.email, password: formData.password });
//       login(data); navigate('/');
//     } catch (err) {
//       setError(err.response?.data?.message || 'Login failed');
//     } finally { setLoading(false); }
//   };

//   // ── Email OTP login ────────────────────────────────────────────
//   const handleEmailSendOtp = async (e) => {
//     e?.preventDefault();
//     setLoading(true); setError(''); setSuccess('');
//     try {
//       const { data } = await axios.post(`${API}/api/auth/login/send-otp`, { email: formData.email });
//       setSuccess(data.message); setStep(2);
//     } catch (err) {
//       setError(err.response?.data?.message || 'Failed to send OTP');
//     } finally { setLoading(false); }
//   };

//   const handleEmailVerifyOtp = async () => {
//     const otpString = otp.join('');
//     if (otpString.length !== 6) return setError('Enter complete 6-digit OTP');
//     setLoading(true); setError('');
//     try {
//       const { data } = await axios.post(`${API}/api/auth/login/verify-otp`, { email: formData.email, otp: otpString });
//       login(data); navigate('/');
//     } catch (err) {
//       setError(err.response?.data?.message || 'Invalid OTP');
//       setOtp(['','','','','','']); otpRefs.current[0]?.focus();
//     } finally { setLoading(false); }
//   };

//   // ── Phone login via Firebase ───────────────────────────────────
//   const handlePhoneSendOtp = async (e) => {
//     e?.preventDefault();
//     setLoading(true); setError('');
//     try {
//       if (!recaptchaRef.current) {
//         recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container-login', { size: 'invisible' });
//       }
//       const result = await signInWithPhoneNumber(auth, formData.phone, recaptchaRef.current);
//       setConfirmResult(result);
//       setSuccess(`OTP sent to ${formData.phone}`);
//       setStep(2);
//     } catch (err) {
//       console.error('Firebase OTP error:', err);
//       setError('Failed to send OTP. Check phone format (+91XXXXXXXXXX)');
//       recaptchaRef.current = null;
//     } finally { setLoading(false); }
//   };

//   const handlePhoneVerifyOtp = async () => {
//     const otpString = otp.join('');
//     if (otpString.length !== 6) return setError('Enter complete 6-digit OTP');
//     setLoading(true); setError('');
//     try {
//       const result    = await confirmResult.confirm(otpString);
//       const token     = await result.user.getIdToken();
//       const { data }  = await axios.post(`${API}/api/auth/phone/firebase-verify`, { firebaseToken: token });
//       if (data.needsUsername) {
//         return setError('No account found. Please sign up first.');
//       }
//       login(data); navigate('/');
//     } catch (err) {
//       setError(err.response?.data?.message || 'Invalid OTP');
//       setOtp(['','','','','','']); otpRefs.current[0]?.focus();
//     } finally { setLoading(false); }
//   };

//   const OtpBoxes = ({ onVerify }) => (
//     <>
//       <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginBottom: '24px' }}>
//         {otp.map((digit, i) => (
//           <input key={i} ref={el => otpRefs.current[i] = el}
//             type="text" inputMode="numeric" maxLength={1} value={digit}
//             onChange={e => handleOtpChange(i, e.target.value)}
//             onKeyDown={e => handleOtpKeyDown(i, e)}
//             style={{
//               width: '46px', height: '56px', textAlign: 'center',
//               fontSize: '1.5rem', fontWeight: 700,
//               background: digit ? 'rgba(29,185,84,0.1)' : '#121212',
//               border: `2px solid ${digit ? '#1db954' : '#333'}`,
//               borderRadius: '8px', color: 'white', outline: 'none', transition: 'all 0.2s'
//             }} />
//         ))}
//       </div>
//       <button onClick={onVerify} className="btn-primary" disabled={loading}
//         style={{ width: '100%', borderRadius: '8px', padding: '13px', fontSize: '1rem' }}>
//         {loading ? 'Verifying...' : 'Verify OTP'}
//       </button>
//     </>
//   );

//   return (
//     <div className="auth-form">
//       <div style={{ textAlign: 'center', marginBottom: '24px' }}>
//         <Music color="#1db954" size={36} style={{ marginBottom: '10px' }} />
//         <h2 style={{ margin: 0 }}>Welcome back</h2>
//         <p style={{ color: '#b3b3b3', marginTop: '6px', fontSize: '0.9rem' }}>Log in to VStream</p>
//       </div>

//       {step === 1 && (
//         <div style={{ display: 'flex', background: '#121212', borderRadius: '8px', padding: '4px', marginBottom: '20px' }}>
//           {['email','phone'].map(m => (
//             <button key={m} onClick={() => { setMethod(m); reset(); setLoginType('password'); }}
//               style={{
//                 flex: 1, padding: '9px', border: 'none', borderRadius: '6px', cursor: 'pointer',
//                 fontWeight: 600, fontSize: '0.88rem', transition: 'all 0.2s',
//                 background: method === m ? '#1db954' : 'transparent',
//                 color: method === m ? 'white' : '#b3b3b3',
//                 display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
//               }}>
//               {m === 'email' ? <Mail size={15}/> : <Phone size={15}/>}
//               {m === 'email' ? 'Email' : 'Phone'}
//             </button>
//           ))}
//         </div>
//       )}

//       {error && <div style={{ background: '#2a1a1a', border: '1px solid #ff4444', borderRadius: '8px', padding: '10px 14px', color: '#ff6666', fontSize: '0.85rem', marginBottom: '14px' }}>{error}</div>}
//       {success && <div style={{ background: '#1a2a1a', border: '1px solid #1db954', borderRadius: '8px', padding: '10px 14px', color: '#1db954', fontSize: '0.85rem', marginBottom: '14px' }}>{success}</div>}

//       {/* ── STEP 1 EMAIL ── */}
//       {step === 1 && method === 'email' && (
//         <>
//           <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
//             {['password','otp'].map(t => (
//               <button key={t} onClick={() => { setLoginType(t); setError(''); }}
//                 style={{
//                   flex: 1, padding: '8px', border: `1px solid ${loginType === t ? '#1db954' : '#333'}`,
//                   borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem',
//                   background: loginType === t ? 'rgba(29,185,84,0.1)' : 'transparent',
//                   color: loginType === t ? '#1db954' : '#b3b3b3', transition: 'all 0.2s'
//                 }}>
//                 {t === 'password' ? '🔑 Password' : '📧 Email OTP'}
//               </button>
//             ))}
//           </div>
//           {loginType === 'password' ? (
//             <form onSubmit={handlePasswordLogin}>
//               <input type="email" placeholder="Email address" required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
//               <input type="password" placeholder="Password" required value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
//               <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', borderRadius: '8px', padding: '13px', fontSize: '1rem' }}>
//                 {loading ? 'Logging in...' : 'Log In'}
//               </button>
//             </form>
//           ) : (
//             <form onSubmit={handleEmailSendOtp}>
//               <input type="email" placeholder="Email address" required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
//               <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', borderRadius: '8px', padding: '13px', fontSize: '1rem' }}>
//                 {loading ? 'Sending...' : 'Send OTP'}
//               </button>
//             </form>
//           )}
//         </>
//       )}

//       {/* ── STEP 1 PHONE ── */}
//       {step === 1 && method === 'phone' && (
//         <form onSubmit={handlePhoneSendOtp}>
//           <input type="tel" placeholder="+91 9876543210" required value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
//           <p style={{ color: '#666', fontSize: '0.78rem', marginTop: '-8px', marginBottom: '14px' }}>Include country code e.g. +91 for India</p>
//           <div id="recaptcha-container-login"></div>
//           <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', borderRadius: '8px', padding: '13px', fontSize: '1rem' }}>
//             {loading ? 'Sending...' : 'Send OTP via SMS'}
//           </button>
//         </form>
//       )}

//       {/* ── STEP 2 OTP ── */}
//       {step === 2 && (
//         <div>
//           <button onClick={reset} style={{ background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '20px', padding: 0 }}>
//             <ArrowLeft size={16} /> Back
//           </button>
//           <p style={{ color: '#b3b3b3', fontSize: '0.9rem', marginBottom: '20px', textAlign: 'center' }}>
//             Enter the 6-digit code sent to<br />
//             <strong style={{ color: 'white' }}>{method === 'email' ? formData.email : formData.phone}</strong>
//           </p>
//           <OtpBoxes onVerify={method === 'phone' ? handlePhoneVerifyOtp : handleEmailVerifyOtp} />
//           <button onClick={method === 'phone' ? handlePhoneSendOtp : handleEmailSendOtp}
//             style={{ width: '100%', background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', marginTop: '12px', fontSize: '0.85rem' }}>
//             Didn't receive it? <span style={{ color: '#1db954' }}>Resend OTP</span>
//           </button>
//         </div>
//       )}

//       <p style={{ marginTop: '20px', textAlign: 'center', color: '#b3b3b3', fontSize: '0.9rem' }}>
//         Don't have an account?{' '}
//         <Link to="/signup" style={{ color: '#1db954', fontWeight: 600 }}>Sign up free</Link>
//       </p>
//     </div>
//   );
// };

// export default Login;


// import React, { useState, useContext, useRef, useEffect } from 'react';
// import { useNavigate, Link } from 'react-router-dom';
// import axios from 'axios';
// import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
// import { auth } from '../firebase';
// import { AuthContext } from '../context/AuthContext';
// import { Music, Mail, Phone, ArrowLeft } from 'lucide-react';

// const Login = () => {
//   const [method, setMethod]       = useState('email');
//   const [loginType, setLoginType] = useState('password');
//   const [step, setStep]           = useState(1);
//   const [formData, setFormData]   = useState({ email: '', phone: '', password: '' });
//   const [otp, setOtp]             = useState(['','','','','','']);
//   const [loading, setLoading]     = useState(false);
//   const [error, setError]         = useState('');
//   const [success, setSuccess]     = useState('');
//   const [confirmResult, setConfirmResult] = useState(null);
//   const otpRefs      = useRef([]);
//   const recaptchaRef = useRef(null);
//   const { login }    = useContext(AuthContext);
//   const navigate     = useNavigate();

//   const reset = () => { setStep(1); setOtp(['','','','','','']); setError(''); setSuccess(''); };

//   useEffect(() => {
//     if (method === 'phone' && !recaptchaRef.current) {
//       recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container-login', { size: 'invisible' });
//     }
//   }, [method]);

//   const handleOtpChange = (index, value) => {
//     if (!/^\d*$/.test(value)) return;
//     const newOtp = [...otp];
//     newOtp[index] = value.slice(-1);
//     setOtp(newOtp);
//     if (value && index < 5) otpRefs.current[index + 1]?.focus();
//   };

//   const handleOtpKeyDown = (index, e) => {
//     if (e.key === 'Backspace' && !otp[index] && index > 0)
//       otpRefs.current[index - 1]?.focus();
//   };

//   // ── Password login ─────────────────────────────────────────────
//   const handlePasswordLogin = async (e) => {
//     e.preventDefault();
//     setLoading(true); setError('');
//     try {
//       const { data } = await axios.post('/api/auth/login', { email: formData.email, password: formData.password });
//       login(data); navigate('/');
//     } catch (err) {
//       setError(err.response?.data?.message || 'Login failed');
//     } finally { setLoading(false); }
//   };

//   // ── Email OTP login ────────────────────────────────────────────
//   const handleEmailSendOtp = async (e) => {
//     e?.preventDefault();
//     setLoading(true); setError(''); setSuccess('');
//     try {
//       const { data } = await axios.post('/api/auth/login/send-otp', { email: formData.email });
//       setSuccess(data.message); setStep(2);
//     } catch (err) {
//       setError(err.response?.data?.message || 'Failed to send OTP');
//     } finally { setLoading(false); }
//   };

//   const handleEmailVerifyOtp = async () => {
//     const otpString = otp.join('');
//     if (otpString.length !== 6) return setError('Enter complete 6-digit OTP');
//     setLoading(true); setError('');
//     try {
//       const { data } = await axios.post('/api/auth/login/verify-otp', { email: formData.email, otp: otpString });
//       login(data); navigate('/');
//     } catch (err) {
//       setError(err.response?.data?.message || 'Invalid OTP');
//       setOtp(['','','','','','']); otpRefs.current[0]?.focus();
//     } finally { setLoading(false); }
//   };

//   // ── Phone login via Firebase ───────────────────────────────────
//   const handlePhoneSendOtp = async (e) => {
//     e?.preventDefault();
//     setLoading(true); setError('');
//     try {
//       if (!recaptchaRef.current) {
//         recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container-login', { size: 'invisible' });
//       }
//       const result = await signInWithPhoneNumber(auth, formData.phone, recaptchaRef.current);
//       setConfirmResult(result);
//       setSuccess(`OTP sent to ${formData.phone}`);
//       setStep(2);
//     } catch (err) {
//       console.error('Firebase OTP error:', err);
//       setError('Failed to send OTP. Check phone format (+91XXXXXXXXXX)');
//       recaptchaRef.current = null;
//     } finally { setLoading(false); }
//   };

//   const handlePhoneVerifyOtp = async () => {
//     const otpString = otp.join('');
//     if (otpString.length !== 6) return setError('Enter complete 6-digit OTP');
//     setLoading(true); setError('');
//     try {
//       const result    = await confirmResult.confirm(otpString);
//       const token     = await result.user.getIdToken();
//       const { data }  = await axios.post('/api/auth/phone/firebase-verify', { firebaseToken: token });
//       if (data.needsUsername) {
//         return setError('No account found. Please sign up first.');
//       }
//       login(data); navigate('/');
//     } catch (err) {
//       setError(err.response?.data?.message || 'Invalid OTP');
//       setOtp(['','','','','','']); otpRefs.current[0]?.focus();
//     } finally { setLoading(false); }
//   };

//   const OtpBoxes = ({ onVerify }) => (
//     <>
//       <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginBottom: '24px' }}>
//         {otp.map((digit, i) => (
//           <input key={i} ref={el => otpRefs.current[i] = el}
//             type="text" inputMode="numeric" maxLength={1} value={digit}
//             onChange={e => handleOtpChange(i, e.target.value)}
//             onKeyDown={e => handleOtpKeyDown(i, e)}
//             style={{
//               width: '46px', height: '56px', textAlign: 'center',
//               fontSize: '1.5rem', fontWeight: 700,
//               background: digit ? 'rgba(29,185,84,0.1)' : '#121212',
//               border: `2px solid ${digit ? '#1db954' : '#333'}`,
//               borderRadius: '8px', color: 'white', outline: 'none', transition: 'all 0.2s'
//             }} />
//         ))}
//       </div>
//       <button onClick={onVerify} className="btn-primary" disabled={loading}
//         style={{ width: '100%', borderRadius: '8px', padding: '13px', fontSize: '1rem' }}>
//         {loading ? 'Verifying...' : 'Verify OTP'}
//       </button>
//     </>
//   );

//   return (
//     <div className="auth-form">
//       <div style={{ textAlign: 'center', marginBottom: '24px' }}>
//         <Music color="#1db954" size={36} style={{ marginBottom: '10px' }} />
//         <h2 style={{ margin: 0 }}>Welcome back</h2>
//         <p style={{ color: '#b3b3b3', marginTop: '6px', fontSize: '0.9rem' }}>Log in to Vstream</p>
//       </div>

//       {step === 1 && (
//         <div style={{ display: 'flex', background: '#121212', borderRadius: '8px', padding: '4px', marginBottom: '20px' }}>
//           {['email','phone'].map(m => (
//             <button key={m} onClick={() => { setMethod(m); reset(); setLoginType('password'); }}
//               style={{
//                 flex: 1, padding: '9px', border: 'none', borderRadius: '6px', cursor: 'pointer',
//                 fontWeight: 600, fontSize: '0.88rem', transition: 'all 0.2s',
//                 background: method === m ? '#1db954' : 'transparent',
//                 color: method === m ? 'white' : '#b3b3b3',
//                 display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
//               }}>
//               {m === 'email' ? <Mail size={15}/> : <Phone size={15}/>}
//               {m === 'email' ? 'Email' : 'Phone'}
//             </button>
//           ))}
//         </div>
//       )}

//       {error && <div style={{ background: '#2a1a1a', border: '1px solid #ff4444', borderRadius: '8px', padding: '10px 14px', color: '#ff6666', fontSize: '0.85rem', marginBottom: '14px' }}>{error}</div>}
//       {success && <div style={{ background: '#1a2a1a', border: '1px solid #1db954', borderRadius: '8px', padding: '10px 14px', color: '#1db954', fontSize: '0.85rem', marginBottom: '14px' }}>{success}</div>}

//       {/* ── STEP 1 EMAIL ── */}
//       {step === 1 && method === 'email' && (
//         <>
//           <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
//             {['password','otp'].map(t => (
//               <button key={t} onClick={() => { setLoginType(t); setError(''); }}
//                 style={{
//                   flex: 1, padding: '8px', border: `1px solid ${loginType === t ? '#1db954' : '#333'}`,
//                   borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem',
//                   background: loginType === t ? 'rgba(29,185,84,0.1)' : 'transparent',
//                   color: loginType === t ? '#1db954' : '#b3b3b3', transition: 'all 0.2s'
//                 }}>
//                 {t === 'password' ? '🔑 Password' : '📧 Email OTP'}
//               </button>
//             ))}
//           </div>
//           {loginType === 'password' ? (
//             <form onSubmit={handlePasswordLogin}>
//               <input type="email" placeholder="Email address" required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
//               <input type="password" placeholder="Password" required value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
//               <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', borderRadius: '8px', padding: '13px', fontSize: '1rem' }}>
//                 {loading ? 'Logging in...' : 'Log In'}
//               </button>
//             </form>
//           ) : (
//             <form onSubmit={handleEmailSendOtp}>
//               <input type="email" placeholder="Email address" required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
//               <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', borderRadius: '8px', padding: '13px', fontSize: '1rem' }}>
//                 {loading ? 'Sending...' : 'Send OTP'}
//               </button>
//             </form>
//           )}
//         </>
//       )}

//       {/* ── STEP 1 PHONE ── */}
//       {step === 1 && method === 'phone' && (
//         <form onSubmit={handlePhoneSendOtp}>
//           <input type="tel" placeholder="+91 9876543210" required value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
//           <p style={{ color: '#666', fontSize: '0.78rem', marginTop: '-8px', marginBottom: '14px' }}>Include country code e.g. +91 for India</p>
//           <div id="recaptcha-container-login"></div>
//           <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', borderRadius: '8px', padding: '13px', fontSize: '1rem' }}>
//             {loading ? 'Sending...' : 'Send OTP via SMS'}
//           </button>
//         </form>
//       )}

//       {/* ── STEP 2 OTP ── */}
//       {step === 2 && (
//         <div>
//           <button onClick={reset} style={{ background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '20px', padding: 0 }}>
//             <ArrowLeft size={16} /> Back
//           </button>
//           <p style={{ color: '#b3b3b3', fontSize: '0.9rem', marginBottom: '20px', textAlign: 'center' }}>
//             Enter the 6-digit code sent to<br />
//             <strong style={{ color: 'white' }}>{method === 'email' ? formData.email : formData.phone}</strong>
//           </p>
//           <OtpBoxes onVerify={method === 'phone' ? handlePhoneVerifyOtp : handleEmailVerifyOtp} />
//           <button onClick={method === 'phone' ? handlePhoneSendOtp : handleEmailSendOtp}
//             style={{ width: '100%', background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', marginTop: '12px', fontSize: '0.85rem' }}>
//             Didn't receive it? <span style={{ color: '#1db954' }}>Resend OTP</span>
//           </button>
//         </div>
//       )}

//       <p style={{ marginTop: '20px', textAlign: 'center', color: '#b3b3b3', fontSize: '0.9rem' }}>
//         Don't have an account?{' '}
//         <Link to="/signup" style={{ color: '#1db954', fontWeight: 600 }}>Sign up free</Link>
//       </p>
//     </div>
//   );
// };

// export default Login;




//login, authroute,signin,login,firebase,client env,server env




// import React, { useState, useContext } from 'react';
// import { useNavigate, Link } from 'react-router-dom';
// import axios from 'axios';
// import { AuthContext } from '../context/AuthContext';
// import { Music } from 'lucide-react';

// const Login = () => {
//   const [formData, setFormData] = useState({ email: '', password: '' });
//   const [loading, setLoading]   = useState(false);
//   const [error, setError]       = useState('');
//   const { login }               = useContext(AuthContext);
//   const navigate                = useNavigate();

//   const handleSubmit = async (e) => {
//     e.preventDefault();
//     setLoading(true);
//     setError('');
//     try {
//       const { data } = await axios.post('/api/auth/login', formData);
//       login(data);
//       navigate('/');
//     } catch (err) {
//       setError(err.response?.data?.message || 'Login failed. Please try again.');
//     } finally {
//       setLoading(false);
//     }
//   };

//   return (
//     <div className="auth-form">
//       <div style={{ textAlign: 'center', marginBottom: '28px' }}>
//         <Music color="#1db954" size={40} style={{ marginBottom: '12px' }} />
//         <h2 style={{ margin: 0, fontSize: 'clamp(1.3rem, 4vw, 1.8rem)' }}>Welcome back</h2>
//         <p style={{ color: 'var(--text-dim)', marginTop: '6px', fontSize: '0.9rem' }}>
//           Log in to JamStream
//         </p>
//       </div>

//       {error && (
//         <div style={{
//           background: '#2a1a1a', border: '1px solid #ff4444',
//           borderRadius: '8px', padding: '10px 14px',
//           color: '#ff6666', fontSize: '0.85rem', marginBottom: '16px'
//         }}>
//           {error}
//         </div>
//       )}

//       <form onSubmit={handleSubmit}>
//         <input
//           type="email"
//           placeholder="Email address"
//           required
//           onChange={(e) => setFormData({ ...formData, email: e.target.value })}
//         />
//         <input
//           type="password"
//           placeholder="Password"
//           required
//           onChange={(e) => setFormData({ ...formData, password: e.target.value })}
//         />
//         <button
//           type="submit"
//           className="btn-primary"
//           disabled={loading}
//           style={{ width: '100%', borderRadius: '8px', padding: '13px', fontSize: '1rem' }}
//         >
//           {loading ? 'Logging in...' : 'Log In'}
//         </button>
//       </form>

//       <p style={{ marginTop: '20px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
//         Don't have an account?{' '}
//         <Link to="/signup" style={{ color: 'var(--accent)', fontWeight: 600 }}>Sign up free</Link>
//       </p>
//     </div>
//   );
// };

// export default Login;


///*updated app.css,homepage.librarypage,navbar,login page, signin page ,playebar
//for responsiveness*/


// import React, { useState, useContext } from 'react';
// import { useNavigate, Link } from 'react-router-dom';
// import axios from 'axios';
// import { AuthContext } from '../context/AuthContext';

// const Login = () => {
//   const [formData, setFormData] = useState({ email: '', password: '' });
//   const { login } = useContext(AuthContext);
//   const navigate = useNavigate();

//   const handleSubmit = async (e) => {
//     e.preventDefault();
//     try {
//       const { data } = await axios.post('/api/auth/login', formData);
//       login(data);
//       navigate('/');
//     } catch (err) {
//       alert(err.response?.data?.message || 'Login failed');
//     }
//   };

//   return (
//     <div className="auth-form">
//       <h2 style={{ marginBottom: '20px', textAlign: 'center' }}>Login</h2>
//       <form onSubmit={handleSubmit}>
//         <input 
//           type="email" 
//           placeholder="Email" 
//           required 
//           onChange={(e) => setFormData({ ...formData, email: e.target.value })}
//         />
//         <input 
//           type="password" 
//           placeholder="Password" 
//           required 
//           onChange={(e) => setFormData({ ...formData, password: e.target.value })}
//         />
//         <button type="submit" className="btn-primary" style={{ width: '100%', borderRadius: '4px' }}>Log In</button>
//       </form>
//       <p style={{ marginTop: '20px', textAlign: 'center', color: '#b3b3b3' }}>
//         Don't have an account? <Link to="/signup" style={{ color: '#1db954' }}>Sign up</Link>
//       </p>
//     </div>
//   );
// };

// export default Login;
