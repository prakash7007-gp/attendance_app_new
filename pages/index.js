import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import {
  collection, doc, setDoc, getDocs,
  deleteDoc, query, orderBy, writeBatch
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { format, startOfMonth, endOfMonth, eachDayOfInterval,
         getDaysInMonth, getDay, isToday, isSunday, parseISO } from 'date-fns';

const MAX_LEAVES = 4;
const MAX_PERMISSION_MINS = 120;

// Status types
const STATUS = {
  PRESENT: 'present',
  PRESENT_PERMISSION: 'present+permission', // came but took permission
  ABSENT: 'absent',
  LATE: 'late',
  PERMISSION: 'permission', // full day permission / left early
};

const SHIFTS = [
  { id: 'A', label: 'Shift A', start: '09:00', end: '18:00', display: '9:00 AM – 6:00 PM' },
  { id: 'B', label: 'Shift B', start: '09:30', end: '18:30', display: '9:30 AM – 6:30 PM' },
  { id: 'C', label: 'Shift C', start: '10:00', end: '19:00', display: '10:00 AM – 7:00 PM' },
];

function todayStr() { return format(new Date(), 'yyyy-MM-dd'); }
function monthStr(d = new Date()) { return format(d, 'yyyy-MM'); }
function getShift(id) { return SHIFTS.find(s => s.id === id) || SHIFTS[0]; }

// Permission balance: late deducts 120, present+permission deducts actual mins
function getPermBalance(empId, month, records) {
  const recs = records.filter(r => r.empId === empId && r.date.startsWith(month));
  const permUsed = recs
    .filter(r => r.status === STATUS.PERMISSION || r.status === STATUS.PRESENT_PERMISSION)
    .reduce((s, r) => s + (r.permMins || 0), 0);
  const lateDeduction = recs.filter(r => r.status === STATUS.LATE).length * MAX_PERMISSION_MINS;
  const totalUsed = permUsed + lateDeduction;
  const left = MAX_PERMISSION_MINS - totalUsed; // can go negative
  return { totalUsed, left, permUsed, lateDeduction };
}

function exportCSV(employees, records, month) {
  const days = getDaysInMonth(new Date(month + '-01'));
  const header = ['Employee', 'Designation', 'Shift',
    ...Array.from({length: days}, (_, i) => String(i+1).padStart(2,'0')),
    'Present', 'Absent', 'Late', 'Perm Days', 'Leaves', 'Perm Used', 'Perm Left'
  ];
  const rows = employees.map(emp => {
    const empRecs = records.filter(r => r.empId === emp.id && r.date.startsWith(month));
    const byDate = Object.fromEntries(empRecs.map(r => [r.date.slice(8,10), r]));
    const dayCells = Array.from({length: days}, (_, i) => {
      const key = String(i+1).padStart(2,'0');
      const rec = byDate[key];
      if (!rec) return '-';
      if (rec.status === STATUS.PRESENT_PERMISSION) return `P+Perm(${rec.permMins}m)`;
      if (rec.status === STATUS.PERMISSION) return `Perm(${rec.permMins}m)`;
      return rec.status.charAt(0).toUpperCase();
    });
    const present = empRecs.filter(r => r.status === STATUS.PRESENT || r.status === STATUS.PRESENT_PERMISSION).length;
    const absent = empRecs.filter(r => r.status === STATUS.ABSENT).length;
    const late = empRecs.filter(r => r.status === STATUS.LATE).length;
    const perm = empRecs.filter(r => r.status === STATUS.PERMISSION || r.status === STATUS.PRESENT_PERMISSION).length;
    const bal = getPermBalance(emp.id, month, records);
    const leavesUsed = absent + late;
    return [emp.name, emp.designation||'', getShift(emp.shiftId).display,
            ...dayCells, present, absent, late, perm, leavesUsed, bal.totalUsed, bal.left];
  });
  const csv = [header, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = `attendance_${month}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ── Nav ───────────────────────────────────────────────────────────────────
function Nav({ tab, setTab }) {
  return (
    <nav className="nav">
      <div className="nav-inner">
        <span className="nav-brand">📋 AttendEase</span>
        <div className="nav-tabs">
          {[['today','Mark Attendance'],['employees','Employees'],['calendar','Calendar'],['report','Report']].map(([key,label]) => (
            <button key={key} className={`nav-tab${tab===key?' active':''}`} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
      </div>
    </nav>
  );
}

function StatusBadge({ status }) {
  const map = {
    'present': ['badge-present','Present'],
    'present+permission': ['badge-half','Present + Permission'],
    'absent': ['badge-absent','Absent'],
    'late': ['badge-late','Late'],
    'permission': ['badge-permission','Permission'],
  };
  const [cls, label] = map[status] || ['badge-present', status];
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

// Permission mins left display — red with minus if over limit
function PermDisplay({ left }) {
  const over = left < 0;
  const color = over ? '#e02424' : left < 60 ? '#d97706' : '#0e9f6e';
  return (
    <span style={{fontWeight:700, color, fontSize:'14px'}}>
      {over ? `−${Math.abs(left)} min` : `${left} min`}
      {over && <span style={{marginLeft:'4px',fontSize:'16px'}}>🔴</span>}
    </span>
  );
}

// ── Employee Modal ─────────────────────────────────────────────────────────
function EmployeeModal({ emp, onSave, onClose }) {
  const [form, setForm] = useState({
    name: emp?.name||'', designation: emp?.designation||'',
    phone: emp?.phone||'', shiftId: emp?.shiftId||'A'
  });
  const set = (k,v) => setForm(f => ({...f,[k]:v}));

  async function save() {
    if (!form.name.trim()) return alert('Name is required');
    const id = emp?.id || `emp_${Date.now()}`;
    await setDoc(doc(db,'employees',id), {...form, id, createdAt: emp?.createdAt||Date.now()});
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

// ── Attendance Modal ───────────────────────────────────────────────────────
function AttendanceModal({ emp, existing, selectedDate, onSave, onClose }) {
  const [status, setStatus] = useState(existing?.status || STATUS.PRESENT);
  const [permMins, setPermMins] = useState(existing?.permMins || '');
  const [note, setNote] = useState(existing?.note || '');
  const shift = getShift(emp.shiftId);
  const mins = Number(permMins) || 0;

  // If permission > 120 min → auto late
  const autoLate = (status === STATUS.PERMISSION || status === STATUS.PRESENT_PERMISSION) && mins > MAX_PERMISSION_MINS;
  const effectiveStatus = autoLate ? STATUS.LATE : status;

  const needsMins = status === STATUS.PERMISSION || status === STATUS.PRESENT_PERMISSION;

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

  const statusOptions = [
    { value: STATUS.PRESENT,            icon: '✅', label: 'Present' },
    { value: STATUS.PRESENT_PERMISSION, icon: '✅🕐', label: 'Present + Permission' },
    { value: STATUS.ABSENT,             icon: '❌', label: 'Absent' },
    { value: STATUS.LATE,               icon: '⏰', label: 'Late' },
    { value: STATUS.PERMISSION,         icon: '🕐', label: 'Permission Only' },
  ];

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <h2>Mark Attendance</h2>
        <div style={{display:'flex',gap:'8px',alignItems:'center',marginBottom:'1rem',flexWrap:'wrap'}}>
          <span style={{fontWeight:700,fontSize:'15px'}}>{emp.name}</span>
          <span style={{fontSize:'13px',color:'#6b7280'}}>·</span>
          <span style={{fontSize:'13px',color:'#6b7280'}}>{selectedDate}</span>
          <ShiftBadge shiftId={emp.shiftId}/>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:'8px',marginBottom:'1rem'}}>
          {statusOptions.map(s => (
            <button key={s.value} onClick={()=>setStatus(s.value)}
              style={{padding:'10px 14px',borderRadius:'8px',border:`2px solid ${status===s.value?'#1a56db':'#e5e7eb'}`,
                background:status===s.value?'#eff6ff':'white',cursor:'pointer',fontWeight:600,
                fontSize:'14px',color:status===s.value?'#1a56db':'#111',textAlign:'left',
                display:'flex',alignItems:'center',gap:'10px'}}>
              <span style={{fontSize:'18px'}}>{s.icon}</span>
              {s.label}
              {s.value===STATUS.PRESENT_PERMISSION&&
                <span style={{fontSize:'11px',color:'#6b7280',fontWeight:400,marginLeft:'auto'}}>came to work + took permission time</span>}
            </button>
          ))}
        </div>

        {needsMins && (
          <div style={{marginBottom:'1rem'}}>
            <label>Permission Duration (minutes)</label>
            <input type="number" value={permMins} onChange={e=>setPermMins(e.target.value)}
              placeholder="e.g. 60" min="1"/>
            {autoLate && (
              <p style={{color:'#e02424',fontSize:'12px',marginTop:'4px',fontWeight:600}}>
                ⚠️ Over 120 mins → will be marked as <strong>Late</strong>
              </p>
            )}
            {mins > 0 && !autoLate && (
              <p style={{color:'#0e9f6e',fontSize:'12px',marginTop:'4px'}}>
                ✓ {mins} min will be deducted from permission balance (120 min/month)
              </p>
            )}
          </div>
        )}

        {status === STATUS.LATE && (
          <div style={{background:'#fef3c7',border:'1px solid #fcd34d',borderRadius:'8px',
            padding:'8px 12px',marginBottom:'1rem',fontSize:'13px',color:'#92400e'}}>
            ⚠️ Late will deduct <strong>120 minutes</strong> from permission balance this month.
          </div>
        )}

        <div><label>Note (optional)</label>
          <input value={note} onChange={e=>setNote(e.target.value)} placeholder="Any remarks..."/>
        </div>

        <div style={{display:'flex',gap:'8px',marginTop:'1.5rem',justifyContent:'flex-end'}}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>
            Save — {effectiveStatus.replace('+',' + ').toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Mark Attendance Tab (Date-wise) ────────────────────────────────────────
function TodayTab({ employees, records, onRefresh }) {
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [markEmp, setMarkEmp] = useState(null);
  const mo = selectedDate.slice(0,7);

  const dateRecs = records.filter(r => r.date === selectedDate);
  const byEmpId = Object.fromEntries(dateRecs.map(r => [r.empId, r]));

  const present = dateRecs.filter(r => r.status===STATUS.PRESENT || r.status===STATUS.PRESENT_PERMISSION).length;
  const absent = dateRecs.filter(r => r.status===STATUS.ABSENT).length;
  const late = dateRecs.filter(r => r.status===STATUS.LATE).length;
  const perm = dateRecs.filter(r => r.status===STATUS.PERMISSION || r.status===STATUS.PRESENT_PERMISSION).length;
  const unmarked = employees.length - dateRecs.length;

  return (
    <div>
      <div style={{marginBottom:'1rem'}}>
        <h1 style={{fontSize:'22px',fontWeight:'700'}}>Mark Attendance</h1>
      </div>

      {/* Date picker */}
      <div className="card" style={{marginBottom:'1.25rem',display:'flex',alignItems:'center',gap:'1rem',flexWrap:'wrap'}}>
        <div style={{flex:'1',minWidth:'180px'}}>
          <label>Select Date</label>
          <input type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)}
            max={todayStr()}/>
        </div>
        <div style={{marginTop:'18px',display:'flex',gap:'8px'}}>
          <button className="btn btn-outline" onClick={()=>setSelectedDate(todayStr())}>Today</button>
        </div>
        <div style={{marginTop:'18px'}}>
          <span style={{fontSize:'15px',fontWeight:600,color:'#1a56db'}}>
            {format(parseISO(selectedDate),'EEEE, dd MMMM yyyy')}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'10px',marginBottom:'1.5rem'}}>
        {[
          {label:'Present',value:present,color:'#065f46'},
          {label:'Absent',value:absent,color:'#991b1b'},
          {label:'Late',value:late,color:'#5b21b6'},
          {label:'Permission',value:perm,color:'#0c4a6e'},
          {label:'Not Marked',value:unmarked,color:'#6b7280'},
        ].map(s=>(
          <div key={s.label} className="stat-card">
            <div className="value" style={{color:s.color}}>{s.value}</div>
            <div className="label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Employees grouped by shift */}
      {SHIFTS.map(shift => {
        const shiftEmps = employees.filter(e=>(e.shiftId||'A')===shift.id);
        if (shiftEmps.length===0) return null;
        return (
          <div key={shift.id} style={{marginBottom:'1.5rem'}}>
            <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'8px'}}>
              <h3 style={{fontSize:'15px',fontWeight:'700'}}>{shift.label}</h3>
              <span style={{fontSize:'13px',color:'#6b7280'}}>{shift.display}</span>
              <span style={{fontSize:'12px',background:'#f3f4f6',padding:'2px 8px',borderRadius:'20px'}}>
                {shiftEmps.length} members
              </span>
            </div>
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead><tr>
                    <th>#</th><th>Name</th><th>Status</th>
                    <th>Perm Mins</th><th>Perm Balance</th><th>Leaves</th><th>Note</th><th>Action</th>
                  </tr></thead>
                  <tbody>
                    {shiftEmps.map((emp,i)=>{
                      const rec = byEmpId[emp.id];
                      const bal = getPermBalance(emp.id, mo, records);
                      const empMoRecs = records.filter(r=>r.empId===emp.id&&r.date.startsWith(mo));
                      const leavesUsed = empMoRecs.filter(r=>[STATUS.ABSENT,STATUS.LATE].includes(r.status)).length;
                      return (
                        <tr key={emp.id}>
                          <td style={{color:'#6b7280'}}>{i+1}</td>
                          <td style={{fontWeight:700,fontSize:'14px'}}>{emp.name}</td>
                          <td>{rec?<StatusBadge status={rec.status}/>:
                            <span style={{color:'#6b7280',fontSize:'13px'}}>— Not marked</span>}</td>
                          <td style={{fontSize:'13px'}}>
                            {rec && (rec.status===STATUS.PERMISSION||rec.status===STATUS.PRESENT_PERMISSION) && rec.permMins
                              ? `${rec.permMins} min` : '—'}
                          </td>
                          <td><PermDisplay left={bal.left}/></td>
                          <td>
                            <span style={{color:leavesUsed>=MAX_LEAVES?'#e02424':'#374151',
                              fontWeight:leavesUsed>=MAX_LEAVES?700:400,fontSize:'13px'}}>
                              {leavesUsed}/{MAX_LEAVES}{leavesUsed>=MAX_LEAVES&&' ⚠️'}
                            </span>
                          </td>
                          <td style={{fontSize:'12px',color:'#6b7280'}}>{rec?.note||'—'}</td>
                          <td>
                            <button className="btn btn-primary" style={{padding:'5px 12px',fontSize:'13px'}}
                              onClick={()=>setMarkEmp(emp)}>
                              {rec?'Edit':'Mark'}
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
          onSave={()=>{setMarkEmp(null);onRefresh();}}
          onClose={()=>setMarkEmp(null)}/>
      )}
    </div>
  );
}

// ── Employees Tab ─────────────────────────────────────────────────────────
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
                const leavesUsed = empRecs.filter(r=>[STATUS.ABSENT,STATUS.LATE].includes(r.status)).length;
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

// ── Calendar Tab ──────────────────────────────────────────────────────────
function CalendarTab({ employees, records }) {
  const [selEmp, setSelEmp] = useState('');
  const [viewDate, setViewDate] = useState(new Date());
  const mo = monthStr(viewDate);
  const emp = employees.find(e=>e.id===selEmp);
  const days = eachDayOfInterval({start:startOfMonth(viewDate),end:endOfMonth(viewDate)});
  const firstDay = getDay(startOfMonth(viewDate));
  const blanks = Array(firstDay).fill(null);
  const empRecs = records.filter(r=>r.empId===selEmp&&r.date.startsWith(mo));
  const byDate = Object.fromEntries(empRecs.map(r=>[r.date,r]));

  const present = empRecs.filter(r=>r.status===STATUS.PRESENT||r.status===STATUS.PRESENT_PERMISSION).length;
  const absent = empRecs.filter(r=>r.status===STATUS.ABSENT).length;
  const late = empRecs.filter(r=>r.status===STATUS.LATE).length;
  const perm = empRecs.filter(r=>r.status===STATUS.PERMISSION||r.status===STATUS.PRESENT_PERMISSION).length;
  const leavesUsed = absent+late;
  const bal = emp ? getPermBalance(emp.id, mo, records) : {left:120,totalUsed:0,permUsed:0,lateDeduction:0};

  // Calendar day color
  function getDayClass(rec) {
    if (!rec) return '';
    if (rec.status===STATUS.PRESENT) return 'present';
    if (rec.status===STATUS.PRESENT_PERMISSION) return 'present-perm';
    if (rec.status===STATUS.ABSENT) return 'absent';
    if (rec.status===STATUS.LATE) return 'late';
    if (rec.status===STATUS.PERMISSION) return 'permission';
    return '';
  }

  return (
    <div>
      <h1 style={{fontSize:'22px',fontWeight:'700',marginBottom:'1rem'}}>Calendar View</h1>
      <div className="card" style={{marginBottom:'1rem'}}>
        <div style={{display:'flex',gap:'1rem',alignItems:'center',flexWrap:'wrap'}}>
          <div style={{flex:'1',minWidth:'200px'}}>
            <label>Select Employee</label>
            <select value={selEmp} onChange={e=>setSelEmp(e.target.value)}>
              <option value="">— Choose employee —</option>
              {SHIFTS.map(s=>(
                <optgroup key={s.id} label={`${s.label} · ${s.display}`}>
                  {employees.filter(e=>(e.shiftId||'A')===s.id).map(e=>(
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginTop:'18px'}}>
            <button className="btn btn-outline" style={{padding:'8px'}}
              onClick={()=>setViewDate(d=>new Date(d.getFullYear(),d.getMonth()-1,1))}>←</button>
            <span style={{fontWeight:600,minWidth:'130px',textAlign:'center'}}>{format(viewDate,'MMMM yyyy')}</span>
            <button className="btn btn-outline" style={{padding:'8px'}}
              onClick={()=>setViewDate(d=>new Date(d.getFullYear(),d.getMonth()+1,1))}>→</button>
          </div>
        </div>
      </div>

      {selEmp&&emp&&(
        <>
          <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'10px',marginBottom:'1rem'}}>
            {[
              {label:'Present Days',value:present,color:'#065f46'},
              {label:'Absent',value:absent,color:'#991b1b'},
              {label:'Late',value:late,color:'#5b21b6'},
              {label:'Perm Days',value:perm,color:'#0c4a6e'},
              {label:`Leaves (${leavesUsed}/${MAX_LEAVES})`,value:leavesUsed,color:leavesUsed>=MAX_LEAVES?'#e02424':'#374151'},
              {label:'Perm Balance',value:<PermDisplay left={bal.left}/>,color:'#111'},
            ].map((s,i)=>(
              <div key={i} className="stat-card">
                <div className="value" style={{color:s.color,fontSize:'22px'}}>{s.value}</div>
                <div className="label">{s.label}</div>
              </div>
            ))}
          </div>

          {bal.left < 0 && (
            <div style={{background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:'8px',
              padding:'10px 14px',marginBottom:'1rem',fontSize:'13px',color:'#991b1b',fontWeight:600}}>
              🔴 Permission exceeded by {Math.abs(bal.left)} minutes this month!
              {bal.lateDeduction>0&&` (includes ${bal.lateDeduction} min deducted for ${late} late day${late>1?'s':''})`}
            </div>
          )}

          {leavesUsed>=MAX_LEAVES&&(
            <div className="alert alert-danger">⚠️ {emp.name} has used all {MAX_LEAVES} allowed leaves this month.</div>
          )}

          <div className="card">
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:'4px',marginBottom:'8px',textAlign:'center'}}>
              {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>(
                <div key={d} style={{fontSize:'12px',fontWeight:'600',color:'#6b7280',padding:'4px'}}>{d}</div>
              ))}
            </div>
            <div className="calendar-grid">
              {blanks.map((_,i)=><div key={`b${i}`} className="cal-day empty"/>)}
              {days.map(day=>{
                const ds = format(day,'yyyy-MM-dd');
                const rec = byDate[ds];
                const sun = isSunday(day);
                let cls='cal-day';
                if(sun) cls+=' sunday';
                else cls+=` ${getDayClass(rec)}`;
                if(isToday(day)) cls+=' today';
                const title = rec ? `${rec.status}${rec.permMins?' ('+rec.permMins+' min)':''}` : '';
                return (
                  <div key={ds} className={cls} title={title}>
                    {format(day,'d')}
                    {rec?.status===STATUS.PRESENT_PERMISSION&&
                      <span style={{fontSize:'7px',display:'block',lineHeight:1}}>P+P</span>}
                  </div>
                );
              })}
            </div>
            {/* Legend */}
            <div style={{display:'flex',gap:'10px',marginTop:'1rem',flexWrap:'wrap'}}>
              {[
                ['Present','#d1fae5','#065f46'],
                ['Present+Perm','#fef3c7','#92400e'],
                ['Absent','#fee2e2','#991b1b'],
                ['Late','#ede9fe','#5b21b6'],
                ['Permission','#e0f2fe','#0c4a6e'],
              ].map(([s,bg,color])=>(
                <div key={s} style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'12px'}}>
                  <span style={{width:'12px',height:'12px',borderRadius:'3px',background:bg,border:`1px solid ${color}33`,display:'inline-block'}}/>
                  <span style={{color:'#6b7280'}}>{s}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{marginTop:'1rem'}}>
            <h3 style={{fontSize:'15px',fontWeight:'600',marginBottom:'0.75rem'}}>Attendance Details</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Status</th><th>Perm Mins</th><th>Note</th></tr></thead>
                <tbody>
                  {empRecs.sort((a,b)=>a.date.localeCompare(b.date)).map(r=>(
                    <tr key={r.id}>
                      <td>{format(parseISO(r.date),'EEE, dd MMM')}</td>
                      <td><StatusBadge status={r.status}/></td>
                      <td style={{fontSize:'13px'}}>
                        {(r.status===STATUS.PERMISSION||r.status===STATUS.PRESENT_PERMISSION)&&r.permMins
                          ?<span style={{color:'#0891b2',fontWeight:600}}>−{r.permMins} min</span>:''}
                        {r.status===STATUS.LATE
                          ?<span style={{color:'#d97706',fontWeight:600}}>−{MAX_PERMISSION_MINS} min (late)</span>:''}
                        {r.status===STATUS.PRESENT||r.status===STATUS.ABSENT?'—':''}
                      </td>
                      <td style={{color:'#6b7280'}}>{r.note||'—'}</td>
                    </tr>
                  ))}
                  {empRecs.length===0&&(
                    <tr><td colSpan={4} style={{textAlign:'center',color:'#6b7280'}}>No records</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!selEmp&&(
        <div className="card" style={{textAlign:'center',padding:'3rem',color:'#6b7280'}}>
          Select an employee above to view their calendar
        </div>
      )}
    </div>
  );
}

// ── Report Tab ────────────────────────────────────────────────────────────
function ReportTab({ employees, records, onRefresh }) {
  const [reportMonth, setReportMonth] = useState(format(new Date(),'yyyy-MM'));
  const [deleting, setDeleting] = useState(false);
  const mo = reportMonth;
  const moRecs = records.filter(r=>r.date.startsWith(mo));

  const summary = employees.map(emp=>{
    const recs = moRecs.filter(r=>r.empId===emp.id);
    const present = recs.filter(r=>r.status===STATUS.PRESENT||r.status===STATUS.PRESENT_PERMISSION).length;
    const absent = recs.filter(r=>r.status===STATUS.ABSENT).length;
    const late = recs.filter(r=>r.status===STATUS.LATE).length;
    const perm = recs.filter(r=>r.status===STATUS.PERMISSION||r.status===STATUS.PRESENT_PERMISSION).length;
    const bal = getPermBalance(emp.id, mo, records);
    const leavesUsed = absent+late;
    return {emp, present, absent, late, perm, bal, leavesUsed};
  });

  async function handleDownloadAndDelete() {
    if (!confirm(`Download report for ${mo} and DELETE all data for that month?`)) return;
    exportCSV(employees, records, mo);
    setDeleting(true);
    try {
      const batch = writeBatch(db);
      moRecs.forEach(r=>batch.delete(doc(db,'attendance',r.id)));
      await batch.commit();
      alert(`✅ Report downloaded and ${moRecs.length} records deleted`);
      onRefresh();
    } catch(e) { alert('Error: '+e.message); }
    setDeleting(false);
  }

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1rem',flexWrap:'wrap',gap:'8px'}}>
        <h1 style={{fontSize:'22px',fontWeight:'700'}}>Monthly Report</h1>
        <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
          <input type="month" value={reportMonth} onChange={e=>setReportMonth(e.target.value)} style={{width:'160px'}}/>
          <button className="btn btn-outline" onClick={()=>exportCSV(employees,records,mo)}>⬇ Download CSV</button>
          <button className="btn btn-danger" onClick={handleDownloadAndDelete} disabled={deleting}>
            {deleting?'Deleting...':'⬇ Download + Delete Month'}
          </button>
        </div>
      </div>

      <div className="alert alert-warning">
        ⚠️ "Download + Delete Month" exports CSV then permanently deletes that month's data.
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>#</th><th>Employee</th><th>Shift</th><th>Present</th><th>Absent</th>
              <th>Late</th><th>Perm Days</th><th>Perm Used</th><th>Late Deduct</th><th>Perm Balance</th><th>Leaves</th><th>Status</th>
            </tr></thead>
            <tbody>
              {summary.map(({emp,present,absent,late,perm,bal,leavesUsed},i)=>(
                <tr key={emp.id}>
                  <td style={{color:'#6b7280'}}>{i+1}</td>
                  <td style={{fontWeight:600}}>{emp.name}</td>
                  <td><ShiftBadge shiftId={emp.shiftId}/></td>
                  <td style={{color:'#0e9f6e',fontWeight:600}}>{present}</td>
                  <td style={{color:'#e02424',fontWeight:600}}>{absent}</td>
                  <td style={{color:'#7c3aed',fontWeight:600}}>{late}</td>
                  <td style={{color:'#0891b2',fontWeight:600}}>{perm}</td>
                  <td style={{fontSize:'13px'}}>{bal.permUsed} min</td>
                  <td style={{fontSize:'13px',color:bal.lateDeduction>0?'#d97706':'#6b7280'}}>{bal.lateDeduction} min</td>
                  <td><PermDisplay left={bal.left}/></td>
                  <td style={{color:leavesUsed>=MAX_LEAVES?'#e02424':'#374151',fontWeight:leavesUsed>=MAX_LEAVES?700:400}}>
                    {leavesUsed}/{MAX_LEAVES}{leavesUsed>=MAX_LEAVES&&' ⚠️'}
                  </td>
                  <td>
                    {leavesUsed>=MAX_LEAVES
                      ?<span className="badge badge-absent">Exceeded</span>
                      :<span className="badge badge-present">OK</span>}
                  </td>
                </tr>
              ))}
              {employees.length===0&&(
                <tr><td colSpan={12} style={{textAlign:'center',color:'#6b7280',padding:'2rem'}}>No employees</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────
export default function Home() {
  const [tab, setTab] = useState('today');
  const [employees, setEmployees] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [empSnap, recSnap] = await Promise.all([
        getDocs(query(collection(db,'employees'),orderBy('createdAt','asc'))),
        getDocs(query(collection(db,'attendance'),orderBy('date','desc')))
      ]);
      setEmployees(empSnap.docs.map(d=>d.data()));
      setRecords(recSnap.docs.map(d=>d.data()));
    } catch(e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(()=>{fetchData();},[fetchData]);

  return (
    <>
      <Head>
        <title>AttendEase — Company Attendance</title>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
      </Head>
      <Nav tab={tab} setTab={setTab}/>
      <div className="container" style={{padding:'1.5rem 1rem'}}>
        {loading?(
          <div style={{textAlign:'center',padding:'4rem',color:'#6b7280'}}>Loading...</div>
        ):(
          <>
            {tab==='today'&&<TodayTab employees={employees} records={records} onRefresh={fetchData}/>}
            {tab==='employees'&&<EmployeesTab employees={employees} records={records} onRefresh={fetchData}/>}
            {tab==='calendar'&&<CalendarTab employees={employees} records={records}/>}
            {tab==='report'&&<ReportTab employees={employees} records={records} onRefresh={fetchData}/>}
          </>
        )}
      </div>
    </>
  );
}
