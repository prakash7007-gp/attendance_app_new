import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import {
  collection, doc, setDoc, getDocs,
  deleteDoc, query, orderBy, writeBatch
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { format, startOfMonth, endOfMonth, eachDayOfInterval,
         getDaysInMonth, getDay, isToday, isSunday, parseISO } from 'date-fns';

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

function LoginScreen({ onLogin }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!pw.trim()) { setError('Please enter a password'); return; }
    setLoading(true);
    setError('');
    const { adminPw, employeePasswords, employees } = await getLoginData();
    if (pw === adminPw) {
      onLogin('admin', null, employees);
    } else {
      const matchedEmpId = Object.keys(employeePasswords).find(
        empId => employeePasswords[empId] === pw
      );
      if (matchedEmpId) {
        onLogin('employee', matchedEmpId, employees);
      } else {
        setError('Incorrect password. Please try again.');
      }
    }
    setLoading(false);
  }

  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',
      background:'linear-gradient(135deg,#1a56db 0%,#0891b2 100%)',padding:'1rem'}}>
      <div style={{background:'#fff',borderRadius:'16px',padding:'2.5rem 2rem',
        width:'100%',maxWidth:'380px',boxShadow:'0 20px 60px rgba(0,0,0,0.15)'}}>
        <div style={{textAlign:'center',marginBottom:'2rem'}}>
          <div style={{fontSize:'40px',marginBottom:'8px'}}>📋</div>
          <h1 style={{fontSize:'24px',fontWeight:'700',color:'#111827',margin:'0 0 4px'}}>AttendEase</h1>
          <p style={{fontSize:'14px',color:'#6b7280',margin:0}}>Enter your password to continue</p>
        </div>
        <div style={{marginBottom:'16px'}}>
          <label style={{fontSize:'13px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'6px'}}>Password</label>
          <input
            type="password"
            value={pw}
            onChange={e=>{ setPw(e.target.value); setError(''); }}
            onKeyDown={e=>e.key==='Enter'&&handleLogin()}
            placeholder="Enter your password"
            style={{width:'100%',padding:'10px 14px',border:'1.5px solid '+(error?'#e02424':'#d1d5db'),
              borderRadius:'8px',fontSize:'15px',outline:'none',boxSizing:'border-box'}}
            autoFocus
          />
          {error && <p style={{color:'#e02424',fontSize:'13px',margin:'6px 0 0'}}>{error}</p>}
        </div>
        <button onClick={handleLogin} disabled={loading}
          style={{width:'100%',padding:'11px',background:loading?'#9ca3af':'#1a56db',
            color:'#fff',border:'none',borderRadius:'8px',fontSize:'15px',
            fontWeight:'600',cursor:loading?'not-allowed':'pointer'}}>
          {loading ? 'Checking…' : 'Login'}
        </button>
        <div style={{marginTop:'20px',padding:'14px',background:'#f0f9ff',borderRadius:'8px',fontSize:'12px',color:'#0369a1'}}>
          Each employee logs in with their <strong>own personal password</strong>.<br/>
          Admin has a separate password for full access.
        </div>
      </div>
    </div>
  );
}

const MAX_LEAVES = 4;
const MAX_PERMISSION_MINS = 120;

const STATUS = {
  PRESENT:            'present',
  PRESENT_PERMISSION: 'present+permission',
  HALF_FIRST:         'half-first',
  HALF_SECOND:        'half-second',
  HALF_FIRST_PERM:    'half-first+perm',
  HALF_SECOND_PERM:   'half-second+perm',
  ABSENT:             'absent',
  LATE:               'late',
  PERMISSION:         'permission',
};

const PERM_STATUSES = [
  STATUS.PERMISSION,
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

function getLeaveCount(records) {
  const absent = records.filter(r => r.status === STATUS.ABSENT).length;
  const late   = records.filter(r => r.status === STATUS.LATE).length;
  const half   = records.filter(r => HALF_STATUSES.includes(r.status)).length;
  return absent + late + (half * 0.5);
}

function getPermBalance(empId, month, records) {
  const recs = records.filter(r => r.empId === empId && r.date.startsWith(month));
  const permUsed = recs
    .filter(r => PERM_STATUSES.includes(r.status))
    .reduce((s, r) => s + (r.permMins || 0), 0);
  const lateDeduction = recs.filter(r => r.status === STATUS.LATE).length * MAX_PERMISSION_MINS;
  const totalUsed = permUsed + lateDeduction;
  const left = MAX_PERMISSION_MINS - totalUsed;
  return { totalUsed, left, permUsed, lateDeduction };
}

function exportCSV(employees, records, month) {
  const days = getDaysInMonth(new Date(month + '-01'));
  const header = ['Employee', 'Designation', 'Shift',
    ...Array.from({length: days}, (_, i) => String(i+1).padStart(2,'0')),
    'Present', 'Half Day', 'Absent', 'Late', 'Perm Days', 'Leave Count', 'Perm Used', 'Perm Left'
  ];
  const rows = employees.map(emp => {
    const empRecs = records.filter(r => r.empId === emp.id && r.date.startsWith(month));
    const byDate = Object.fromEntries(empRecs.map(r => [r.date.slice(8,10), r]));
    const dayCells = Array.from({length: days}, (_, i) => {
      const key = String(i+1).padStart(2,'0');
      const rec = byDate[key];
      if (!rec) return '-';
      const labels = {
        'present':           'P',
        'present+permission':`P+Pm(${rec.permMins}m)`,
        'half-first':        'H1',
        'half-second':       'H2',
        'half-first+perm':   `H1+Pm(${rec.permMins}m)`,
        'half-second+perm':  `H2+Pm(${rec.permMins}m)`,
        'absent':            'A',
        'late':              'L',
        'permission':        `Pm(${rec.permMins}m)`,
      };
      return labels[rec.status] || rec.status;
    });
    const present  = empRecs.filter(r => [STATUS.PRESENT, STATUS.PRESENT_PERMISSION].includes(r.status)).length;
    const halfDay  = empRecs.filter(r => HALF_STATUSES.includes(r.status)).length;
    const absent   = empRecs.filter(r => r.status === STATUS.ABSENT).length;
    const late     = empRecs.filter(r => r.status === STATUS.LATE).length;
    const perm     = empRecs.filter(r => PERM_STATUSES.includes(r.status)).length;
    const bal      = getPermBalance(emp.id, month, records);
    const leaves   = getLeaveCount(empRecs);
    return [emp.name, emp.designation||'', getShift(emp.shiftId).display,
            ...dayCells, present, halfDay, absent, late, perm, leaves, bal.totalUsed, bal.left];
  });
  const csv = [header, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = `attendance_${month}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function Nav({ tab, setTab, role, empName, onLogout }) {
  const tabs = role === 'admin'
    ? [['today','Mark Attendance'],['employees','Employees'],['calendar','Calendar'],['report','Report']]
    : [['calendar','My Calendar'],['report','My Report']];
  return (
    <nav className="nav">
      <div className="nav-inner">
        <span className="nav-brand">📋 AttendEase</span>
        <div className="nav-tabs">
          {tabs.map(([key,label]) => (
            <button key={key} className={`nav-tab${tab===key?' active':''}`} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:'8px',marginLeft:'auto'}}>
          {role === 'employee' && empName && (
            <span style={{fontSize:'13px',color:'#374151',fontWeight:600}}>👤 {empName}</span>
          )}
          <span style={{fontSize:'12px',padding:'3px 10px',borderRadius:'20px',fontWeight:600,
            background: role==='admin'?'#1a56db22':'#0891b222',
            color: role==='admin'?'#1a56db':'#0891b2'}}>
            {role==='admin'?'🔑 Admin':'Employee'}
          </span>
          <button onClick={onLogout}
            style={{fontSize:'13px',padding:'4px 12px',border:'1px solid #d1d5db',
              borderRadius:'6px',background:'#fff',cursor:'pointer',color:'#374151'}}>
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
}

const BADGE_MAP = {
  'present':            { cls: 'badge-present',     label: 'Present' },
  'present+permission': { cls: 'badge-pressperm',   label: 'Present + Permission' },
  'half-first':         { cls: 'badge-halffirst',   label: '½ Day — 1st Half Off' },
  'half-second':        { cls: 'badge-halfsecond',  label: '½ Day — 2nd Half Off' },
  'half-first+perm':    { cls: 'badge-halffirstp',  label: '½ Day (1st) + Permission' },
  'half-second+perm':   { cls: 'badge-halfsecondp', label: '½ Day (2nd) + Permission' },
  'absent':             { cls: 'badge-absent',      label: 'Absent' },
  'late':               { cls: 'badge-late',        label: 'Late' },
  'permission':         { cls: 'badge-permission',  label: 'Permission' },
};

function StatusBadge({ status }) {
  const { cls, label } = BADGE_MAP[status] || { cls: 'badge-present', label: status };
  return <span className={`badge ${cls}`}>{label}</span>;
}

function ShiftBadge({ shiftId }) {
  const shift = getShift(shiftId);
  const colors = { A:'#1a56db', B:'#0891b2', C:'#7c3aed' };
  return (
    <span style={{fontSize:'11px',fontWeight:700,padding:'2px 8px',borderRadius:'20px',
      background:colors[shift.id]+'22',color:colors[shift.id]}}>
      {shift.label} · {shift.display}
    </span>
  );
}

function PermDisplay({ left }) {
  const over = left < 0;
  const color = over ? '#e02424' : left < 60 ? '#d97706' : '#0e9f6e';
  return (
    <span style={{fontWeight:700, color, fontSize:'14px'}}>
      {over ? `−${Math.abs(left)} min` : `${left} min`}
      {over && <span style={{marginLeft:'4px'}}>🔴</span>}
    </span>
  );
}

function EmployeeModal({ emp, onSave, onClose }) {
  const [form, setForm] = useState({
    name: emp?.name||'', designation: emp?.designation||'',
    phone: emp?.phone||'', shiftId: emp?.shiftId||'A',
    password: emp?.password||''
  });
  const set = (k,v) => setForm(f => ({...f,[k]:v}));

  async function save() {
    if (!form.name.trim()) return alert('Name is required');
    if (!form.password.trim()) return alert('Password is required for the employee to login');
    const id = emp?.id || `emp_${Date.now()}`;
    await setDoc(doc(db,'employees',id), {
      id, name: form.name, designation: form.designation,
      phone: form.phone, shiftId: form.shiftId,
      createdAt: emp?.createdAt||Date.now()
    });
    await setDoc(doc(db,'config','passwords'), {
      employees: { [id]: form.password }
    }, { merge: true });
    onSave();
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <h2>{emp?'Edit Employee':'Add Employee'}</h2>
        <div style={{display:'flex',flexDirection:'column',gap:'1rem'}}>
          <div><label>Full Name *</label><input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="e.g. Rajan Kumar"/></div>
          <div><label>Designation</label><input value={form.designation} onChange={e=>set('designation',e.target.value)} placeholder="e.g. Sales Executive"/></div>
          <div><label>Phone</label><input value={form.phone} onChange={e=>set('phone',e.target.value)} placeholder="e.g. 9876543210"/></div>
          <div>
            <label>Login Password * <span style={{fontSize:'11px',color:'#6b7280',fontWeight:400}}>(employee uses this to login)</span></label>
            <input type="text" value={form.password} onChange={e=>set('password',e.target.value)} placeholder="e.g. prak123"/>
          </div>
          <div>
            <label>Work Shift</label>
            <div style={{display:'flex',flexDirection:'column',gap:'8px',marginTop:'4px'}}>
              {SHIFTS.map(s => (
                <label key={s.id} style={{display:'flex',alignItems:'center',gap:'10px',cursor:'pointer',
                  padding:'10px 14px',borderRadius:'8px',border:`2px solid ${form.shiftId===s.id?'#1a56db':'#e5e7eb'}`,
                  background:form.shiftId===s.id?'#eff6ff':'white',margin:0}}>
                  <input type="radio" name="shift" value={s.id} checked={form.shiftId===s.id}
                    onChange={()=>set('shiftId',s.id)} style={{width:'auto',margin:0}}/>
                  <div>
                    <div style={{fontWeight:600,fontSize:'14px',color:form.shiftId===s.id?'#1a56db':'#111'}}>{s.label}</div>
                    <div style={{fontSize:'12px',color:'#6b7280'}}>{s.display}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div style={{display:'flex',gap:'8px',marginTop:'1.5rem',justifyContent:'flex-end'}}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>{emp?'Update':'Add Employee'}</button>
        </div>
      </div>
    </div>
  );
}

function AttendanceModal({ emp, existing, selectedDate, onSave, onClose }) {
  const [status, setStatus] = useState(existing?.status || STATUS.PRESENT);
  const [permMins, setPermMins] = useState(existing?.permMins || '');
  const [note, setNote] = useState(existing?.note || '');
  const shift = getShift(emp.shiftId);
  const mins = Number(permMins) || 0;
  const autoLate = PERM_STATUSES.includes(status) && mins > MAX_PERMISSION_MINS;
  const effectiveStatus = autoLate ? STATUS.LATE : status;
  const needsMins = PERM_STATUSES.includes(status);

  const statusGroups = [
    {
      group: 'Full Day',
      options: [
        { value: STATUS.PRESENT,            icon: '✅',   label: 'Present',                   hint: 'Full day present' },
        { value: STATUS.PRESENT_PERMISSION, icon: '✅🕐', label: 'Present + Permission',      hint: 'Full day + took permission time' },
        { value: STATUS.LATE,               icon: '⏰',   label: 'Late',                      hint: 'Late arrival (deducts 120 min)' },
        { value: STATUS.ABSENT,             icon: '❌',   label: 'Absent',                    hint: 'Did not come' },
        { value: STATUS.PERMISSION,         icon: '🕐',   label: 'Permission Only',           hint: 'Left early / did not come' },
      ]
    },
    {
      group: '½ Half Day',
      options: [
        { value: STATUS.HALF_FIRST,      icon: '🌅❌', label: '1st Half Off',              hint: 'Morning absent, came afternoon' },
        { value: STATUS.HALF_SECOND,     icon: '🌆❌', label: '2nd Half Off',              hint: 'Came morning, left after lunch' },
        { value: STATUS.HALF_FIRST_PERM, icon: '🌅🕐', label: '1st Half Off + Permission', hint: 'Morning off + took permission time' },
        { value: STATUS.HALF_SECOND_PERM,icon: '🌆🕐', label: '2nd Half Off + Permission', hint: 'Afternoon off + took permission time' },
      ]
    },
  ];

  async function save() {
    const finalMins = needsMins ? mins : 0;
    const finalStatus = autoLate ? STATUS.LATE : status;
    const recId = `${emp.id}_${selectedDate}`;
    await setDoc(doc(db,'attendance',recId), {
      id: recId, empId: emp.id, empName: emp.name,
      date: selectedDate, month: selectedDate.slice(0,7),
      status: finalStatus, permMins: finalMins,
      note, shiftId: emp.shiftId||'A', markedAt: Date.now()
    });
    onSave();
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:'520px'}}>
        <h2>Mark Attendance</h2>
        <div style={{display:'flex',gap:'8px',alignItems:'center',marginBottom:'1rem',flexWrap:'wrap'}}>
          <span style={{fontWeight:700,fontSize:'15px'}}>{emp.name}</span>
          <span style={{color:'#6b7280'}}>·</span>
          <span style={{fontSize:'13px',color:'#6b7280'}}>{selectedDate}</span>
          <ShiftBadge shiftId={emp.shiftId}/>
        </div>
        <div style={{background:'#f0f9ff',border:'1px solid #bae6fd',borderRadius:'8px',
          padding:'8px 12px',marginBottom:'1rem',fontSize:'13px',color:'#0c4a6e'}}>
          🕐 {shift.start} – {shift.end} &nbsp;|&nbsp; Permission limit: <strong>120 min/month</strong>
        </div>
        {statusGroups.map(grp => (
          <div key={grp.group} style={{marginBottom:'1rem'}}>
            <div style={{fontSize:'11px',fontWeight:700,color:'#6b7280',textTransform:'uppercase',
              letterSpacing:'0.05em',marginBottom:'6px'}}>{grp.group}</div>
            <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
              {grp.options.map(s => (
                <button key={s.value} onClick={()=>setStatus(s.value)}
                  style={{padding:'9px 14px',borderRadius:'8px',
                    border:`2px solid ${status===s.value?'#1a56db':'#e5e7eb'}`,
                    background:status===s.value?'#eff6ff':'white',cursor:'pointer',
                    fontWeight:600,fontSize:'13px',color:status===s.value?'#1a56db':'#111',
                    textAlign:'left',display:'flex',alignItems:'center',gap:'10px'}}>
                  <span style={{fontSize:'16px',minWidth:'28px'}}>{s.icon}</span>
                  <span>{s.label}</span>
                  <span style={{fontSize:'11px',color:'#9ca3af',fontWeight:400,marginLeft:'auto'}}>{s.hint}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {needsMins && (
          <div style={{marginBottom:'1rem'}}>
            <label>Permission Duration (minutes)</label>
            <input type="number" value={permMins} onChange={e=>setPermMins(e.target.value)}
              placeholder="e.g. 60" min="1"/>
            {autoLate
              ? <p style={{color:'#e02424',fontSize:'12px',marginTop:'4px',fontWeight:600}}>
                  ⚠️ Over 120 mins → will be marked as Late
                </p>
              : mins > 0
                ? <p style={{color:'#0e9f6e',fontSize:'12px',marginTop:'4px'}}>
                    ✓ {mins} min deducted from permission balance
                  </p>
                : null}
          </div>
        )}
        {status === STATUS.LATE && (
          <div style={{background:'#fef3c7',border:'1px solid #fcd34d',borderRadius:'8px',
            padding:'8px 12px',marginBottom:'1rem',fontSize:'13px',color:'#92400e'}}>
            ⚠️ Late deducts <strong>120 minutes</strong> from permission balance.
          </div>
        )}
        <div><label>Note (optional)</label>
          <input value={note} onChange={e=>setNote(e.target.value)} placeholder="Any remarks..."/>
        </div>
        <div style={{display:'flex',gap:'8px',marginTop:'1.5rem',justifyContent:'flex-end'}}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>
            Save — {(BADGE_MAP[effectiveStatus]?.label || effectiveStatus).toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}

function TodayTab({ employees, records, onRefresh }) {
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [markEmp, setMarkEmp] = useState(null);
  const mo = selectedDate.slice(0,7);
  const dateRecs = records.filter(r => r.date === selectedDate);
  const byEmpId = Object.fromEntries(dateRecs.map(r => [r.empId, r]));

  const present  = dateRecs.filter(r => [STATUS.PRESENT,STATUS.PRESENT_PERMISSION].includes(r.status)).length;
  const halfDay  = dateRecs.filter(r => HALF_STATUSES.includes(r.status)).length;
  const absent   = dateRecs.filter(r => r.status===STATUS.ABSENT).length;
  const late     = dateRecs.filter(r => r.status===STATUS.LATE).length;
  const perm     = dateRecs.filter(r => PERM_STATUSES.includes(r.status)).length;
  const unmarked = employees.length - dateRecs.length;

  return (
    <div>
      <h1 style={{fontSize:'22px',fontWeight:'700',marginBottom:'1rem'}}>Mark Attendance</h1>
      <div className="card" style={{marginBottom:'1.25rem',display:'flex',alignItems:'center',gap:'1rem',flexWrap:'wrap'}}>
        <div style={{flex:'1',minWidth:'180px'}}>
          <label>Select Date</label>
          <input type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)} max={todayStr()}/>
        </div>
        <button className="btn btn-outline" style={{marginTop:'18px'}} onClick={()=>setSelectedDate(todayStr())}>Today</button>
        <span style={{marginTop:'18px',fontSize:'15px',fontWeight:600,color:'#1a56db'}}>
          {format(parseISO(selectedDate),'EEEE, dd MMMM yyyy')}
        </span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'10px',marginBottom:'1.5rem'}}>
        {[
          {label:'Present',    value:present,  color:'#065f46'},
          {label:'Half Day',   value:halfDay,  color:'#1e40af'},
          {label:'Absent',     value:absent,   color:'#991b1b'},
          {label:'Late',       value:late,     color:'#5b21b6'},
          {label:'Permission', value:perm,     color:'#0c4a6e'},
          {label:'Not Marked', value:unmarked, color:'#6b7280'},
        ].map(s=>(
          <div key={s.label} className="stat-card">
            <div className="value" style={{color:s.color}}>{s.value}</div>
            <div className="label">{s.label}</div>
          </div>
        ))}
      </div>
      {SHIFTS.map(shift => {
        const shiftEmps = employees.filter(e=>(e.shiftId||'A')===shift.id);
        if (!shiftEmps.length) return null;
        return (
          <div key={shift.id} style={{marginBottom:'1.5rem'}}>
            <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'8px'}}>
              <h3 style={{fontSize:'15px',fontWeight:'700'}}>{shift.label}</h3>
              <span style={{fontSize:'13px',color:'#6b7280'}}>{shift.display}</span>
              <span style={{fontSize:'12px',background:'#f3f4f6',padding:'2px 8px',borderRadius:'20px'}}>{shiftEmps.length} members</span>
            </div>
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead><tr>
                    <th>#</th><th>Name</th><th>Status</th>
                    <th>Perm Mins</th><th>Perm Balance</th><th>Leaves</th><th>Note</th><th>Action</th>
                  </tr></thead>
                  <tbody>
                    {shiftEmps.map((emp,i) => {
                      const rec = byEmpId[emp.id];
                      const bal = getPermBalance(emp.id, mo, records);
                      const empMoRecs = records.filter(r=>r.empId===emp.id&&r.date.startsWith(mo));
                      const leavesUsed = getLeaveCount(empMoRecs);
                      const overLeave = leavesUsed >= MAX_LEAVES;
                      return (
                        <tr key={emp.id}>
                          <td style={{color:'#6b7280'}}>{i+1}</td>
                          <td style={{fontWeight:700}}>{emp.name}</td>
                          <td>{rec ? <StatusBadge status={rec.status}/> :
                            <span style={{color:'#6b7280',fontSize:'13px'}}>— Not marked</span>}</td>
                          <td style={{fontSize:'13px'}}>
                            {rec && PERM_STATUSES.includes(rec.status) && rec.permMins ? `${rec.permMins} min` : '—'}
                          </td>
                          <td><PermDisplay left={bal.left}/></td>
                          <td style={{color:overLeave?'#e02424':'#374151',fontWeight:overLeave?700:400,fontSize:'13px'}}>
                            {leavesUsed}/{MAX_LEAVES}{overLeave&&' ⚠️'}
                          </td>
                          <td style={{fontSize:'12px',color:'#6b7280'}}>{rec?.note||'—'}</td>
                          <td>
                            <button className="btn btn-primary" style={{padding:'5px 12px',fontSize:'13px'}}
                              onClick={()=>setMarkEmp(emp)}>{rec?'Edit':'Mark'}</button>
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
          onSave={()=>{setMarkEmp(null);onRefresh();}}
          onClose={()=>setMarkEmp(null)}/>
      )}
    </div>
  );
}

function EmployeesTab({ employees, records, onRefresh }) {
  const [modal, setModal] = useState(null);
  const mo = monthStr();

  async function deleteEmp(emp) {
    if (!confirm(`Delete ${emp.name}?`)) return;
    await deleteDoc(doc(db,'employees',emp.id));
    onRefresh();
  }

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1rem'}}>
        <h1 style={{fontSize:'22px',fontWeight:'700'}}>Employees ({employees.length})</h1>
        <button className="btn btn-primary" onClick={()=>setModal('add')}>+ Add Employee</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'10px',marginBottom:'1rem'}}>
        {SHIFTS.map(s=>{
          const count = employees.filter(e=>(e.shiftId||'A')===s.id).length;
          const colors = {A:'#1a56db',B:'#0891b2',C:'#7c3aed'};
          return (
            <div key={s.id} className="stat-card">
              <div className="value" style={{color:colors[s.id]}}>{count}</div>
              <div className="label">{s.label} · {s.display}</div>
            </div>
          );
        })}
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>#</th><th>Name</th><th>Shift</th><th>Designation</th>
              <th>Leaves This Month</th><th>Perm Balance</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {employees.map((emp,i)=>{
                const empRecs = records.filter(r=>r.empId===emp.id&&r.date.startsWith(mo));
                const leavesUsed = getLeaveCount(empRecs);
                const bal = getPermBalance(emp.id, mo, records);
                return (
                  <tr key={emp.id}>
                    <td style={{color:'#6b7280'}}>{i+1}</td>
                    <td style={{fontWeight:600}}>{emp.name}</td>
                    <td><ShiftBadge shiftId={emp.shiftId}/></td>
                    <td style={{color:'#6b7280'}}>{emp.designation||'—'}</td>
                    <td style={{color:leavesUsed>=MAX_LEAVES?'#e02424':'#374151',fontWeight:leavesUsed>=MAX_LEAVES?700:400}}>
                      {leavesUsed}/{MAX_LEAVES}{leavesUsed>=MAX_LEAVES&&' ⚠️'}
                    </td>
                    <td><PermDisplay left={bal.left}/></td>
                    <td>
                      <div style={{display:'flex',gap:'6px'}}>
                        <button className="btn btn-outline" style={{padding:'5px 10px',fontSize:'13px'}} onClick={()=>setModal(emp)}>Edit</button>
                        <button className="btn btn-danger" style={{padding:'5px 10px',fontSize:'13px'}} onClick={()=>deleteEmp(emp)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {employees.length===0&&(
                <tr><td colSpan={7} style={{textAlign:'center',color:'#6b7280',padding:'2rem'}}>No employees yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {modal&&(
        <EmployeeModal emp={modal==='add'?null:modal}
          onSave={()=>{setModal(null);onRefresh();}} onClose={()=>setModal(null)}/>
      )}
    </div>
  );
}

const CAL_COLORS = {
  'present':              { bg:'#d1fae5', color:'#065f46', label:'P' },
  'present+permission':   { bg:'#fef3c7', color:'#92400e', label:'P+Pm' },
  'half-first':           { bg:'#dbeafe', color:'#1e40af', label:'½1' },
  'half-second':          { bg:'#bfdbfe', color:'#1e40af', label:'½2' },
  'half-first+perm':      { bg:'#ede9fe', color:'#5b21b6', label:'½1P' },
  'half-second+perm':     { bg:'#ddd6fe', color:'#5b21b6', label:'½2P' },
  'absent':               { bg:'#fee2e2', color:'#991b1b', label:'A' },
  'late':                 { bg:'#f3e8ff', color:'#6b21a8', label:'L' },
  'permission':           { bg:'#e0f2fe', color:'#0c4a6e', label:'Pm' },
};

// ── UPDATED CalendarTab ───────────────────────────────────────────────────
function CalendarTab({ employees, records, defaultEmp, onRefresh }) {
  const [selEmp, setSelEmp] = useState(defaultEmp || '');
  const [viewDate, setViewDate] = useState(new Date());
  const [markEmp, setMarkEmp] = useState(null);
  const [markDate, setMarkDate] = useState(null);

  const mo = monthStr(viewDate);
  const emp = employees.find(e => e.id === selEmp);
  const days = eachDayOfInterval({ start: startOfMonth(viewDate), end: endOfMonth(viewDate) });
  const firstDay = getDay(startOfMonth(viewDate));
  const blanks = Array(firstDay).fill(null);
  const empRecs = records.filter(r => r.empId === selEmp && r.date.startsWith(mo));
  const byDate = Object.fromEntries(empRecs.map(r => [r.date, r]));

  const present    = empRecs.filter(r => [STATUS.PRESENT, STATUS.PRESENT_PERMISSION].includes(r.status)).length;
  const halfDay    = empRecs.filter(r => HALF_STATUSES.includes(r.status)).length;
  const absent     = empRecs.filter(r => r.status === STATUS.ABSENT).length;
  const late       = empRecs.filter(r => r.status === STATUS.LATE).length;
  const perm       = empRecs.filter(r => PERM_STATUSES.includes(r.status)).length;
  const leavesUsed = emp ? getLeaveCount(empRecs) : 0;
  const bal        = emp ? getPermBalance(emp.id, mo, records) : { left: 120, totalUsed: 0, permUsed: 0, lateDeduction: 0 };

  const isEmployeeView = !!defaultEmp;

  function handleDayClick(day) {
    if (!emp) return;
    const ds = format(day, 'yyyy-MM-dd');
    if (isSunday(day)) return;
    if (ds > todayStr()) return;
    setMarkDate(ds);
    setMarkEmp(emp);
  }

  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '1rem' }}>
        {isEmployeeView ? 'My Calendar' : 'Calendar View'}
      </h1>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {!isEmployeeView && (
            <div style={{ flex: '1', minWidth: '200px' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: !isEmployeeView ? '18px' : '0' }}>
            <button className="btn btn-outline" style={{ padding: '8px' }}
              onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>←</button>
            <span style={{ fontWeight: 600, minWidth: '130px', textAlign: 'center' }}>{format(viewDate, 'MMMM yyyy')}</span>
            <button className="btn btn-outline" style={{ padding: '8px' }}
              onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>→</button>
          </div>
        </div>
      </div>

      {selEmp && emp && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: '10px', marginBottom: '1rem' }}>
            {[
              { label: 'Present',                 value: present,    color: '#065f46' },
              { label: 'Half Day',                value: halfDay,    color: '#1e40af' },
              { label: 'Absent',                  value: absent,     color: '#991b1b' },
              { label: 'Late',                    value: late,       color: '#5b21b6' },
              { label: 'Perm Days',               value: perm,       color: '#0c4a6e' },
              { label: `Leaves (/${MAX_LEAVES})`, value: leavesUsed, color: leavesUsed >= MAX_LEAVES ? '#e02424' : '#374151' },
            ].map((s, i) => (
              <div key={i} className="stat-card">
                <div className="value" style={{ color: s.color, fontSize: '22px' }}>{s.value}</div>
                <div className="label">{s.label}</div>
              </div>
            ))}
          </div>

          {bal.left < 0 && (
            <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px',
              padding: '10px 14px', marginBottom: '1rem', fontSize: '13px', color: '#991b1b', fontWeight: 600 }}>
              🔴 Permission exceeded by {Math.abs(bal.left)} minutes this month!
            </div>
          )}
          {leavesUsed >= MAX_LEAVES && (
            <div className="alert alert-danger">⚠️ {emp.name} has used all {MAX_LEAVES} allowed leaves this month.</div>
          )}

          {isEmployeeView && (
            <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px',
              padding: '8px 14px', marginBottom: '1rem', fontSize: '13px', color: '#0369a1' }}>
              💡 Click any past day to mark or update your attendance.
            </div>
          )}

          <div className="card">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '4px', marginBottom: '8px', textAlign: 'center' }}>
              {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                <div key={d} style={{ fontSize: '12px', fontWeight: '600', color: '#6b7280', padding: '4px' }}>{d}</div>
              ))}
            </div>
            <div className="calendar-grid">
              {blanks.map((_, i) => <div key={`b${i}`} className="cal-day empty" />)}
              {days.map(day => {
                const ds = format(day, 'yyyy-MM-dd');
                const rec = byDate[ds];
                const sun = isSunday(day);
                const isFuture = ds > todayStr();
                const cal = rec && !sun ? CAL_COLORS[rec.status] : null;
                const clickable = isEmployeeView && !sun && !isFuture;

                return (
                  <div
                    key={ds}
                    className={`cal-day${isToday(day) ? ' today' : ''}${sun ? ' sunday' : ''}`}
                    onClick={() => clickable && handleDayClick(day)}
                    style={{
                      ...(cal ? {
                        background: cal.bg,
                        color: cal.color,
                        border: isToday(day) ? '2px solid #1a56db' : '1px solid transparent'
                      } : {}),
                      ...(clickable ? { cursor: 'pointer' } : {}),
                    }}
                    title={
                      rec
                        ? BADGE_MAP[rec.status]?.label + (rec.permMins ? ` (${rec.permMins}min)` : '')
                        : clickable ? 'Click to mark attendance' : ''
                    }
                  >
                    <div>{format(day, 'd')}</div>
                    {cal && <div style={{ fontSize: '7px', lineHeight: 1, fontWeight: 700 }}>{cal.label}</div>}
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '1rem', flexWrap: 'wrap' }}>
              {Object.entries(CAL_COLORS).map(([key, { bg, color }]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                  <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: bg,
                    border: `1px solid ${color}44`, display: 'inline-block' }} />
                  <span style={{ color: '#6b7280' }}>{BADGE_MAP[key]?.label || key}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ marginTop: '1rem' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '0.75rem' }}>Attendance Details</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Status</th><th>Perm Mins</th><th>Note</th></tr></thead>
                <tbody>
                  {empRecs.sort((a, b) => a.date.localeCompare(b.date)).map(r => (
                    <tr key={r.id}>
                      <td>{format(parseISO(r.date), 'EEE, dd MMM')}</td>
                      <td><StatusBadge status={r.status} /></td>
                      <td style={{ fontSize: '13px' }}>
                        {PERM_STATUSES.includes(r.status) && r.permMins
                          ? <span style={{ color: '#0891b2', fontWeight: 600 }}>−{r.permMins} min</span> : ''}
                        {r.status === STATUS.LATE
                          ? <span style={{ color: '#d97706', fontWeight: 600 }}>−120 min (late)</span> : ''}
                        {[STATUS.PRESENT, STATUS.ABSENT, ...HALF_STATUSES.filter(s => !s.includes('perm'))].includes(r.status) ? '—' : ''}
                      </td>
                      <td style={{ color: '#6b7280' }}>{r.note || '—'}</td>
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
        <AttendanceModal
          emp={markEmp}
          existing={byDate[markDate]}
          selectedDate={markDate}
          onSave={() => { setMarkEmp(null); setMarkDate(null); onRefresh(); }}
          onClose={() => { setMarkEmp(null); setMarkDate(null); }}
        />
      )}
    </div>
  );
}

function ReportTab({ employees, records, onRefresh, isEmployee = false }) {
  const [reportMonth, setReportMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [deleting, setDeleting] = useState(false);
  const mo = reportMonth;
  const moRecs = records.filter(r => r.date.startsWith(mo));

  const summary = employees.map(emp => {
    const recs = moRecs.filter(r => r.empId === emp.id);
    const present  = recs.filter(r => [STATUS.PRESENT, STATUS.PRESENT_PERMISSION].includes(r.status)).length;
    const halfDay  = recs.filter(r => HALF_STATUSES.includes(r.status)).length;
    const absent   = recs.filter(r => r.status === STATUS.ABSENT).length;
    const late     = recs.filter(r => r.status === STATUS.LATE).length;
    const perm     = recs.filter(r => PERM_STATUSES.includes(r.status)).length;
    const bal      = getPermBalance(emp.id, mo, records);
    const leavesUsed = getLeaveCount(recs);
    return { emp, present, halfDay, absent, late, perm, bal, leavesUsed };
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
        <h1 style={{ fontSize: '22px', fontWeight: '700' }}>{isEmployee ? 'My Report' : 'Monthly Report'}</h1>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input type="month" value={reportMonth} onChange={e => setReportMonth(e.target.value)} style={{ width: '160px' }} />
          <button className="btn btn-outline" onClick={() => exportCSV(employees, records, mo)}>⬇ Download CSV</button>
          {!isEmployee && (
            <button className="btn btn-danger" onClick={handleDownloadAndDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : '⬇ Download + Delete Month'}
            </button>
          )}
        </div>
      </div>
      {!isEmployee && (
        <div className="alert alert-warning">⚠️ "Download + Delete Month" exports CSV then permanently deletes that month's data.</div>
      )}
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>#</th><th>Employee</th><th>Shift</th><th>Present</th><th>Half Day</th>
              <th>Absent</th><th>Late</th><th>Perm Days</th><th>Perm Used</th>
              <th>Late Deduct</th><th>Perm Left</th><th>Total Leaves</th><th>Status</th>
            </tr></thead>
            <tbody>
              {summary.map(({ emp, present, halfDay, absent, late, perm, bal, leavesUsed }, i) => (
                <tr key={emp.id}>
                  <td style={{ color: '#6b7280' }}>{i + 1}</td>
                  <td style={{ fontWeight: 600 }}>{emp.name}</td>
                  <td><ShiftBadge shiftId={emp.shiftId} /></td>
                  <td style={{ color: '#0e9f6e', fontWeight: 600 }}>{present}</td>
                  <td style={{ color: '#1e40af', fontWeight: 600 }}>{halfDay}</td>
                  <td style={{ color: '#e02424', fontWeight: 600 }}>{absent}</td>
                  <td style={{ color: '#7c3aed', fontWeight: 600 }}>{late}</td>
                  <td style={{ color: '#0891b2', fontWeight: 600 }}>{perm}</td>
                  <td style={{ fontSize: '13px' }}>{bal.permUsed} min</td>
                  <td style={{ fontSize: '13px', color: bal.lateDeduction > 0 ? '#d97706' : '#6b7280' }}>{bal.lateDeduction} min</td>
                  <td><PermDisplay left={bal.left} /></td>
                  <td style={{ color: leavesUsed >= MAX_LEAVES ? '#e02424' : '#374151', fontWeight: leavesUsed >= MAX_LEAVES ? 700 : 400 }}>
                    {leavesUsed}/{MAX_LEAVES}{leavesUsed >= MAX_LEAVES && ' ⚠️'}
                  </td>
                  <td>{leavesUsed >= MAX_LEAVES
                    ? <span className="badge badge-absent">Exceeded</span>
                    : <span className="badge badge-present">OK</span>}
                  </td>
                </tr>
              ))}
              {employees.length === 0 && (
                <tr><td colSpan={13} style={{ textAlign: 'center', color: '#6b7280', padding: '2rem' }}>No records</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [role, setRole] = useState(null);
  const [tab, setTab] = useState('today');
  const [employees, setEmployees] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [empSelf, setEmpSelf] = useState('');

  function handleLogin(r, empId, preloadedEmployees) {
    setRole(r);
    setTab(r === 'admin' ? 'today' : 'calendar');
    setEmpSelf(empId || '');
    if (preloadedEmployees) setEmployees(preloadedEmployees);
  }

  function handleLogout() {
    setRole(null);
    setTab('today');
    setEmployees([]);
    setRecords([]);
    setEmpSelf('');
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

  if (!role) return <LoginScreen onLogin={handleLogin} />;

  const visibleRecords   = role === 'admin' ? records   : records.filter(r => r.empId === empSelf);
  const visibleEmployees = role === 'admin' ? employees : employees.filter(e => e.id === empSelf);
  const empName = role === 'employee' ? employees.find(e => e.id === empSelf)?.name : null;

  return (
    <>
      <Head>
        <title>AttendEase — Company Attendance</title>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
      </Head>
      <Nav tab={tab} setTab={setTab} role={role} empName={empName} onLogout={handleLogout}/>
      <div className="container" style={{ padding: '1.5rem 1rem' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: '#6b7280' }}>Loading...</div>
        ) : (
          <>
            {role === 'admin' && (
              <>
                {tab === 'today'     && <TodayTab     employees={employees} records={records} onRefresh={fetchData}/>}
                {tab === 'employees' && <EmployeesTab employees={employees} records={records} onRefresh={fetchData}/>}
                {tab === 'calendar'  && <CalendarTab  employees={employees} records={records} onRefresh={fetchData}/>}
                {tab === 'report'    && <ReportTab    employees={employees} records={records} onRefresh={fetchData}/>}
              </>
            )}
            {role === 'employee' && (
              <>
                {tab === 'calendar' && (
                  <CalendarTab
                    employees={visibleEmployees}
                    records={visibleRecords}
                    defaultEmp={empSelf}
                    onRefresh={fetchData}
                  />
                )}
                {tab === 'report' && (
                  <ReportTab
                    employees={visibleEmployees}
                    records={visibleRecords}
                    onRefresh={fetchData}
                    isEmployee={true}
                  />
                )}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
