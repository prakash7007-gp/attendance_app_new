import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import {
  collection, doc, setDoc, getDocs, getDoc,
  deleteDoc, query, orderBy, writeBatch
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { format, startOfMonth, endOfMonth, eachDayOfInterval,
         getDaysInMonth, getDay, isToday, isSunday, parseISO } from 'date-fns';

// ─── Join Code Utilities ───────────────────────────────────────────────────

function generateCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function getJoinCode() {
  try {
    const snap = await getDoc(doc(db, 'config', 'joinCode'));
    return snap.exists() ? snap.data().code : null;
  } catch { return null; }
}

async function saveJoinCode(code) {
  await setDoc(doc(db, 'config', 'joinCode'), { code, updatedAt: Date.now() });
}

async function clearJoinCode() {
  await setDoc(doc(db, 'config', 'joinCode'), { code: null, updatedAt: Date.now() });
}

async function verifyJoinCode(inputCode) {
  const stored = await getJoinCode();
  return stored && stored === inputCode.trim().toUpperCase();
}

// ─── Login Data ────────────────────────────────────────────────────────────

async function getLoginData() {
  try {
    const [configSnap, empSnap] = await Promise.all([
      getDocs(collection(db, 'config')),
      getDocs(query(collection(db, 'employees'), orderBy('createdAt', 'asc')))
    ]);
    let adminPw = 'admin123';
    let employeePasswords = {};
    configSnap.docs.forEach(d => {
      if (d.id === 'passwords') {
        if (d.data().admin) adminPw = d.data().admin;
        if (d.data().employees) employeePasswords = d.data().employees;
      }
    });
    const employees = empSnap.docs.map(d => d.data());
    return { adminPw, employeePasswords, employees };
  } catch (e) {
    return { adminPw: 'admin123', employeePasswords: {}, employees: [] };
  }
}

// ─── Join Screen ───────────────────────────────────────────────────────────

function JoinScreen({ onBack }) {
  const [step, setStep]       = useState('code');
  const [code, setCode]       = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm]       = useState({
    name: '', designation: '', phone: '', shiftId: 'A', password: '', confirmPw: ''
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlCode = params.get('join');
    if (urlCode) setCode(urlCode.toUpperCase());
  }, []);

  async function handleCodeSubmit() {
    if (!code.trim()) { setError('Enter the join code'); return; }
    setLoading(true); setError('');
    const ok = await verifyJoinCode(code);
    if (ok) setStep('form');
    else setError('Invalid join code. Ask your admin for the correct code.');
    setLoading(false);
  }

  async function handleRegister() {
    if (!form.name.trim())        return alert('Full name is required');
    if (!form.password.trim())    return alert('Password is required');
    if (form.password.length < 4) return alert('Password must be at least 4 characters');
    if (form.password !== form.confirmPw) return alert('Passwords do not match');
    setLoading(true);
    try {
      const empSnap = await getDocs(collection(db, 'employees'));
      const names = empSnap.docs.map(d => d.data().name.toLowerCase().trim());
      if (names.includes(form.name.toLowerCase().trim())) {
        alert('An employee with this name already exists. Contact admin.');
        setLoading(false);
        return;
      }
      const id = `emp_${Date.now()}`;
      await setDoc(doc(db, 'employees', id), {
        id, name: form.name.trim(), designation: form.designation.trim(),
        phone: form.phone.trim(), shiftId: form.shiftId,
        createdAt: Date.now(), selfRegistered: true,
      });
      await setDoc(doc(db, 'config', 'passwords'),
        { employees: { [id]: form.password } }, { merge: true });
      setStep('done');
    } catch (e) {
      alert('Registration failed: ' + e.message);
    }
    setLoading(false);
  }

  const wrapStyle = {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'linear-gradient(135deg,#0891b2 0%,#0e7490 100%)', padding: '1rem'
  };
  const cardStyle = {
    background: '#fff', borderRadius: '16px', padding: '2rem 1.5rem',
    width: '100%', maxWidth: '400px', boxShadow: '0 20px 60px rgba(0,0,0,0.15)'
  };

  if (step === 'done') return (
    <div style={wrapStyle}>
      <div style={cardStyle}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '52px', marginBottom: '12px' }}>🎉</div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>
            Registration Successful!
          </h2>
          <p style={{ color: '#6b7280', fontSize: '14px', marginBottom: '24px' }}>
            Your account has been created. You can now log in with your password.
          </p>
          <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '10px',
            padding: '12px', marginBottom: '20px', fontSize: '13px', color: '#15803d' }}>
            <strong>{form.name}</strong> — registered successfully<br />
            Use your password to login from the main screen.
          </div>
          <button onClick={onBack}
            style={{ width: '100%', padding: '11px', background: '#0891b2',
              color: '#fff', border: 'none', borderRadius: '8px',
              fontSize: '15px', fontWeight: 600, cursor: 'pointer' }}>
            Go to Login →
          </button>
        </div>
      </div>
    </div>
  );

  if (step === 'code') return (
    <div style={wrapStyle}>
      <div style={cardStyle}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div style={{ fontSize: '44px', marginBottom: '8px' }}>🔑</div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>
            Join RJR Attendance
          </h1>
          <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>
            Enter the join code given by your admin
          </p>
        </div>
        <div style={{ marginBottom: '14px' }}>
          <label style={{ fontSize: '13px', fontWeight: 600, color: '#374151',
            display: 'block', marginBottom: '6px' }}>Join Code</label>
          <input
            value={code}
            onChange={e => { setCode(e.target.value.toUpperCase()); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && handleCodeSubmit()}
            placeholder="e.g. XK3P7Q"
            maxLength={6}
            style={{
              width: '100%', padding: '12px 14px',
              border: `1.5px solid ${error ? '#e02424' : '#d1d5db'}`,
              borderRadius: '8px', fontSize: '22px', fontWeight: 700,
              letterSpacing: '0.2em', textAlign: 'center',
              outline: 'none', boxSizing: 'border-box', textTransform: 'uppercase'
            }}
            autoFocus
          />
          {error && <p style={{ color: '#e02424', fontSize: '13px', margin: '6px 0 0' }}>{error}</p>}
        </div>
        <button onClick={handleCodeSubmit} disabled={loading}
          style={{ width: '100%', padding: '11px', background: loading ? '#9ca3af' : '#0891b2',
            color: '#fff', border: 'none', borderRadius: '8px', fontSize: '15px',
            fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', marginBottom: '10px' }}>
          {loading ? 'Verifying…' : 'Continue →'}
        </button>
        <button onClick={onBack}
          style={{ width: '100%', padding: '9px', background: 'transparent',
            color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: '8px',
            fontSize: '13px', cursor: 'pointer' }}>
          ← Back to Login
        </button>
      </div>
    </div>
  );

  // step === 'form'
  return (
    <div style={wrapStyle}>
      <div style={{ ...cardStyle, maxWidth: '440px', overflowY: 'auto', maxHeight: '95vh' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '38px', marginBottom: '6px' }}>👤</div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>
            Create Your Profile
          </h1>
          <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>
            Fill in your details to complete registration
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#374151',
              display: 'block', marginBottom: '5px' }}>Full Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="e.g. Rajan Kumar" autoFocus
              style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #d1d5db',
                borderRadius: '8px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#374151',
              display: 'block', marginBottom: '5px' }}>Designation</label>
            <input value={form.designation} onChange={e => set('designation', e.target.value)}
              placeholder="e.g. Sales Executive"
              style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #d1d5db',
                borderRadius: '8px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#374151',
              display: 'block', marginBottom: '5px' }}>Phone Number</label>
            <input value={form.phone} onChange={e => set('phone', e.target.value)}
              placeholder="e.g. 9876543210" type="tel"
              style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #d1d5db',
                borderRadius: '8px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#374151',
              display: 'block', marginBottom: '8px' }}>Work Shift *</label>
            {SHIFTS.map(s => (
              <label key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
                padding: '9px 12px', borderRadius: '8px', marginBottom: '6px',
                border: `2px solid ${form.shiftId === s.id ? '#0891b2' : '#e5e7eb'}`,
                background: form.shiftId === s.id ? '#f0f9ff' : 'white'
              }}>
                <input type="radio" name="shift" checked={form.shiftId === s.id}
                  onChange={() => set('shiftId', s.id)} style={{ width: 'auto', margin: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13px',
                    color: form.shiftId === s.id ? '#0891b2' : '#111' }}>{s.label}</div>
                  <div style={{ fontSize: '11px', color: '#6b7280' }}>{s.display}</div>
                </div>
              </label>
            ))}
          </div>
          <div>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#374151',
              display: 'block', marginBottom: '5px' }}>Set Password *</label>
            <input type="password" value={form.password} onChange={e => set('password', e.target.value)}
              placeholder="Min. 4 characters"
              style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #d1d5db',
                borderRadius: '8px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#374151',
              display: 'block', marginBottom: '5px' }}>Confirm Password *</label>
            <input type="password" value={form.confirmPw}
              onChange={e => set('confirmPw', e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRegister()}
              placeholder="Re-enter your password"
              style={{ width: '100%', padding: '10px 14px',
                border: `1.5px solid ${form.confirmPw && form.confirmPw !== form.password ? '#e02424' : '#d1d5db'}`,
                borderRadius: '8px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }} />
            {form.confirmPw && form.confirmPw !== form.password && (
              <p style={{ color: '#e02424', fontSize: '12px', margin: '4px 0 0' }}>Passwords don't match</p>
            )}
          </div>
        </div>
        <button onClick={handleRegister} disabled={loading}
          style={{ width: '100%', padding: '12px',
            background: loading ? '#9ca3af' : '#0891b2',
            color: '#fff', border: 'none', borderRadius: '8px',
            fontSize: '15px', fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer', marginTop: '20px' }}>
          {loading ? 'Registering…' : '✅ Complete Registration'}
        </button>
      </div>
    </div>
  );
}

// ─── Login Screen ──────────────────────────────────────────────────────────

function LoginScreen({ onLogin }) {
  const [pw, setPw]           = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [show, setShow]       = useState(false);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('join')) setJoining(true);
  }, []);

  async function handleLogin() {
    if (!pw.trim()) { setError('Please enter a password'); return; }
    setLoading(true); setError('');
    const { adminPw, employeePasswords, employees } = await getLoginData();
    if (pw === adminPw) {
      onLogin('admin', null, employees);
    } else {
      const matchedEmpId = Object.keys(employeePasswords).find(id => employeePasswords[id] === pw);
      if (matchedEmpId) onLogin('employee', matchedEmpId, employees);
      else setError('Incorrect password. Please try again.');
    }
    setLoading(false);
  }

  if (joining) return <JoinScreen onBack={() => setJoining(false)} />;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg,#1a56db 0%,#0891b2 100%)', padding: '1rem' }}>
      <div style={{ background: '#fff', borderRadius: '16px', padding: '2rem 1.5rem',
        width: '100%', maxWidth: '360px', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div style={{ fontSize: '44px', marginBottom: '8px' }}>📋</div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#111827', margin: '0 0 4px' }}>
            RJR Attendance Portal
          </h1>
          <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>Company Attendance System</p>
        </div>
        <div style={{ marginBottom: '14px' }}>
          <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151',
            display: 'block', marginBottom: '6px' }}>Password</label>
          <div style={{ position: 'relative' }}>
            <input type={show ? 'text' : 'password'} value={pw}
              onChange={e => { setPw(e.target.value); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="Enter your password"
              style={{ width: '100%', padding: '10px 40px 10px 14px',
                border: '1.5px solid ' + (error ? '#e02424' : '#d1d5db'),
                borderRadius: '8px', fontSize: '15px', outline: 'none', boxSizing: 'border-box' }}
              autoFocus />
            <button onClick={() => setShow(s => !s)}
              style={{ position: 'absolute', right: '10px', top: '50%',
                transform: 'translateY(-50%)', background: 'none', border: 'none',
                cursor: 'pointer', fontSize: '16px', padding: 0 }}>
              {show ? '🙈' : '👁️'}
            </button>
          </div>
          {error && <p style={{ color: '#e02424', fontSize: '13px', margin: '6px 0 0' }}>{error}</p>}
        </div>
        <button onClick={handleLogin} disabled={loading}
          style={{ width: '100%', padding: '11px',
            background: loading ? '#9ca3af' : '#1a56db',
            color: '#fff', border: 'none', borderRadius: '8px',
            fontSize: '15px', fontWeight: '600',
            cursor: loading ? 'not-allowed' : 'pointer', marginBottom: '10px' }}>
          {loading ? 'Checking…' : 'Login →'}
        </button>
        <button onClick={() => setJoining(true)}
          style={{ width: '100%', padding: '10px', background: '#f0f9ff',
            color: '#0891b2', border: '1.5px solid #bae6fd', borderRadius: '8px',
            fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
          🆕 New Employee? Join with Code →
        </button>
        <div style={{ marginTop: '14px', padding: '12px', background: '#f0f9ff',
          borderRadius: '8px', fontSize: '12px', color: '#0369a1' }}>
          Each employee logs in with their <strong>own personal password</strong>.<br />
          Admin has a separate password for full access.
        </div>
      </div>
    </div>
  );
}

// ─── Constants ─────────────────────────────────────────────────────────────

const MAX_LEAVES = 4;
const MAX_PERMISSION_MINS = 120;

// ── STATUS: Late removed, EOD permission added ──────────────────────────
const STATUS = {
  PRESENT:           'present',
  PRESENT_PERMISSION:'present+permission',
  HALF_FIRST:        'half-first',
  HALF_SECOND:       'half-second',
  HALF_FIRST_PERM:   'half-first+perm',
  HALF_SECOND_PERM:  'half-second+perm',
  ABSENT:            'absent',
  PERMISSION:        'permission',
  PERMISSION_EOD:    'permission-eod',   // ← NEW: End-of-Day permission
};

// All statuses that consume permission minutes
const PERM_STATUSES = [
  STATUS.PERMISSION,
  STATUS.PERMISSION_EOD,
  STATUS.PRESENT_PERMISSION,
  STATUS.HALF_FIRST_PERM,
  STATUS.HALF_SECOND_PERM,
];

const HALF_STATUSES = [
  STATUS.HALF_FIRST,
  STATUS.HALF_SECOND,
  STATUS.HALF_FIRST_PERM,
  STATUS.HALF_SECOND_PERM,
];

const SHIFTS = [
  { id: 'A', label: 'Shift A', start: '09:00', end: '18:00', display: '9:00 AM – 6:00 PM' },
  { id: 'B', label: 'Shift B', start: '09:30', end: '18:30', display: '9:30 AM – 6:30 PM' },
  { id: 'C', label: 'Shift C', start: '10:00', end: '19:00', display: '10:00 AM – 7:00 PM' },
];

function todayStr() { return format(new Date(), 'yyyy-MM-dd'); }
function monthStr(d = new Date()) { return format(d, 'yyyy-MM'); }
function getShift(id) { return SHIFTS.find(s => s.id === id) || SHIFTS[0]; }

// ── Leave count: only Absent + Half days (permission does NOT count as leave) ──
function getLeaveCount(records) {
  const absent = records.filter(r => r.status === STATUS.ABSENT).length;
  const half   = records.filter(r => HALF_STATUSES.includes(r.status)).length;
  return absent + (half * 0.5);
}

// ── Permission balance: tracks usage vs 120-min monthly limit ──────────────
// Excess is shown but does NOT convert to Late
function getPermBalance(empId, month, records) {
  const recs     = records.filter(r => r.empId === empId && r.date.startsWith(month));
  const permUsed = recs
    .filter(r => PERM_STATUSES.includes(r.status))
    .reduce((s, r) => s + (r.permMins || 0), 0);
  const left   = MAX_PERMISSION_MINS - permUsed;
  const excess = left < 0 ? Math.abs(left) : 0;
  return { totalUsed: permUsed, left, permUsed, lateDeduction: 0, overBy: excess };
}

function getOverLimitEmployees(employees, records, month) {
  return employees.map(emp => {
    const recs   = records.filter(r => r.empId === emp.id && r.date.startsWith(month));
    const leaves = getLeaveCount(recs);
    const bal    = getPermBalance(emp.id, month, records);
    return {
      emp, leaves, bal,
      overLeave: leaves > MAX_LEAVES, overLeaveBy: Math.max(0, leaves - MAX_LEAVES),
      overPerm:  bal.left < 0,        overPermBy:  bal.overBy,
    };
  }).filter(x => x.overLeave || x.overPerm);
}

function exportCSV(employees, records, month) {
  const days   = getDaysInMonth(new Date(month + '-01'));
  const header = ['Employee', 'Designation', 'Shift',
    ...Array.from({ length: days }, (_, i) => String(i + 1).padStart(2, '0')),
    'Present', 'Half Day', 'Absent', 'Perm Days', 'Leave Count',
    'Perm Used', 'Perm Left', 'Excess Perm', 'Leave Status', 'Perm Status'];
  const rows = employees.map(emp => {
    const empRecs = records.filter(r => r.empId === emp.id && r.date.startsWith(month));
    const byDate  = Object.fromEntries(empRecs.map(r => [r.date.slice(8, 10), r]));
    const lbls = {
      'present':           'P',
      'present+permission':'P+Pm',
      'half-first':        'H1',
      'half-second':       'H2',
      'half-first+perm':   'H1+Pm',
      'half-second+perm':  'H2+Pm',
      'absent':            'A',
      'permission':        'Pm',
      'permission-eod':    'PmEOD',
    };
    const dayCells = Array.from({ length: days }, (_, i) => {
      const key = String(i + 1).padStart(2, '0');
      const rec = byDate[key];
      if (!rec) return '-';
      if (PERM_STATUSES.includes(rec.status)) return `${lbls[rec.status]}(${rec.permMins}m)`;
      return lbls[rec.status] || rec.status;
    });
    const present = empRecs.filter(r => [STATUS.PRESENT, STATUS.PRESENT_PERMISSION].includes(r.status)).length;
    const halfDay = empRecs.filter(r => HALF_STATUSES.includes(r.status)).length;
    const absent  = empRecs.filter(r => r.status === STATUS.ABSENT).length;
    const perm    = empRecs.filter(r => PERM_STATUSES.includes(r.status)).length;
    const bal     = getPermBalance(emp.id, month, records);
    const leaves  = getLeaveCount(empRecs);
    const leaveStatus = leaves > MAX_LEAVES ? `EXCEEDED by ${leaves - MAX_LEAVES}` : 'OK';
    const permStatus  = bal.left < 0 ? `EXCEEDED by ${Math.abs(bal.left)} min` : 'OK';
    return [emp.name, emp.designation || '', getShift(emp.shiftId).display,
      ...dayCells, present, halfDay, absent, perm,
      leaves, bal.totalUsed, Math.max(0, bal.left), bal.overBy,
      leaveStatus, permStatus];
  });
  const csv  = [header, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `attendance_${month}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ─── Nav ───────────────────────────────────────────────────────────────────

function Nav({ tab, setTab, role, empName, onLogout }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const tabs = role === 'admin'
    ? [['today', 'Mark'], ['employees', 'Employees'], ['calendar', 'Calendar'], ['report', 'Report'], ['alerts', '⚠️ Alerts'], ['maintenance', '⚙️ Maintenance']]
    : [['calendar', 'My Calendar'], ['report', 'My Report']];
  return (
    <nav className="nav">
      <div className="nav-inner">
        <span className="nav-brand">📋 RJR Attendance Portal</span>
        <div className="nav-tabs desktop-only">
          {tabs.map(([key, label]) => (
            <button key={key} className={`nav-tab${tab === key ? ' active' : ''}`}
              onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
          {role === 'employee' && empName && (
            <span style={{ fontSize: '12px', color: '#374151', fontWeight: 600 }}
              className="desktop-only">👤 {empName}</span>
          )}
          <span style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '20px', fontWeight: 700,
            background: role === 'admin' ? '#1a56db22' : '#0891b222',
            color: role === 'admin' ? '#1a56db' : '#0891b2' }}>
            {role === 'admin' ? '👑 Admin' : 'Employee'}
          </span>
          <button onClick={onLogout}
            style={{ fontSize: '12px', padding: '4px 10px', border: '1px solid #d1d5db',
              borderRadius: '6px', background: '#fff', cursor: 'pointer', color: '#374151' }}>
            Logout
          </button>
          <button className="mobile-only" onClick={() => setMenuOpen(m => !m)}
            style={{ fontSize: '20px', background: 'none', border: 'none',
              cursor: 'pointer', padding: '2px 6px' }}>
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>
      </div>
      {menuOpen && (
        <div className="mobile-only"
          style={{ background: 'white', borderTop: '1px solid #e5e7eb', padding: '8px 0' }}>
          {tabs.map(([key, label]) => (
            <button key={key} onClick={() => { setTab(key); setMenuOpen(false); }}
              style={{ display: 'block', width: '100%', padding: '10px 20px', textAlign: 'left',
                background: tab === key ? '#eff6ff' : 'transparent',
                color: tab === key ? '#1a56db' : '#374151',
                border: 'none', cursor: 'pointer',
                fontWeight: tab === key ? 600 : 400, fontSize: '14px' }}>
              {label}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}

// ─── Badge helpers ─────────────────────────────────────────────────────────

const BADGE_MAP = {
  'present':           { cls: 'badge-present',    label: 'Present' },
  'present+permission':{ cls: 'badge-pressperm',  label: 'Present + Permission' },
  'half-first':        { cls: 'badge-halffirst',  label: '½ 1st Half Off' },
  'half-second':       { cls: 'badge-halfsecond', label: '½ 2nd Half Off' },
  'half-first+perm':   { cls: 'badge-halffirstp', label: '½ 1st + Permission' },
  'half-second+perm':  { cls: 'badge-halfsecondp',label: '½ 2nd + Permission' },
  'absent':            { cls: 'badge-absent',     label: 'Absent' },
  'permission':        { cls: 'badge-permission', label: 'Permission' },
  'permission-eod':    { cls: 'badge-permissioneod', label: 'Permission EOD' },
};

const CAL_COLORS = {
  'present':           { bg: '#d1fae5', color: '#065f46', label: 'P' },
  'present+permission':{ bg: '#fef3c7', color: '#92400e', label: 'P+Pm' },
  'half-first':        { bg: '#dbeafe', color: '#1e40af', label: '½1' },
  'half-second':       { bg: '#bfdbfe', color: '#1e40af', label: '½2' },
  'half-first+perm':   { bg: '#ede9fe', color: '#5b21b6', label: '½1P' },
  'half-second+perm':  { bg: '#ddd6fe', color: '#5b21b6', label: '½2P' },
  'absent':            { bg: '#fee2e2', color: '#991b1b', label: 'A' },
  'permission':        { bg: '#e0f2fe', color: '#0c4a6e', label: 'Pm' },
  'permission-eod':    { bg: '#fff7ed', color: '#c2410c', label: 'EOD' },
};

function StatusBadge({ status }) {
  const { cls, label } = BADGE_MAP[status] || { cls: 'badge-present', label: status };
  return <span className={`badge ${cls}`}>{label}</span>;
}

function ShiftBadge({ shiftId }) {
  const shift  = getShift(shiftId);
  const colors = { A: '#1a56db', B: '#0891b2', C: '#7c3aed' };
  return (
    <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px',
      background: colors[shift.id] + '22', color: colors[shift.id], whiteSpace: 'nowrap' }}>
      {shift.label}
    </span>
  );
}

// PermDisplay: shows balance, and excess in orange (not red critical — it's just excess, not a penalty)
function PermDisplay({ left }) {
  const over  = left < 0;
  const color = over ? '#d97706' : left < 60 ? '#d97706' : '#0e9f6e';
  return (
    <span style={{ fontWeight: 700, color, fontSize: '13px', whiteSpace: 'nowrap' }}>
      {over ? `−${Math.abs(left)}m` : `${left}m`}
      {over && <span style={{ marginLeft: '3px' }}>🟡</span>}
    </span>
  );
}

// ─── Join Code Manager (admin panel) ──────────────────────────────────────

function JoinCodeManager() {
  const [code, setCode]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [copied, setCopied]   = useState(false);

  useEffect(() => {
    getJoinCode().then(c => { setCode(c); setLoading(false); });
  }, []);

  async function handleGenerate() {
    setSaving(true);
    const newCode = generateCode();
    await saveJoinCode(newCode);
    setCode(newCode);
    setSaving(false);
  }

  async function handleDisable() {
    if (!confirm("Disable the join code? New employees won't be able to self-register until a new code is generated.")) return;
    setSaving(true);
    await clearJoinCode();
    setCode(null);
    setSaving(false);
  }

  function copyCode() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}?join=${code}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) return null;

  return (
    <div className="card" style={{ marginBottom: '1.25rem', border: '2px solid #bae6fd', background: '#f0f9ff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <span style={{ fontSize: '18px' }}>🔗</span>
        <h3 style={{ fontSize: '14px', fontWeight: 700, margin: 0, color: '#0c4a6e' }}>
          Employee Self-Registration
        </h3>
        {code
          ? <span style={{ marginLeft: 'auto', fontSize: '11px', background: '#d1fae5',
              color: '#065f46', fontWeight: 700, padding: '2px 8px', borderRadius: '20px',
              border: '1px solid #6ee7b7' }}>● Active</span>
          : <span style={{ marginLeft: 'auto', fontSize: '11px', background: '#f3f4f6',
              color: '#6b7280', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>Disabled</span>
        }
      </div>
      <p style={{ fontSize: '12px', color: '#0369a1', margin: '0 0 12px' }}>
        Share this join code with new employees so they can register themselves before logging in.
      </p>
      {code ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px',
            background: 'white', border: '2px dashed #0891b2', borderRadius: '10px',
            padding: '12px 16px', marginBottom: '10px' }}>
            <span style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '0.2em',
              color: '#0891b2', fontFamily: 'monospace', flex: 1 }}>
              {code}
            </span>
            <button onClick={copyCode}
              style={{ padding: '6px 12px',
                background: copied ? '#d1fae5' : '#e0f2fe',
                color: copied ? '#065f46' : '#0369a1',
                border: 'none', borderRadius: '6px',
                fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
              {copied ? '✓ Copied!' : '📋 Copy'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button onClick={copyLink}
              style={{ flex: 1, minWidth: '120px', padding: '8px 12px',
                background: '#0891b2', color: 'white', border: 'none',
                borderRadius: '8px', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}>
              🔗 Copy Join Link
            </button>
            <button onClick={handleGenerate} disabled={saving}
              style={{ padding: '8px 12px', background: 'white', color: '#0369a1',
                border: '1px solid #bae6fd', borderRadius: '8px',
                fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}>
              🔄 New Code
            </button>
            <button onClick={handleDisable} disabled={saving}
              style={{ padding: '8px 12px', background: 'white', color: '#dc2626',
                border: '1px solid #fca5a5', borderRadius: '8px',
                fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}>
              🚫 Disable
            </button>
          </div>
          <p style={{ fontSize: '11px', color: '#64748b', margin: '10px 0 0' }}>
            💡 Share the code OR the full link. New employee enters the code → fills bio → sets password → can login immediately.
          </p>
        </>
      ) : (
        <button onClick={handleGenerate} disabled={saving}
          style={{ width: '100%', padding: '10px', background: '#0891b2',
            color: 'white', border: 'none', borderRadius: '8px',
            fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
          {saving ? 'Generating…' : '+ Generate Join Code'}
        </button>
      )}
    </div>
  );
}

// ─── Employee Modal ────────────────────────────────────────────────────────

function EmployeeModal({ emp, onSave, onClose }) {
  const [form, setForm] = useState({
    name: emp?.name || '', designation: emp?.designation || '',
    phone: emp?.phone || '', shiftId: emp?.shiftId || 'A', password: emp?.password || ''
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function save() {
    if (!form.name.trim())     return alert('Name is required');
    if (!form.password.trim()) return alert('Password is required');
    const id = emp?.id || `emp_${Date.now()}`;
    await setDoc(doc(db, 'employees', id), {
      id, name: form.name, designation: form.designation, phone: form.phone,
      shiftId: form.shiftId, createdAt: emp?.createdAt || Date.now()
    });
    await setDoc(doc(db, 'config', 'passwords'),
      { employees: { [id]: form.password } }, { merge: true });
    onSave();
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>{emp ? 'Edit Employee' : 'Add Employee'}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div><label>Full Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="e.g. Rajan Kumar" /></div>
          <div><label>Designation</label>
            <input value={form.designation} onChange={e => set('designation', e.target.value)}
              placeholder="e.g. Sales Executive" /></div>
          <div><label>Phone</label>
            <input value={form.phone} onChange={e => set('phone', e.target.value)}
              placeholder="e.g. 9876543210" /></div>
          <div>
            <label>Login Password *
              <span style={{ fontSize: '11px', color: '#6b7280', fontWeight: 400 }}>
                (employee uses this to login)
              </span>
            </label>
            <input type="text" value={form.password}
              onChange={e => set('password', e.target.value)} placeholder="e.g. rajan2024" />
          </div>
          <div>
            <label>Work Shift</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
              {SHIFTS.map(s => (
                <label key={s.id} style={{
                  display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
                  padding: '10px 14px', borderRadius: '8px',
                  border: `2px solid ${form.shiftId === s.id ? '#1a56db' : '#e5e7eb'}`,
                  background: form.shiftId === s.id ? '#eff6ff' : 'white', margin: 0
                }}>
                  <input type="radio" name="shift" checked={form.shiftId === s.id}
                    onChange={() => set('shiftId', s.id)} style={{ width: 'auto', margin: 0 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px',
                      color: form.shiftId === s.id ? '#1a56db' : '#111' }}>{s.label}</div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>{s.display}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '1.5rem', justifyContent: 'flex-end' }}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>{emp ? 'Update' : 'Add Employee'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Attendance Modal ──────────────────────────────────────────────────────

function AttendanceModal({ emp, existing, selectedDate, onSave, onClose }) {
  const [status, setStatus]         = useState(existing?.status || STATUS.PRESENT);
  const [permMins, setPermMins]     = useState(existing?.permMins || '');
  const [note, setNote]             = useState(existing?.note || '');
  // Shift override: defaults to employee's assigned shift, but can be changed for this day
  const [overrideShift, setOverrideShift] = useState(existing?.shiftId || emp.shiftId || 'A');
  const isShiftOverridden = overrideShift !== (emp.shiftId || 'A');
  const shift     = getShift(overrideShift);
  const mins      = Number(permMins) || 0;
  const needsMins = PERM_STATUSES.includes(status);
  const isExcess  = needsMins && mins > MAX_PERMISSION_MINS;

  // Status option groups — Late removed, EOD permission added
  const statusGroups = [
    { group: 'Full Day', options: [
      { value: STATUS.PRESENT,            icon: '✅',   label: 'Present',              hint: 'Full day present' },
      { value: STATUS.PRESENT_PERMISSION, icon: '✅🕐', label: 'Present + Permission', hint: 'Full day + permission time' },
      { value: STATUS.ABSENT,             icon: '❌',   label: 'Absent',               hint: 'Did not come' },
      { value: STATUS.PERMISSION,         icon: '🕐',   label: 'Permission',           hint: 'Left early / arrived late' },
      { value: STATUS.PERMISSION_EOD,     icon: '🌆🕐', label: 'Permission – End of Day', hint: 'Left before shift ends (EOD)' },
    ]},
    { group: '½ Half Day', options: [
      { value: STATUS.HALF_FIRST,       icon: '🌅❌', label: '1st Half Off',              hint: 'Morning off, came afternoon' },
      { value: STATUS.HALF_SECOND,      icon: '🌆❌', label: '2nd Half Off',              hint: 'Came morning, left after lunch' },
      { value: STATUS.HALF_FIRST_PERM,  icon: '🌅🕐', label: '1st Half Off + Permission', hint: 'Morning off + permission time' },
      { value: STATUS.HALF_SECOND_PERM, icon: '🌆🕐', label: '2nd Half Off + Permission', hint: 'Afternoon off + permission time' },
    ]},
  ];

  async function save() {
    const finalMins = needsMins ? mins : 0;
    const recId = `${emp.id}_${selectedDate}`;
    await setDoc(doc(db, 'attendance', recId), {
      id: recId, empId: emp.id, empName: emp.name,
      date: selectedDate, month: selectedDate.slice(0, 7),
      status, permMins: finalMins,
      note,
      shiftId: overrideShift,
      defaultShiftId: emp.shiftId || 'A',
      shiftOverridden: isShiftOverridden,
      markedAt: Date.now()
    });
    onSave();
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: '500px' }}>
        <h2 style={{ fontSize: '17px' }}>Mark Attendance</h2>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center',
          marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: '15px' }}>{emp.name}</span>
          <span style={{ color: '#6b7280' }}>·</span>
          <span style={{ fontSize: '13px', color: '#6b7280' }}>{selectedDate}</span>
          <ShiftBadge shiftId={emp.shiftId || 'A'} />
          {isShiftOverridden && (
            <span style={{ fontSize: '11px', background: '#fff7ed', color: '#c2410c',
              border: '1px solid #fed7aa', borderRadius: '20px',
              padding: '2px 8px', fontWeight: 700 }}>
              → Override: {shift.label}
            </span>
          )}
        </div>

        {/* ── Shift Override ── */}
        <div style={{ background: isShiftOverridden ? '#fff7ed' : '#f8fafc',
          border: `1.5px solid ${isShiftOverridden ? '#f97316' : '#e5e7eb'}`,
          borderRadius: '10px', padding: '10px 12px', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: '7px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#374151',
              textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              🔄 Shift for This Day
            </span>
            {isShiftOverridden && (
              <button onClick={() => setOverrideShift(emp.shiftId || 'A')}
                style={{ fontSize: '11px', color: '#6b7280', background: 'none',
                  border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                Reset to default
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {SHIFTS.map(s => {
              const isDefault = s.id === (emp.shiftId || 'A');
              const isSelected = overrideShift === s.id;
              return (
                <button key={s.id} onClick={() => setOverrideShift(s.id)}
                  style={{
                    flex: 1, minWidth: '90px', padding: '7px 8px', borderRadius: '8px',
                    border: `2px solid ${isSelected ? (isDefault ? '#1a56db' : '#f97316') : '#e5e7eb'}`,
                    background: isSelected ? (isDefault ? '#eff6ff' : '#fff7ed') : 'white',
                    cursor: 'pointer', textAlign: 'center',
                  }}>
                  <div style={{ fontWeight: 700, fontSize: '12px',
                    color: isSelected ? (isDefault ? '#1a56db' : '#c2410c') : '#374151' }}>
                    {s.label}
                    {isDefault && <span style={{ fontSize: '9px', marginLeft: '3px',
                      color: '#9ca3af', fontWeight: 400 }}>(default)</span>}
                  </div>
                  <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '1px' }}>{s.display}</div>
                </button>
              );
            })}
          </div>
          {isShiftOverridden && (
            <div style={{ fontSize: '11px', color: '#c2410c', marginTop: '6px', fontWeight: 600 }}>
              ⚠️ This employee's default is {getShift(emp.shiftId).label} ({getShift(emp.shiftId).display})
            </div>
          )}
        </div>

        <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px',
          padding: '6px 12px', marginBottom: '0.75rem', fontSize: '12px', color: '#0c4a6e' }}>
          🕐 {shift.start}–{shift.end} | Permission limit: <strong>120 min/month</strong>
          <span style={{ marginLeft: '8px', color: '#6b7280' }}>
            (excess is tracked but does not convert to absent)
          </span>
        </div>
        {statusGroups.map(grp => (
          <div key={grp.group} style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#6b7280',
              textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>
              {grp.group}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {grp.options.map(s => (
                <button key={s.value} onClick={() => setStatus(s.value)}
                  style={{ padding: '8px 12px', borderRadius: '8px',
                    border: `2px solid ${status === s.value ? '#1a56db' : '#e5e7eb'}`,
                    background: status === s.value ? '#eff6ff' : 'white',
                    cursor: 'pointer', fontWeight: 600, fontSize: '13px',
                    color: status === s.value ? '#1a56db' : '#111',
                    textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '15px', minWidth: '26px' }}>{s.icon}</span>
                  <span>{s.label}</span>
                  <span style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 400,
                    marginLeft: 'auto' }}>{s.hint}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {needsMins && (
          <div style={{ marginBottom: '0.75rem' }}>
            <label>Permission Duration (minutes)</label>
            <input type="number" value={permMins}
              onChange={e => setPermMins(e.target.value)}
              placeholder="e.g. 60" min="1" />
            {isExcess ? (
              <p style={{ color: '#d97706', fontSize: '12px', marginTop: '4px', fontWeight: 600 }}>
                🟡 Over 120 min — {mins - MAX_PERMISSION_MINS} min excess will be tracked (no penalty)
              </p>
            ) : mins > 0 ? (
              <p style={{ color: '#0e9f6e', fontSize: '12px', marginTop: '4px' }}>
                ✓ {mins} min will be deducted from balance
              </p>
            ) : null}
          </div>
        )}
        <div>
          <label>Note (optional)</label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Any remarks..." />
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>
            Save — {(BADGE_MAP[status]?.label || status).toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Today / Mark Attendance Tab ───────────────────────────────────────────

function TodayTab({ employees, records, onRefresh }) {
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [markEmp, setMarkEmp]           = useState(null);
  const mo       = selectedDate.slice(0, 7);
  const dateRecs = records.filter(r => r.date === selectedDate);
  const byEmpId  = Object.fromEntries(dateRecs.map(r => [r.empId, r]));
  const present  = dateRecs.filter(r => [STATUS.PRESENT, STATUS.PRESENT_PERMISSION].includes(r.status)).length;
  const halfDay  = dateRecs.filter(r => HALF_STATUSES.includes(r.status)).length;
  const absent   = dateRecs.filter(r => r.status === STATUS.ABSENT).length;
  const perm     = dateRecs.filter(r => PERM_STATUSES.includes(r.status)).length;
  const unmarked = employees.length - dateRecs.length;

  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '1rem' }}>Mark Attendance</h1>
      <div className="card" style={{ marginBottom: '1rem', display: 'flex',
        alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1', minWidth: '160px' }}>
          <label>Select Date</label>
          <input type="date" value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)} max={todayStr()} />
        </div>
        <button className="btn btn-outline" style={{ marginTop: '18px' }}
          onClick={() => setSelectedDate(todayStr())}>Today</button>
        <span style={{ marginTop: '18px', fontSize: '13px', fontWeight: 600, color: '#1a56db' }}>
          {format(parseISO(selectedDate), 'EEE, dd MMM yyyy')}
        </span>
      </div>

      <div className="stats-grid">
        {[{ label: 'Present',  value: present,  color: '#065f46' },
          { label: 'Half Day', value: halfDay,  color: '#1e40af' },
          { label: 'Absent',   value: absent,   color: '#991b1b' },
          { label: 'Perm',     value: perm,     color: '#0c4a6e' },
          { label: 'Unmarked', value: unmarked, color: '#6b7280' }]
          .map(s => (
          <div key={s.label} className="stat-card">
            <div className="value" style={{ color: s.color }}>{s.value}</div>
            <div className="label">{s.label}</div>
          </div>
        ))}
      </div>

      {SHIFTS.map(shift => {
        const shiftEmps = employees.filter(e => (e.shiftId || 'A') === shift.id);
        if (!shiftEmps.length) return null;
        return (
          <div key={shift.id} style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px',
              marginBottom: '8px', flexWrap: 'wrap' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '700' }}>{shift.label}</h3>
              <span style={{ fontSize: '12px', color: '#6b7280' }}>{shift.display}</span>
              <span style={{ fontSize: '11px', background: '#f3f4f6',
                padding: '2px 8px', borderRadius: '20px' }}>{shiftEmps.length} members</span>
            </div>
            <div className="card" style={{ padding: '0' }}>
              <div className="table-wrap">
                <table>
                  <thead><tr>
                    <th>#</th><th>Name</th><th>Status</th>
                    <th>Perm</th><th>Balance</th><th>Leaves</th><th>Action</th>
                  </tr></thead>
                  <tbody>
                    {shiftEmps.map((emp, i) => {
                      const rec        = byEmpId[emp.id];
                      const bal        = getPermBalance(emp.id, mo, records);
                      const empMoRecs  = records.filter(r => r.empId === emp.id && r.date.startsWith(mo));
                      const leavesUsed = getLeaveCount(empMoRecs);
                      const overLeave  = leavesUsed >= MAX_LEAVES;
                      const overPerm   = bal.left < 0;
                      return (
                        <tr key={emp.id} style={{ background: overLeave || overPerm ? '#fffbeb' : '' }}>
                          <td style={{ color: '#6b7280' }}>{i + 1}</td>
                          <td style={{ fontWeight: 700, fontSize: '13px' }}>
                            {emp.name}
                            {emp.selfRegistered && (
                              <span title="Self-registered" style={{ marginLeft: '4px',
                                fontSize: '10px', color: '#0891b2' }}>🆕</span>
                            )}
                            {(overLeave || overPerm) && (
                              <span style={{ marginLeft: '4px', fontSize: '10px', color: '#d97706' }}>⚠️</span>
                            )}
                          </td>
                          <td>
                            {rec
                              ? <>
                                  <StatusBadge status={rec.status} />
                                  {rec.shiftOverridden && (
                                    <span style={{ display: 'inline-block', marginLeft: '4px',
                                      fontSize: '10px', background: '#fff7ed', color: '#c2410c',
                                      border: '1px solid #fed7aa', borderRadius: '10px',
                                      padding: '1px 5px', fontWeight: 700, verticalAlign: 'middle' }}
                                      title={`Shift override: ${getShift(rec.shiftId).label}`}>
                                      🔄 {getShift(rec.shiftId).label}
                                    </span>
                                  )}
                                </>
                              : <span style={{ color: '#9ca3af', fontSize: '12px' }}>—</span>}
                          </td>
                          <td style={{ fontSize: '12px' }}>
                            {rec && PERM_STATUSES.includes(rec.status) && rec.permMins ? `${rec.permMins}m` : '—'}
                          </td>
                          <td><PermDisplay left={bal.left} /></td>
                          <td style={{ color: overLeave ? '#d97706' : '#374151',
                            fontWeight: overLeave ? 700 : 400, fontSize: '12px' }}>
                            {leavesUsed}/{MAX_LEAVES}{overLeave && '⚠️'}
                          </td>
                          <td>
                            <button className="btn btn-primary"
                              style={{ padding: '4px 10px', fontSize: '12px' }}
                              onClick={() => setMarkEmp(emp)}>
                              {rec ? 'Edit' : 'Mark'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })}

      {markEmp && (
        <AttendanceModal emp={markEmp} existing={byEmpId[markEmp.id]}
          selectedDate={selectedDate}
          onSave={() => { setMarkEmp(null); onRefresh(); }}
          onClose={() => setMarkEmp(null)} />
      )}
    </div>
  );
}

// ─── Employees Tab ─────────────────────────────────────────────────────────

function EmployeesTab({ employees, records, onRefresh }) {
  const [modal, setModal] = useState(null);
  const mo = monthStr();

  async function deleteEmp(emp) {
    if (!confirm(`Delete ${emp.name}?`)) return;
    await deleteDoc(doc(db, 'employees', emp.id));
    onRefresh();
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700' }}>Employees ({employees.length})</h1>
        <button className="btn btn-primary" onClick={() => setModal('add')}>+ Add</button>
      </div>

      <JoinCodeManager />

      <div className="stats-grid" style={{ marginBottom: '1rem' }}>
        {SHIFTS.map(s => {
          const count  = employees.filter(e => (e.shiftId || 'A') === s.id).length;
          const colors = { A: '#1a56db', B: '#0891b2', C: '#7c3aed' };
          return (
            <div key={s.id} className="stat-card">
              <div className="value" style={{ color: colors[s.id] }}>{count}</div>
              <div className="label">{s.label}</div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>#</th><th>Name</th><th>Shift</th><th>Designation</th>
              <th>Leaves</th><th>Perm</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {employees.map((emp, i) => {
                const empRecs    = records.filter(r => r.empId === emp.id && r.date.startsWith(mo));
                const leavesUsed = getLeaveCount(empRecs);
                const bal        = getPermBalance(emp.id, mo, records);
                const overLeave  = leavesUsed >= MAX_LEAVES;
                const overPerm   = bal.left < 0;
                return (
                  <tr key={emp.id} style={{ background: overLeave || overPerm ? '#fffbeb' : '' }}>
                    <td style={{ color: '#6b7280' }}>{i + 1}</td>
                    <td style={{ fontWeight: 600, fontSize: '13px' }}>
                      {emp.name}
                      {emp.selfRegistered && (
                        <span title="Self-registered" style={{ marginLeft: '4px',
                          fontSize: '10px', color: '#0891b2' }}>🆕</span>
                      )}
                      {(overLeave || overPerm) && (
                        <span style={{ marginLeft: '4px', color: '#d97706', fontSize: '10px' }}>⚠️</span>
                      )}
                    </td>
                    <td><ShiftBadge shiftId={emp.shiftId} /></td>
                    <td style={{ color: '#6b7280', fontSize: '12px' }}>{emp.designation || '—'}</td>
                    <td style={{ color: overLeave ? '#d97706' : '#374151',
                      fontWeight: overLeave ? 700 : 400, fontSize: '12px' }}>
                      {leavesUsed}/{MAX_LEAVES}{overLeave && '⚠️'}
                    </td>
                    <td><PermDisplay left={bal.left} /></td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button className="btn btn-outline"
                          style={{ padding: '4px 8px', fontSize: '12px' }}
                          onClick={() => setModal(emp)}>Edit</button>
                        <button className="btn btn-danger"
                          style={{ padding: '4px 8px', fontSize: '12px' }}
                          onClick={() => deleteEmp(emp)}>Del</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {employees.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: '#6b7280',
                  padding: '2rem' }}>No employees yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <EmployeeModal emp={modal === 'add' ? null : modal}
          onSave={() => { setModal(null); onRefresh(); }}
          onClose={() => setModal(null)} />
      )}
    </div>
  );
}

// ─── Calendar Tab ──────────────────────────────────────────────────────────

function CalendarTab({ employees, records, defaultEmp, onRefresh }) {
  const [selEmp, setSelEmp]     = useState(defaultEmp || '');
  const [viewDate, setViewDate] = useState(new Date());
  const [markEmp, setMarkEmp]   = useState(null);
  const [markDate, setMarkDate] = useState(null);
  const isEmployeeView = !!defaultEmp;
  const mo  = monthStr(viewDate);
  const emp = employees.find(e => e.id === selEmp);
  const days     = eachDayOfInterval({ start: startOfMonth(viewDate), end: endOfMonth(viewDate) });
  const firstDay = getDay(startOfMonth(viewDate));
  const blanks   = Array(firstDay).fill(null);
  const empRecs  = records.filter(r => r.empId === selEmp && r.date.startsWith(mo));
  const byDate   = Object.fromEntries(empRecs.map(r => [r.date, r]));
  const present  = empRecs.filter(r => [STATUS.PRESENT, STATUS.PRESENT_PERMISSION].includes(r.status)).length;
  const halfDay  = empRecs.filter(r => HALF_STATUSES.includes(r.status)).length;
  const absent   = empRecs.filter(r => r.status === STATUS.ABSENT).length;
  const perm     = empRecs.filter(r => PERM_STATUSES.includes(r.status)).length;
  const leavesUsed = emp ? getLeaveCount(empRecs) : 0;
  const bal = emp
    ? getPermBalance(emp.id, mo, records)
    : { left: 120, totalUsed: 0, permUsed: 0, lateDeduction: 0, overBy: 0 };
  const permUsedRecs = empRecs.filter(r => PERM_STATUSES.includes(r.status) && r.permMins > 0);

  function handleDayClick(day) {
    if (!emp) return;
    const ds = format(day, 'yyyy-MM-dd');
    if (ds > todayStr()) return;
    if (isEmployeeView && ds !== todayStr()) return;
    setMarkDate(ds); setMarkEmp(emp);
  }

  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '1rem' }}>
        {isEmployeeView ? 'My Calendar' : 'Calendar View'}
      </h1>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {!isEmployeeView && (
            <div style={{ flex: '1', minWidth: '180px' }}>
              <label>Select Employee</label>
              <select value={selEmp} onChange={e => setSelEmp(e.target.value)}>
                <option value="">— Choose employee —</option>
                {SHIFTS.map(s => (
                  <optgroup key={s.id} label={`${s.label} · ${s.display}`}>
                    {employees.filter(e => (e.shiftId || 'A') === s.id).map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px',
            marginTop: !isEmployeeView ? '18px' : '0' }}>
            <button className="btn btn-outline" style={{ padding: '7px 10px' }}
              onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>←</button>
            <span style={{ fontWeight: 600, minWidth: '110px', textAlign: 'center', fontSize: '14px' }}>
              {format(viewDate, 'MMM yyyy')}
            </span>
            <button className="btn btn-outline" style={{ padding: '7px 10px' }}
              onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>→</button>
          </div>
        </div>
      </div>

      {selEmp && emp && (
        <>
          <div className="stats-grid" style={{ marginBottom: '1rem' }}>
            {[{ label: 'Present',              value: present,    color: '#065f46' },
              { label: 'Half',                 value: halfDay,    color: '#1e40af' },
              { label: 'Absent',               value: absent,     color: '#991b1b' },
              { label: 'Perm Days',            value: perm,       color: '#0c4a6e' },
              { label: `Leaves/${MAX_LEAVES}`, value: leavesUsed, color: leavesUsed >= MAX_LEAVES ? '#d97706' : '#374151' }]
              .map((s, i) => (
              <div key={i} className="stat-card">
                <div className="value" style={{ color: s.color, fontSize: '20px' }}>{s.value}</div>
                <div className="label">{s.label}</div>
              </div>
            ))}
          </div>

          {permUsedRecs.length > 0 && (
            <div style={{ background: '#fff7ed', border: '2px solid #f97316', borderRadius: '10px',
              padding: '12px 14px', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ fontSize: '16px' }}>🕐</span>
                <span style={{ fontWeight: 700, color: '#c2410c', fontSize: '14px' }}>
                  Permission Used — {permUsedRecs.length} day(s)
                </span>
              </div>
              {permUsedRecs.map(r => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', padding: '5px 0',
                  borderTop: '1px solid #fed7aa', fontSize: '13px' }}>
                  <span>{format(parseISO(r.date), 'EEE, dd MMM')} — <StatusBadge status={r.status} /></span>
                  <span style={{ color: '#c2410c', fontWeight: 700 }}>−{r.permMins} min</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px',
                paddingTop: '8px', borderTop: '2px solid #f97316', fontWeight: 700, fontSize: '13px' }}>
                <span>Balance Remaining:</span>
                <PermDisplay left={bal.left} />
              </div>
              {bal.left < 0 && (
                <div style={{ marginTop: '8px', background: '#fef3c7', borderRadius: '6px',
                  padding: '6px 10px', fontSize: '12px', color: '#92400e', fontWeight: 600 }}>
                  🟡 {Math.abs(bal.left)} min over limit — tracked as excess (no automatic penalty)
                </div>
              )}
            </div>
          )}

          {leavesUsed > MAX_LEAVES && (
            <div style={{ background: '#fef3c7', border: '2px solid #f59e0b', borderRadius: '8px',
              padding: '10px 14px', marginBottom: '1rem', fontSize: '13px',
              color: '#92400e', fontWeight: 600 }}>
              ⚠️ Leave Limit Reached! Used {leavesUsed}/{MAX_LEAVES} — Over by <strong>{leavesUsed - MAX_LEAVES} day(s)</strong>
              <div style={{ fontSize: '11px', fontWeight: 400, marginTop: '3px', color: '#b45309' }}>
                Leave = Absent days + Half days (×0.5). Permission does not count as leave.
              </div>
            </div>
          )}

          {isEmployeeView && (
            <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px',
              padding: '7px 12px', marginBottom: '1rem', fontSize: '12px', color: '#0369a1' }}>
              💡 You can only mark or update attendance for <strong>today</strong>. Contact admin to change past records.
            </div>
          )}

          <div className="card">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)',
              gap: '3px', marginBottom: '6px', textAlign: 'center' }}>
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                <div key={d} style={{ fontSize: '11px', fontWeight: '600',
                  color: '#6b7280', padding: '3px' }}>{d}</div>
              ))}
            </div>
            <div className="calendar-grid">
              {blanks.map((_, i) => <div key={`b${i}`} className="cal-day empty" />)}
              {days.map(day => {
                const ds  = format(day, 'yyyy-MM-dd');
                const rec = byDate[ds];
                const sun = isSunday(day);
                const isFuture = ds > todayStr();
                const cal = rec ? CAL_COLORS[rec.status] : null;
                const clickable = isEmployeeView ? ds === todayStr() : !isFuture;
                const hasPerm = rec && PERM_STATUSES.includes(rec.status) && rec.permMins > 0;
                return (
                  <div key={ds}
                    className={`cal-day${isToday(day) ? ' today' : ''}${sun ? ' sunday' : ''}`}
                    onClick={() => clickable && handleDayClick(day)}
                    style={{
                      position: 'relative',
                      background: cal ? cal.bg : undefined,
                      color: cal ? cal.color : undefined,
                      border: cal ? (isToday(day) ? '2px solid #1a56db' : '1px solid transparent') : undefined,
                      cursor: clickable ? 'pointer' : undefined,
                    }}
                    title={rec
                      ? ((BADGE_MAP[rec.status]?.label || '') + (rec.permMins ? ' (' + rec.permMins + 'm)' : ''))
                      : 'Click to mark'}>
                    <div>{format(day, 'd')}</div>
                    {cal && <div style={{ fontSize: '6px', lineHeight: 1, fontWeight: 700 }}>{cal.label}</div>}
                    {hasPerm && (
                      <div style={{ position: 'absolute', top: '1px', right: '2px',
                        fontSize: '8px', color: '#f97316', fontWeight: 900, lineHeight: 1 }}>●</div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
              {Object.entries(CAL_COLORS).map(([key, { bg, color }]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '2px',
                    background: bg, border: `1px solid ${color}44`,
                    display: 'inline-block', flexShrink: 0 }} />
                  <span style={{ color: '#6b7280' }}>{BADGE_MAP[key]?.label || key}</span>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px' }}>
                <span style={{ color: '#f97316', fontWeight: 900 }}>●</span>
                <span style={{ color: '#6b7280' }}>Perm used</span>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: '1rem' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '0.75rem' }}>Attendance Details</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Status</th><th>Shift</th><th>Perm</th><th>Note</th></tr></thead>
                <tbody>
                  {empRecs.sort((a, b) => a.date.localeCompare(b.date)).map(r => (
                    <tr key={r.id}>
                      <td style={{ fontSize: '12px' }}>{format(parseISO(r.date), 'EEE dd MMM')}</td>
                      <td><StatusBadge status={r.status} /></td>
                      <td style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>
                        <ShiftBadge shiftId={r.shiftId || emp.shiftId} />
                        {r.shiftOverridden && (
                          <span style={{ display: 'block', fontSize: '10px',
                            color: '#c2410c', fontWeight: 600, marginTop: '2px' }}>
                            ↑ override
                          </span>
                        )}
                      </td>
                      <td style={{ fontSize: '12px' }}>
                        {PERM_STATUSES.includes(r.status) && r.permMins
                          ? <span style={{ color: '#f97316', fontWeight: 600 }}>−{r.permMins}m</span>
                          : '—'}
                      </td>
                      <td style={{ color: '#6b7280', fontSize: '12px' }}>{r.note || '—'}</td>
                    </tr>
                  ))}
                  {empRecs.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', color: '#6b7280' }}>No records</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!selEmp && !isEmployeeView && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>
          Select an employee above to view their calendar
        </div>
      )}

      {markEmp && markDate && (
        <AttendanceModal emp={markEmp} existing={byDate[markDate]}
          selectedDate={markDate}
          onSave={() => { setMarkEmp(null); setMarkDate(null); onRefresh(); }}
          onClose={() => { setMarkEmp(null); setMarkDate(null); }} />
      )}
    </div>
  );
}

// ─── Alerts Tab ────────────────────────────────────────────────────────────

function AlertsTab({ employees, records }) {
  const mo       = monthStr();
  const overList = getOverLimitEmployees(employees, records, mo);

  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '0.25rem' }}>Over-Limit Alerts</h1>
      <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '1rem' }}>
        {format(new Date(), 'MMMM yyyy')}
      </p>

      {/* Legend */}
      <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '8px',
        padding: '10px 14px', marginBottom: '1rem', fontSize: '12px', color: '#374151' }}>
        <strong>How leaves are counted:</strong> Absent = 1 leave · Half day = 0.5 leave · Permission = 0 leave (tracked separately)
      </div>

      {overList.length === 0 ? (
        <div style={{ background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: '10px',
          padding: '2rem', textAlign: 'center', color: '#065f46', fontSize: '15px', fontWeight: 600 }}>
          ✅ All employees are within limits this month!
        </div>
      ) : (
        <>
          <div style={{ marginBottom: '1rem', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px',
              padding: '10px 16px', fontSize: '13px', color: '#92400e', fontWeight: 700 }}>
              ⚠️ {overList.filter(x => x.overLeave).length} employees over leave limit
            </div>
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px',
              padding: '10px 16px', fontSize: '13px', color: '#c2410c', fontWeight: 700 }}>
              🟡 {overList.filter(x => x.overPerm).length} employees over permission limit
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {overList.map(({ emp, leaves, bal, overLeave, overLeaveBy, overPerm, overPermBy }) => {
              const empRecs = records.filter(r => r.empId === emp.id && r.date.startsWith(mo));
              const absent  = empRecs.filter(r => r.status === STATUS.ABSENT).length;
              const half    = empRecs.filter(r => HALF_STATUSES.includes(r.status)).length;
              return (
                <div key={emp.id} style={{ background: 'white', border: '2px solid #f59e0b',
                  borderRadius: '12px', padding: '1rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '15px' }}>{emp.name}</div>
                      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                        {emp.designation || '—'} · <ShiftBadge shiftId={emp.shiftId} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {overLeave && (
                        <span style={{ background: '#fef3c7', color: '#92400e', fontWeight: 700,
                          fontSize: '12px', padding: '4px 10px', borderRadius: '20px',
                          border: '1px solid #f59e0b' }}>
                          ⚠️ +{overLeaveBy} Extra Leave{overLeaveBy > 1 ? 's' : ''}
                        </span>
                      )}
                      {overPerm && (
                        <span style={{ background: '#fff7ed', color: '#c2410c', fontWeight: 700,
                          fontSize: '12px', padding: '4px 10px', borderRadius: '20px',
                          border: '1px solid #fed7aa' }}>
                          🟡 +{overPermBy} min Excess
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))',
                    gap: '8px', marginTop: '12px' }}>
                    <div style={{ background: '#f9fafb', borderRadius: '8px', padding: '8px 10px' }}>
                      <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px',
                        fontWeight: 600, textTransform: 'uppercase' }}>Leave Breakdown</div>
                      <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span>Absent: <strong>{absent}</strong> day(s)</span>
                        <span>Half Day: <strong>{half}</strong> (={half * 0.5} leave)</span>
                        <div style={{ borderTop: '1px solid #e5e7eb', marginTop: '4px', paddingTop: '4px',
                          fontWeight: 700, color: overLeave ? '#d97706' : '#374151' }}>
                          Total: {leaves}/{MAX_LEAVES} {overLeave && `(+${overLeaveBy} over)`}
                        </div>
                      </div>
                    </div>
                    <div style={{ background: '#f9fafb', borderRadius: '8px', padding: '8px 10px' }}>
                      <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px',
                        fontWeight: 600, textTransform: 'uppercase' }}>Permission Breakdown</div>
                      <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span>Perm used: <strong>{bal.permUsed} min</strong></span>
                        <span>Limit: <strong>{MAX_PERMISSION_MINS} min</strong></span>
                        <div style={{ borderTop: '1px solid #e5e7eb', marginTop: '4px', paddingTop: '4px',
                          fontWeight: 700, color: overPerm ? '#d97706' : '#0e9f6e' }}>
                          Balance: <PermDisplay left={bal.left} />
                          {overPerm && <span style={{ color: '#d97706' }}> (+{overPermBy}m excess)</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Report Tab ────────────────────────────────────────────────────────────

function ReportTab({ employees, records, onRefresh, isEmployee = false }) {
  const [reportMonth, setReportMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [deleting, setDeleting]       = useState(false);
  const mo     = reportMonth;
  const moRecs = records.filter(r => r.date.startsWith(mo));
  const summary = employees.map(emp => {
    const recs    = moRecs.filter(r => r.empId === emp.id);
    const present = recs.filter(r => [STATUS.PRESENT, STATUS.PRESENT_PERMISSION].includes(r.status)).length;
    const halfDay = recs.filter(r => HALF_STATUSES.includes(r.status)).length;
    const absent  = recs.filter(r => r.status === STATUS.ABSENT).length;
    const perm    = recs.filter(r => PERM_STATUSES.includes(r.status)).length;
    const bal     = getPermBalance(emp.id, mo, records);
    const leavesUsed = getLeaveCount(recs);
    return { emp, present, halfDay, absent, perm, bal, leavesUsed };
  });

  async function handleDownloadAndDelete() {
    if (!confirm(`Download report for ${mo} and DELETE all data for that month?`)) return;
    exportCSV(employees, records, mo);
    setDeleting(true);
    try {
      const batch = writeBatch(db);
      moRecs.forEach(r => batch.delete(doc(db, 'attendance', r.id)));
      await batch.commit();
      alert(`✅ Report downloaded and ${moRecs.length} records deleted`);
      onRefresh();
    } catch (e) { alert('Error: ' + e.message); }
    setDeleting(false);
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '1rem', flexWrap: 'wrap', gap: '8px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700' }}>
          {isEmployee ? 'My Report' : 'Monthly Report'}
        </h1>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <input type="month" value={reportMonth}
            onChange={e => setReportMonth(e.target.value)} style={{ width: '150px' }} />
          <button className="btn btn-outline"
            onClick={() => exportCSV(employees, records, mo)}>⬇ CSV</button>
          {!isEmployee && (
            <button className="btn btn-danger"
              onClick={handleDownloadAndDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : '⬇ CSV + Delete'}
            </button>
          )}
        </div>
      </div>
      {!isEmployee && (
        <div className="alert alert-warning" style={{ fontSize: '13px' }}>
          ⚠️ "CSV + Delete" exports then permanently deletes that month's data. Admin only.
        </div>
      )}

      {/* Leave formula notice */}
      <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px',
        padding: '8px 14px', marginBottom: '1rem', fontSize: '12px', color: '#0369a1' }}>
        📌 <strong>Leave formula:</strong> Absent (×1) + Half Day (×0.5) = Leave count &nbsp;·&nbsp;
        Permission minutes are tracked separately and do <strong>not</strong> count as leaves.
      </div>

      {!isEmployee && (() => {
        const overList = getOverLimitEmployees(employees, records, mo);
        if (!overList.length) return null;
        return (
          <div style={{ background: '#fff7ed', border: '2px solid #f97316', borderRadius: '10px',
            padding: '12px 14px', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, color: '#c2410c', fontSize: '14px', marginBottom: '8px' }}>
              ⚠️ {overList.length} employee(s) over limit in {mo}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {overList.map(({ emp, leaves, bal, overLeave, overLeaveBy, overPerm, overPermBy }) => (
                <div key={emp.id} style={{ display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', fontSize: '13px', flexWrap: 'wrap', gap: '4px' }}>
                  <span style={{ fontWeight: 600 }}>{emp.name}</span>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {overLeave && <span style={{ color: '#d97706', fontWeight: 700 }}>⚠️ +{overLeaveBy} leave</span>}
                    {overPerm  && <span style={{ color: '#c2410c', fontWeight: 700 }}>🟡 +{overPermBy}min excess perm</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>#</th><th>Employee</th><th>Shift</th><th>P</th><th>H</th>
              <th>A</th><th>Pm Days</th><th>Perm Used</th>
              <th>Perm Left</th><th>Excess Perm</th><th>Leaves</th><th>Status</th>
            </tr></thead>
            <tbody>
              {summary.map(({ emp, present, halfDay, absent, perm, bal, leavesUsed }, i) => {
                const overL = leavesUsed > MAX_LEAVES;
                const overP = bal.left < 0;
                return (
                  <tr key={emp.id} style={{ background: overL || overP ? '#fffbeb' : '' }}>
                    <td style={{ color: '#6b7280' }}>{i + 1}</td>
                    <td style={{ fontWeight: 600, fontSize: '13px' }}>
                      {emp.name}
                      {(overL || overP) && <span style={{ color: '#d97706', marginLeft: '3px' }}>⚠️</span>}
                    </td>
                    <td><ShiftBadge shiftId={emp.shiftId} /></td>
                    <td style={{ color: '#0e9f6e', fontWeight: 600 }}>{present}</td>
                    <td style={{ color: '#1e40af', fontWeight: 600 }}>{halfDay}</td>
                    <td style={{ color: '#e02424', fontWeight: 600 }}>{absent}</td>
                    <td style={{ color: '#0891b2', fontWeight: 600 }}>{perm}</td>
                    <td style={{ fontSize: '12px' }}>{bal.permUsed}m</td>
                    <td><PermDisplay left={bal.left} /></td>
                    <td style={{ fontSize: '12px', color: overP ? '#d97706' : '#9ca3af', fontWeight: overP ? 700 : 400 }}>
                      {overP ? `+${bal.overBy}m` : '—'}
                    </td>
                    <td style={{ color: overL ? '#d97706' : '#374151',
                      fontWeight: overL ? 700 : 400, fontSize: '12px' }}>
                      {leavesUsed}/{MAX_LEAVES}
                      {overL && <span style={{ color: '#d97706', fontWeight: 700 }}> +{leavesUsed - MAX_LEAVES}⚠️</span>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {overL
                          ? <span className="badge badge-absent" style={{ fontSize: '10px' }}>Leave Over</span>
                          : <span className="badge badge-present" style={{ fontSize: '10px' }}>Leave OK</span>}
                        {overP
                          ? <span style={{ fontSize: '10px', background: '#fef3c7', color: '#92400e',
                              padding: '2px 6px', borderRadius: '10px', fontWeight: 700 }}>Perm Excess</span>
                          : <span className="badge badge-present" style={{ fontSize: '10px' }}>Perm OK</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {employees.length === 0 && (
                <tr><td colSpan={13} style={{ textAlign: 'center', color: '#6b7280',
                  padding: '2rem' }}>No records</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


// ─── Toast Helper ──────────────────────────────────────────────────────────

function useToast() {
  const [toast, setToast] = useState(null);
  function show(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }
  return { toast, show };
}

function Toast({ toast }) {
  if (!toast) return null;
  const colors = {
    success: { bg: '#d1fae5', border: '#6ee7b7', text: '#065f46' },
    error:   { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b' },
    info:    { bg: '#e0f2fe', border: '#7dd3fc', text: '#0c4a6e' },
  };
  const c = colors[toast.type] || colors.info;
  return (
    <div style={{
      position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999,
      background: c.bg, border: `1px solid ${c.border}`, borderRadius: '10px',
      padding: '12px 18px', fontSize: '13px', fontWeight: 600, color: c.text,
      boxShadow: '0 4px 20px rgba(0,0,0,0.12)', maxWidth: '320px'
    }}>
      {toast.msg}
    </div>
  );
}

// ─── Maintenance: Section Accordion ───────────────────────────────────────

function MaintSection({ icon, title, subtitle, badge, badgeColor = '#1a56db', children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: '14px',
      overflow: 'hidden', marginBottom: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center',
          gap: '12px', background: open ? '#f8faff' : '#fff', border: 'none',
          borderBottom: open ? '1px solid #e5e7eb' : 'none', cursor: 'pointer', textAlign: 'left'
        }}
      >
        <span style={{ fontSize: '22px', flexShrink: 0 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '14px', color: '#111827' }}>{title}</div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '1px' }}>{subtitle}</div>
        </div>
        {badge && (
          <span style={{
            fontSize: '11px', fontWeight: 700, padding: '3px 10px',
            borderRadius: '20px', background: badgeColor + '18',
            color: badgeColor, border: `1px solid ${badgeColor}33`, flexShrink: 0
          }}>{badge}</span>
        )}
        <span style={{
          fontSize: '18px', color: '#9ca3af', flexShrink: 0,
          display: 'inline-block', transition: 'transform 0.2s',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)'
        }}>⌄</span>
      </button>
      {open && <div style={{ padding: '1.25rem' }}>{children}</div>}
    </div>
  );
}

// ─── Maintenance: Inline Employee Row ─────────────────────────────────────

function MaintEmpRow({ emp, passwords, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [form, setForm]       = useState({
    name: emp.name, designation: emp.designation || '',
    phone: emp.phone || '', shiftId: emp.shiftId || 'A',
    password: passwords[emp.id] || ''
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function save() {
    if (!form.name.trim()) return alert('Name is required');
    setSaving(true);
    await setDoc(doc(db, 'employees', emp.id), {
      ...emp, name: form.name.trim(), designation: form.designation.trim(),
      phone: form.phone.trim(), shiftId: form.shiftId
    });
    await setDoc(doc(db, 'config', 'passwords'),
      { employees: { [emp.id]: form.password } }, { merge: true });
    setSaving(false);
    setEditing(false);
    onSave();
  }

  const shiftColors = { A: '#1a56db', B: '#0891b2', C: '#7c3aed' };
  const shift = getShift(emp.shiftId);

  if (!editing) return (
    <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
      <td style={{ padding: '10px 8px', fontSize: '13px', fontWeight: 600, color: '#111827' }}>
        {emp.name}
        {emp.selfRegistered && (
          <span style={{ marginLeft: '5px', fontSize: '10px', background: '#e0f2fe',
            color: '#0891b2', padding: '1px 6px', borderRadius: '10px', fontWeight: 700 }}>NEW</span>
        )}
      </td>
      <td style={{ padding: '10px 8px', fontSize: '12px', color: '#6b7280' }}>{emp.designation || '—'}</td>
      <td style={{ padding: '10px 8px', fontSize: '12px', color: '#6b7280' }}>{emp.phone || '—'}</td>
      <td style={{ padding: '10px 8px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px',
          background: (shiftColors[emp.shiftId || 'A']) + '18',
          color: shiftColors[emp.shiftId || 'A'] }}>
          {shift?.label}
        </span>
      </td>
      <td style={{ padding: '10px 8px', fontSize: '12px', color: '#9ca3af', fontFamily: 'monospace' }}>
        {'•'.repeat(Math.min(passwords[emp.id]?.length || 0, 8))}
      </td>
      <td style={{ padding: '10px 8px' }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button onClick={() => setEditing(true)}
            style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600,
              background: '#eff6ff', color: '#1a56db', border: '1px solid #bfdbfe',
              borderRadius: '6px', cursor: 'pointer' }}>Edit</button>
          <button onClick={() => onDelete(emp)}
            style={{ padding: '4px 8px', fontSize: '11px', fontWeight: 600,
              background: '#fff5f5', color: '#e02424', border: '1px solid #fecaca',
              borderRadius: '6px', cursor: 'pointer' }}>Del</button>
        </div>
      </td>
    </tr>
  );

  return (
    <tr style={{ background: '#f0f9ff', borderBottom: '1px solid #bae6fd' }}>
      <td style={{ padding: '8px' }}>
        <input value={form.name} onChange={e => set('name', e.target.value)}
          style={{ width: '100%', padding: '5px 8px', border: '1.5px solid #0891b2',
            borderRadius: '6px', fontSize: '12px', outline: 'none', boxSizing: 'border-box' }} />
      </td>
      <td style={{ padding: '8px' }}>
        <input value={form.designation} onChange={e => set('designation', e.target.value)}
          placeholder="Designation"
          style={{ width: '100%', padding: '5px 8px', border: '1px solid #d1d5db',
            borderRadius: '6px', fontSize: '12px', outline: 'none', boxSizing: 'border-box' }} />
      </td>
      <td style={{ padding: '8px' }}>
        <input value={form.phone} onChange={e => set('phone', e.target.value)}
          placeholder="Phone"
          style={{ width: '100%', padding: '5px 8px', border: '1px solid #d1d5db',
            borderRadius: '6px', fontSize: '12px', outline: 'none', boxSizing: 'border-box' }} />
      </td>
      <td style={{ padding: '8px' }}>
        <select value={form.shiftId} onChange={e => set('shiftId', e.target.value)}
          style={{ width: '100%', padding: '5px 6px', border: '1px solid #d1d5db',
            borderRadius: '6px', fontSize: '12px', outline: 'none' }}>
          {SHIFTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </td>
      <td style={{ padding: '8px' }}>
        <input value={form.password} onChange={e => set('password', e.target.value)}
          placeholder="New password"
          style={{ width: '100%', padding: '5px 8px', border: '1px solid #d1d5db',
            borderRadius: '6px', fontSize: '12px', outline: 'none', boxSizing: 'border-box' }} />
      </td>
      <td style={{ padding: '8px' }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button onClick={save} disabled={saving}
            style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 700,
              background: '#0891b2', color: '#fff', border: 'none',
              borderRadius: '6px', cursor: 'pointer' }}>{saving ? '…' : '✓'}</button>
          <button onClick={() => setEditing(false)}
            style={{ padding: '4px 8px', fontSize: '11px',
              background: '#fff', color: '#6b7280', border: '1px solid #d1d5db',
              borderRadius: '6px', cursor: 'pointer' }}>✕</button>
        </div>
      </td>
    </tr>
  );
}

// ─── Maintenance: Bulk Shift Modal ─────────────────────────────────────────

function BulkShiftModal({ employees, onDone, onClose }) {
  const [from, setFrom]     = useState('A');
  const [to, setTo]         = useState('B');
  const [saving, setSaving] = useState(false);
  const affected = employees.filter(e => (e.shiftId || 'A') === from);

  async function apply() {
    if (from === to) return alert('Source and target shifts must differ');
    if (!affected.length) return alert('No employees in that shift');
    if (!confirm(`Move ${affected.length} employees from Shift ${from} → Shift ${to}?`)) return;
    setSaving(true);
    const batch = writeBatch(db);
    affected.forEach(e => batch.update(doc(db, 'employees', e.id), { shiftId: to }));
    await batch.commit();
    setSaving(false);
    onDone();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem',
        width: '100%', maxWidth: '380px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>Bulk Shift Reassign</h2>
        <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '1.25rem' }}>
          Move all employees from one shift to another at once.
        </p>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151',
              display: 'block', marginBottom: '4px' }}>From Shift</label>
            <select value={from} onChange={e => setFrom(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #d1d5db',
                borderRadius: '8px', fontSize: '13px', outline: 'none' }}>
              {SHIFTS.map(s => <option key={s.id} value={s.id}>{s.label} ({s.display})</option>)}
            </select>
          </div>
          <span style={{ fontSize: '20px', marginTop: '16px' }}>→</span>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151',
              display: 'block', marginBottom: '4px' }}>To Shift</label>
            <select value={to} onChange={e => setTo(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #d1d5db',
                borderRadius: '8px', fontSize: '13px', outline: 'none' }}>
              {SHIFTS.map(s => <option key={s.id} value={s.id}>{s.label} ({s.display})</option>)}
            </select>
          </div>
        </div>
        {affected.length > 0 ? (
          <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px',
            padding: '10px 12px', marginBottom: '1rem', fontSize: '12px', color: '#92400e' }}>
            <strong>{affected.length} employee(s)</strong> will be moved:{' '}
            {affected.map(e => e.name).join(', ')}
          </div>
        ) : (
          <div style={{ background: '#f3f4f6', borderRadius: '8px', padding: '10px 12px',
            marginBottom: '1rem', fontSize: '12px', color: '#6b7280' }}>
            No employees in Shift {from} currently.
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose}
            style={{ padding: '9px 16px', background: '#fff', color: '#374151',
              border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
          <button onClick={apply} disabled={saving || !affected.length}
            style={{ padding: '9px 16px',
              background: saving || !affected.length ? '#9ca3af' : '#1a56db',
              color: '#fff', border: 'none', borderRadius: '8px',
              fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            {saving ? 'Applying…' : `Move ${affected.length} Employee(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Maintenance: CSV Import Modal ─────────────────────────────────────────

function ImportModal({ existingEmployees, onDone, onClose }) {
  const [step, setStep]       = useState('upload');
  const [rows, setRows]       = useState([]);
  const [saving, setSaving]   = useState(false);
  const [results, setResults] = useState(null);
  const fileRef               = useRef(null);

  function parseCSV(text) {
    const lines = text.trim().split('\n').filter(Boolean);
    if (!lines.length) return [];
    const header = lines[0].toLowerCase().replace(/\s/g, '');
    if (!header.includes('name')) {
      alert('CSV must have headers: Name, Designation, Phone, Shift, Password');
      return [];
    }
    return lines.slice(1).map((line, idx) => {
      const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      return {
        _row: idx + 2,
        name:        cols[0] || '',
        designation: cols[1] || '',
        phone:       cols[2] || '',
        shiftId:     ['A','B','C'].includes((cols[3]||'A').toUpperCase()) ? (cols[3]||'A').toUpperCase() : 'A',
        password:    cols[4] || 'pass1234',
        _exists:     existingEmployees.some(e => e.name.toLowerCase().trim() === (cols[0]||'').toLowerCase().trim()),
        _valid:      (cols[0]||'').trim().length > 0,
      };
    }).filter(r => r._valid);
  }

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const parsed = parseCSV(e.target.result);
      setRows(parsed);
      if (parsed.length) setStep('preview');
    };
    reader.readAsText(file);
  }

  async function importRows() {
    const toImport = rows.filter(r => !r._exists);
    if (!toImport.length) return alert('No new employees to import');
    setSaving(true);
    let imported = 0, failed = 0;
    for (const row of toImport) {
      try {
        const id = `emp_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
        await setDoc(doc(db, 'employees', id), {
          id, name: row.name, designation: row.designation,
          phone: row.phone, shiftId: row.shiftId, createdAt: Date.now()
        });
        await setDoc(doc(db, 'config', 'passwords'),
          { employees: { [id]: row.password } }, { merge: true });
        imported++;
      } catch { failed++; }
    }
    setResults({ imported, failed, skipped: rows.filter(r => r._exists).length });
    setStep('done');
    setSaving(false);
    onDone();
  }

  function downloadTemplate() {
    const csv = 'Name,Designation,Phone,Shift,Password\nRajan Kumar,Sales Executive,9876543210,A,rajan2024\nPriya Sharma,Account Manager,9123456789,B,priya2024\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'employee_import_template.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem',
        width: '100%', maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>Bulk Import Employees</h2>
        <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '1.25rem' }}>
          Upload a CSV file to add multiple employees at once.
        </p>

        {step === 'upload' && (
          <>
            <div style={{ background: '#f8fafc', border: '2px dashed #cbd5e1', borderRadius: '12px',
              padding: '2rem', textAlign: 'center', marginBottom: '1rem', cursor: 'pointer' }}
              onClick={() => fileRef.current?.click()}>
              <div style={{ fontSize: '36px', marginBottom: '8px' }}>📂</div>
              <p style={{ fontWeight: 600, fontSize: '14px', color: '#374151', marginBottom: '4px' }}>
                Click to select CSV file
              </p>
              <p style={{ fontSize: '12px', color: '#9ca3af' }}>
                Format: Name, Designation, Phone, Shift (A/B/C), Password
              </p>
              <input ref={fileRef} type="file" accept=".csv"
                onChange={e => handleFile(e.target.files[0])} style={{ display: 'none' }} />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={downloadTemplate}
                style={{ flex: 1, padding: '9px', background: '#f0f9ff', color: '#0891b2',
                  border: '1px solid #bae6fd', borderRadius: '8px',
                  fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                ⬇ Download Template CSV
              </button>
              <button onClick={onClose}
                style={{ padding: '9px 16px', background: '#fff', color: '#374151',
                  border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
            </div>
          </>
        )}

        {step === 'preview' && (
          <>
            <div style={{ marginBottom: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '12px', background: '#d1fae5', color: '#065f46',
                padding: '3px 10px', borderRadius: '20px', fontWeight: 700 }}>
                ✓ {rows.filter(r => !r._exists).length} new
              </span>
              {rows.filter(r => r._exists).length > 0 && (
                <span style={{ fontSize: '12px', background: '#fef3c7', color: '#92400e',
                  padding: '3px 10px', borderRadius: '20px', fontWeight: 700 }}>
                  ⚠ {rows.filter(r => r._exists).length} will be skipped (name exists)
                </span>
              )}
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden',
              marginBottom: '1rem', maxHeight: '280px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    {['Name','Designation','Phone','Shift','Password','Status'].map(h => (
                      <th key={h} style={{ padding: '7px 10px', textAlign: 'left',
                        fontWeight: 700, color: '#374151', borderBottom: '1px solid #e5e7eb',
                        fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} style={{ background: r._exists ? '#fffbeb' : '#fff',
                      borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '7px 10px', fontWeight: 600 }}>{r.name}</td>
                      <td style={{ padding: '7px 10px', color: '#6b7280' }}>{r.designation || '—'}</td>
                      <td style={{ padding: '7px 10px', color: '#6b7280' }}>{r.phone || '—'}</td>
                      <td style={{ padding: '7px 10px' }}>
                        <span style={{ fontWeight: 700, fontSize: '11px', padding: '2px 6px',
                          borderRadius: '10px', background: '#e0f2fe', color: '#0891b2' }}>
                          Shift {r.shiftId}
                        </span>
                      </td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: '#9ca3af', fontSize: '11px' }}>
                        {'•'.repeat(Math.min(r.password.length, 8))}
                      </td>
                      <td style={{ padding: '7px 10px' }}>
                        {r._exists
                          ? <span style={{ fontSize: '10px', color: '#d97706', fontWeight: 700 }}>SKIP</span>
                          : <span style={{ fontSize: '10px', color: '#0e9f6e', fontWeight: 700 }}>NEW</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => { setStep('upload'); setRows([]); }}
                style={{ padding: '9px 14px', background: '#fff', color: '#374151',
                  border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>← Back</button>
              <button onClick={importRows} disabled={saving || !rows.filter(r => !r._exists).length}
                style={{ padding: '9px 16px', fontWeight: 600,
                  background: saving ? '#9ca3af' : '#0891b2', color: '#fff',
                  border: 'none', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>
                {saving ? 'Importing…' : `✅ Import ${rows.filter(r => !r._exists).length} Employees`}
              </button>
            </div>
          </>
        )}

        {step === 'done' && results && (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🎉</div>
            <h3 style={{ fontWeight: 700, fontSize: '16px', marginBottom: '16px' }}>Import Complete</h3>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center',
              marginBottom: '20px', flexWrap: 'wrap' }}>
              <div style={{ background: '#d1fae5', borderRadius: '10px', padding: '12px 20px' }}>
                <div style={{ fontWeight: 800, fontSize: '22px', color: '#065f46' }}>{results.imported}</div>
                <div style={{ fontSize: '11px', color: '#065f46', fontWeight: 600 }}>Imported</div>
              </div>
              <div style={{ background: '#fef3c7', borderRadius: '10px', padding: '12px 20px' }}>
                <div style={{ fontWeight: 800, fontSize: '22px', color: '#92400e' }}>{results.skipped}</div>
                <div style={{ fontSize: '11px', color: '#92400e', fontWeight: 600 }}>Skipped</div>
              </div>
              {results.failed > 0 && (
                <div style={{ background: '#fee2e2', borderRadius: '10px', padding: '12px 20px' }}>
                  <div style={{ fontWeight: 800, fontSize: '22px', color: '#991b1b' }}>{results.failed}</div>
                  <div style={{ fontSize: '11px', color: '#991b1b', fontWeight: 600 }}>Failed</div>
                </div>
              )}
            </div>
            <button onClick={onClose}
              style={{ padding: '10px 28px', background: '#0891b2', color: '#fff',
                border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Maintenance Tab ────────────────────────────────────────────────────────

function MaintenanceTab({ employees, records, onRefresh }) {
  const toast = useToast();
  const [passwords, setPasswords]         = useState({});
  const [loadingPw, setLoadingPw]         = useState(true);
  const [showBulkShift, setShowBulkShift] = useState(false);
  const [showImport, setShowImport]       = useState(false);
  const [search, setSearch]               = useState('');
  const [adminPwForm, setAdminPwForm]     = useState({ current: '', next: '', confirm: '' });
  const [adminPwSaving, setAdminPwSaving] = useState(false);
  const [cleanMonth, setCleanMonth]       = useState(format(new Date(), 'yyyy-MM'));
  const [deleting, setDeleting]           = useState(false);

  useEffect(() => {
    getDoc(doc(db, 'config', 'passwords')).then(snap => {
      if (snap.exists()) setPasswords(snap.data().employees || {});
      setLoadingPw(false);
    }).catch(() => setLoadingPw(false));
  }, []);

  async function reloadPasswords() {
    const snap = await getDoc(doc(db, 'config', 'passwords'));
    if (snap.exists()) setPasswords(snap.data().employees || {});
  }

  function exportAllEmployees() {
    const header = 'ID,Name,Designation,Phone,Shift,Self Registered,Created At\n';
    const rows   = employees.map(e =>
      `${e.id},${e.name},${e.designation||''},${e.phone||''},${e.shiftId||'A'},${e.selfRegistered?'Yes':'No'},${new Date(e.createdAt||0).toLocaleDateString()}`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'employees_export.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  async function handleAdminPwSave() {
    const { current, next, confirm: confirmPw } = adminPwForm;
    if (!current || !next || !confirmPw) return alert('All fields required');
    if (next.length < 6) return alert('New password must be at least 6 characters');
    if (next !== confirmPw) return alert('Passwords do not match');
    setAdminPwSaving(true);
    try {
      const snap = await getDoc(doc(db, 'config', 'passwords'));
      const stored = snap.exists() ? (snap.data().admin || 'admin123') : 'admin123';
      if (current !== stored) { alert('Current password is incorrect'); setAdminPwSaving(false); return; }
      await setDoc(doc(db, 'config', 'passwords'), { admin: next }, { merge: true });
      setAdminPwForm({ current: '', next: '', confirm: '' });
      toast.show('✅ Admin password updated successfully');
    } catch (e) { alert('Error: ' + e.message); }
    setAdminPwSaving(false);
  }

  async function handleDeleteMonthRecords() {
    const moRecs = records.filter(r => r.date.startsWith(cleanMonth));
    if (!moRecs.length) return alert('No records found for that month');
    if (!confirm(`Permanently delete ALL ${moRecs.length} attendance records for ${cleanMonth}?`)) return;
    setDeleting(true);
    try {
      const batch = writeBatch(db);
      moRecs.forEach(r => batch.delete(doc(db, 'attendance', r.id)));
      await batch.commit();
      toast.show(`🗑️ Deleted ${moRecs.length} records for ${cleanMonth}`);
      onRefresh();
    } catch (e) { alert('Error: ' + e.message); }
    setDeleting(false);
  }

  async function handleDeleteEmployee(emp) {
    if (!confirm(`Delete ${emp.name} and all their attendance records? This is permanent.`)) return;
    try {
      const empRecs = records.filter(r => r.empId === emp.id);
      const batch = writeBatch(db);
      batch.delete(doc(db, 'employees', emp.id));
      empRecs.forEach(r => batch.delete(doc(db, 'attendance', r.id)));
      await batch.commit();
      toast.show(`🗑️ Deleted ${emp.name} and ${empRecs.length} records`);
      onRefresh();
    } catch (e) { alert('Error: ' + e.message); }
  }

  const filtered = employees.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    (e.designation || '').toLowerCase().includes(search.toLowerCase())
  );

  const months = [...new Set(records.map(r => r.date.slice(0,7)))].sort().reverse();
  const cleanMonthRecs = records.filter(r => r.date.startsWith(cleanMonth));
  const selfRegCount = employees.filter(e => e.selfRegistered).length;

  return (
    <div>
      <Toast toast={toast.toast} />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        marginBottom: '1.25rem', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#111827', marginBottom: '2px' }}>
            ⚙️ Maintenance
          </h1>
          <p style={{ fontSize: '13px', color: '#6b7280' }}>
            Manage employees, bulk operations, passwords, and system data.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button onClick={() => setShowImport(true)}
            style={{ padding: '8px 14px', fontWeight: 600, fontSize: '12px',
              background: '#d1fae5', color: '#065f46', border: '1px solid #6ee7b7',
              borderRadius: '8px', cursor: 'pointer' }}>⬆ Bulk Import</button>
          <button onClick={exportAllEmployees}
            style={{ padding: '8px 14px', fontWeight: 600, fontSize: '12px',
              background: '#e0f2fe', color: '#0369a1', border: '1px solid #7dd3fc',
              borderRadius: '8px', cursor: 'pointer' }}>⬇ Export Employees</button>
          <button onClick={() => setShowBulkShift(true)}
            style={{ padding: '8px 14px', fontWeight: 600, fontSize: '12px',
              background: '#ede9fe', color: '#5b21b6', border: '1px solid #c4b5fd',
              borderRadius: '8px', cursor: 'pointer' }}>🔄 Bulk Shift Change</button>
        </div>
      </div>

      <MaintSection icon="📊" title="System Overview" subtitle="Quick stats about your data"
        badge={`${employees.length} employees`} badgeColor="#0891b2" defaultOpen={true}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '10px', marginBottom: '4px' }}>
          {[
            { label: 'Total Employees', value: employees.length, color: '#1a56db', icon: '👥' },
            { label: 'Total Records',   value: records.length,   color: '#0891b2', icon: '📋' },
            { label: 'Months of Data',  value: months.length,    color: '#7c3aed', icon: '📅' },
            { label: 'Self-Registered', value: selfRegCount,     color: '#0e9f6e', icon: '🆕' },
            ...SHIFTS.map(s => ({
              label: s.label, icon: '⏰',
              value: employees.filter(e => (e.shiftId||'A') === s.id).length,
              color: { A: '#1a56db', B: '#0891b2', C: '#7c3aed' }[s.id]
            })),
          ].map((s, i) => (
            <div key={i} style={{ background: '#f8fafc', borderRadius: '10px',
              padding: '12px 14px', border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: '18px', marginBottom: '4px' }}>{s.icon}</div>
              <div style={{ fontWeight: 800, fontSize: '20px', color: s.color }}>{s.value}</div>
              <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 600 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </MaintSection>

      <MaintSection icon="✏️" title="Edit All Employees"
        subtitle="Inline edit name, shift, designation, phone, and password"
        badge={`${employees.length} total`} badgeColor="#1a56db">
        <div style={{ marginBottom: '10px' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Search by name or designation…"
            style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e5e7eb',
              borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
        </div>
        {loadingPw ? (
          <p style={{ color: '#6b7280', fontSize: '13px' }}>Loading…</p>
        ) : (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '580px' }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    {['Name','Designation','Phone','Shift','Password','Actions'].map(h => (
                      <th key={h} style={{ padding: '9px 8px', textAlign: 'left',
                        fontSize: '11px', fontWeight: 700, color: '#374151',
                        borderBottom: '1px solid #e5e7eb', textTransform: 'uppercase',
                        letterSpacing: '0.04em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem',
                      color: '#9ca3af', fontSize: '13px' }}>No employees found</td></tr>
                  )}
                  {filtered.map(emp => (
                    <MaintEmpRow key={emp.id} emp={emp} passwords={passwords}
                      onSave={() => { toast.show(`✅ ${emp.name} updated`); onRefresh(); reloadPasswords(); }}
                      onDelete={async (e) => {
                        if (!confirm(`Delete ${e.name}? Attendance records will be kept.`)) return;
                        await deleteDoc(doc(db, 'employees', e.id));
                        toast.show(`🗑️ ${e.name} deleted`);
                        onRefresh();
                      }} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </MaintSection>

      <MaintSection icon="🔐" title="Admin Password"
        subtitle="Change the admin login password" badgeColor="#7c3aed">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '12px', marginBottom: '14px' }}>
          {[['current','Current Password'],['next','New Password'],['confirm','Confirm New']].map(([key, label]) => (
            <div key={key}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151',
                display: 'block', marginBottom: '5px' }}>{label}</label>
              <input type="password" value={adminPwForm[key]}
                onChange={e => setAdminPwForm(f => ({ ...f, [key]: e.target.value }))}
                placeholder={key === 'current' ? 'Current password' : 'Min. 6 characters'}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #d1d5db',
                  borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button onClick={handleAdminPwSave} disabled={adminPwSaving}
              style={{ width: '100%', padding: '9px 16px', fontWeight: 600,
                background: adminPwSaving ? '#9ca3af' : '#1a56db', color: '#fff',
                border: 'none', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>
              {adminPwSaving ? 'Saving…' : '🔐 Update Password'}
            </button>
          </div>
        </div>
      </MaintSection>

      <MaintSection icon="🗑️" title="Data Cleanup"
        subtitle="Delete attendance records by month or remove employees"
        badge="Destructive" badgeColor="#e02424">
        <div style={{ background: '#fff8f1', border: '1.5px solid #fed7aa', borderRadius: '10px',
          padding: '14px', marginBottom: '14px' }}>
          <p style={{ fontSize: '12px', color: '#92400e', fontWeight: 600, marginBottom: '10px' }}>
            ⚠️ These actions are permanent and cannot be reversed.
          </p>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151',
                display: 'block', marginBottom: '5px' }}>Select Month</label>
              <input type="month" value={cleanMonth} onChange={e => setCleanMonth(e.target.value)}
                style={{ padding: '8px 10px', border: '1px solid #d1d5db',
                  borderRadius: '8px', fontSize: '13px', outline: 'none' }} />
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                {cleanMonthRecs.length} records found for {cleanMonth}
              </div>
              <button onClick={handleDeleteMonthRecords} disabled={deleting || !cleanMonthRecs.length}
                style={{ padding: '8px 14px', fontWeight: 600, fontSize: '12px',
                  background: deleting || !cleanMonthRecs.length ? '#f3f4f6' : '#fee2e2',
                  color: deleting || !cleanMonthRecs.length ? '#9ca3af' : '#991b1b',
                  border: `1px solid ${deleting || !cleanMonthRecs.length ? '#e5e7eb' : '#fca5a5'}`,
                  borderRadius: '8px', cursor: 'pointer' }}>
                {deleting ? 'Deleting…' : `🗑️ Delete ${cleanMonth} Records`}
              </button>
            </div>
          </div>
        </div>
        <div style={{ fontSize: '12px', fontWeight: 700, color: '#374151',
          marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Delete Individual Employees
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
          gap: '6px' }}>
          {employees.map(emp => (
            <div key={emp.id} style={{ display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', padding: '8px 10px', background: '#fff',
              border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '13px' }}>
              <span style={{ fontWeight: 600, color: '#111827', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '130px' }}>
                {emp.name}
              </span>
              <button onClick={() => handleDeleteEmployee(emp)}
                style={{ padding: '3px 8px', fontSize: '11px', fontWeight: 700,
                  background: '#fff5f5', color: '#e02424', border: '1px solid #fecaca',
                  borderRadius: '6px', cursor: 'pointer', flexShrink: 0 }}>Del</button>
            </div>
          ))}
        </div>
      </MaintSection>

      {showBulkShift && (
        <BulkShiftModal employees={employees}
          onDone={() => { setShowBulkShift(false); toast.show('✅ Shifts updated'); onRefresh(); }}
          onClose={() => setShowBulkShift(false)} />
      )}
      {showImport && (
        <ImportModal existingEmployees={employees}
          onDone={() => onRefresh()}
          onClose={() => setShowImport(false)} />
      )}
    </div>
  );
}


// ─── Main App ──────────────────────────────────────────────────────────────

export default function Home() {
  const [role, setRole]           = useState(null);
  const [tab, setTab]             = useState('today');
  const [employees, setEmployees] = useState([]);
  const [records, setRecords]     = useState([]);
  const [loading, setLoading]     = useState(false);
  const [empSelf, setEmpSelf]     = useState('');

  function handleLogin(r, empId, preloadedEmployees) {
    setRole(r);
    setTab(r === 'admin' ? 'today' : 'calendar');
    setEmpSelf(empId || '');
    if (preloadedEmployees) setEmployees(preloadedEmployees);
  }

  function handleLogout() {
    setRole(null); setTab('today'); setEmployees([]); setRecords([]); setEmpSelf('');
  }

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [empSnap, recSnap] = await Promise.all([
        getDocs(query(collection(db, 'employees'), orderBy('createdAt', 'asc'))),
        getDocs(query(collection(db, 'attendance'), orderBy('date', 'desc')))
      ]);
      setEmployees(empSnap.docs.map(d => d.data()));
      setRecords(recSnap.docs.map(d => d.data()));
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { if (role) fetchData(); }, [fetchData, role]);

  if (!role) return (
    <>
      <Head>
        <title>AttendEase — Login</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
      </Head>
      <LoginScreen onLogin={handleLogin} />
    </>
  );

  const visibleRecords   = role === 'admin' ? records   : records.filter(r => r.empId === empSelf);
  const visibleEmployees = role === 'admin' ? employees : employees.filter(e => e.id === empSelf);
  const empName = role === 'employee' ? employees.find(e => e.id === empSelf)?.name : null;

  return (
    <>
      <Head>
        <title>AttendEase</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
      </Head>
      <Nav tab={tab} setTab={setTab} role={role} empName={empName} onLogout={handleLogout} />
      <div className="container" style={{ padding: '1rem' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: '#6b7280' }}>Loading...</div>
        ) : (
          <>
            {role === 'admin' && (
              <>
                {tab === 'today'       && <TodayTab      employees={employees} records={records} onRefresh={fetchData} />}
                {tab === 'employees'   && <EmployeesTab  employees={employees} records={records} onRefresh={fetchData} />}
                {tab === 'calendar'    && <CalendarTab   employees={employees} records={records} onRefresh={fetchData} />}
                {tab === 'report'      && <ReportTab     employees={employees} records={records} onRefresh={fetchData} />}
                {tab === 'alerts'      && <AlertsTab     employees={employees} records={records} />}
                {tab === 'maintenance' && <MaintenanceTab employees={employees} records={records} onRefresh={fetchData} />}
              </>
            )}
            {role === 'employee' && (
              <>
                {tab === 'calendar' && <CalendarTab employees={visibleEmployees} records={visibleRecords} defaultEmp={empSelf} onRefresh={fetchData} />}
                {tab === 'report'   && <ReportTab   employees={visibleEmployees} records={visibleRecords} onRefresh={fetchData} isEmployee={true} />}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
