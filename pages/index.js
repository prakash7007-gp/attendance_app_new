import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import {
  collection, doc, setDoc, getDocs,
  deleteDoc, query, orderBy, writeBatch
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { format, startOfMonth, endOfMonth, eachDayOfInterval,
         getDaysInMonth, getDay, isToday, isSunday } from 'date-fns';

const MAX_LEAVES = 4;
const MAX_PERMISSION_MINS = 120;
const STATUS = { PRESENT: 'present', ABSENT: 'absent', LATE: 'late', PERMISSION: 'permission' };

const SHIFTS = [
  { id: 'A', label: 'Shift A', start: '09:00', end: '18:00', display: '9:00 AM – 6:00 PM' },
  { id: 'B', label: 'Shift B', start: '09:30', end: '18:30', display: '9:30 AM – 6:30 PM' },
  { id: 'C', label: 'Shift C', start: '10:00', end: '19:00', display: '10:00 AM – 7:00 PM' },
];

function todayStr() { return format(new Date(), 'yyyy-MM-dd'); }
function monthStr(d = new Date()) { return format(d, 'yyyy-MM'); }
function getShift(id) { return SHIFTS.find(s => s.id === id) || SHIFTS[0]; }

function exportCSV(employees, records, month) {
  const days = getDaysInMonth(new Date(month + '-01'));
  const header = ['Employee', 'Designation', 'Shift',
    ...Array.from({length: days}, (_, i) => String(i+1).padStart(2,'0')),
    'Present', 'Absent', 'Late', 'Permission Days', 'Total Leaves', 'Perm Mins Used', 'Perm Mins Left'
  ];
  const rows = employees.map(emp => {
    const empRecs = records.filter(r => r.empId === emp.id && r.date.startsWith(month));
    const byDate = Object.fromEntries(empRecs.map(r => [r.date.slice(8,10), r]));
    const dayCells = Array.from({length: days}, (_, i) => {
      const key = String(i+1).padStart(2,'0');
      const rec = byDate[key];
      if (!rec) return '-';
      if (rec.status === STATUS.PERMISSION) return `P(${rec.permMins}m)`;
      return rec.status.charAt(0).toUpperCase();
    });
    const present = empRecs.filter(r=>r.status===STATUS.PRESENT).length;
    const absent = empRecs.filter(r=>r.status===STATUS.ABSENT).length;
    const late = empRecs.filter(r=>r.status===STATUS.LATE).length;
    const perm = empRecs.filter(r=>r.status===STATUS.PERMISSION).length;
    const permMinsUsed = empRecs.filter(r=>r.status===STATUS.PERMISSION).reduce((s,r)=>s+(r.permMins||0),0);
    // Late also eats into permission balance: each late = 120 mins deducted
    const lateDeduction = late * MAX_PERMISSION_MINS;
    const totalPermUsed = permMinsUsed + lateDeduction;
    const permLeft = Math.max(0, MAX_PERMISSION_MINS - totalPermUsed);
    const leavesUsed = absent + late;
    return [emp.name, emp.designation||'', getShift(emp.shiftId).display,
            ...dayCells, present, absent, late, perm, leavesUsed, totalPermUsed, permLeft];
  });
  const csv = [header, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `attendance_${month}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ── Nav ───────────────────────────────────────────────────────────────────
function Nav({ tab, setTab }) {
  return (
    <nav className="nav">
      <div className="nav-inner">
        <span className="nav-brand">📋 AttendEase</span>
        <div className="nav-tabs">
          {[['today','Today'],['employees','Employees'],['calendar','Calendar'],['report','Report']].map(([key,label]) => (
            <button key={key} className={`nav-tab${tab===key?' active':''}`} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
      </div>
    </nav>
  );
}

function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

function ShiftBadge({ shiftId }) {
  const shift = getShift(shiftId);
  const colors = { A: '#1a56db', B: '#0891b2', C: '#7c3aed' };
  return (
    <span style={{fontSize:'11px',fontWeight:700,padding:'2px 8px',borderRadius:'20px',
      background: colors[shift.id]+'22', color: colors[shift.id]}}>
      {shift.label} · {shift.display}
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
function AttendanceModal({ emp, existing, onSave, onClose }) {
  const [status, setStatus] = useState(existing?.status||STATUS.PRESENT);
  const [permMins, setPermMins] = useState(existing?.permMins||'');
  const [note, setNote] = useState(existing?.note||'');
  const shift = getShift(emp.shiftId);

  const mins = Number(permMins)||0;
  const overLimit = status===STATUS.PERMISSION && mins > MAX_PERMISSION_MINS;
  const effectiveStatus = overLimit ? STATUS.LATE : status;

  async function save() {
    const finalMins = status===STATUS.PERMISSION ? mins : 0;
    const finalStatus = status===STATUS.PERMISSION && finalMins > MAX_PERMISSION_MINS ? STATUS.LATE : status;
    const recId = `${emp.id}_${todayStr()}`;
    await setDoc(doc(db,'attendance',recId), {
      id: recId, empId: emp.id, empName: emp.name,
      date: todayStr(), month: monthStr(),
      status: finalStatus, permMins: finalMins,
      note, shiftId: emp.shiftId||'A', markedAt: Date.now()
    });
    onSave();
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <h2>Mark Attendance — {emp.name}</h2>
        <div style={{display:'flex',gap:'8px',alignItems:'center',marginBottom:'1rem'}}>
          <span style={{fontSize:'13px',color:'#6b7280'}}>{todayStr()}</span>
          <ShiftBadge shiftId={emp.shiftId}/>
        </div>

        {/* Shift info box */}
        <div style={{background:'#f0f9ff',border:'1px solid #bae6fd',borderRadius:'8px',
          padding:'8px 12px',marginBottom:'1rem',fontSize:'13px',color:'#0c4a6e'}}>
          🕐 Shift: <strong>{shift.start}</strong> to <strong>{shift.end}</strong> &nbsp;|&nbsp;
          Permission limit: <strong>120 min/month</strong> &nbsp;|&nbsp;
          Late also reduces permission balance
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'1rem'}}>
          {Object.values(STATUS).map(s => (
            <button key={s} onClick={()=>setStatus(s)}
              style={{padding:'12px',borderRadius:'8px',border:`2px solid ${status===s?'#1a56db':'#e5e7eb'}`,
                background:status===s?'#eff6ff':'white',cursor:'pointer',fontWeight:600,
                fontSize:'14px',textTransform:'capitalize',color:status===s?'#1a56db':'#111'}}>
              {s===STATUS.PRESENT&&'✅'}{s===STATUS.ABSENT&&'❌'}{s===STATUS.LATE&&'⏰'}{s===STATUS.PERMISSION&&'🕐'}
              &nbsp;{s}
            </button>
          ))}
        </div>

        {status===STATUS.LATE && (
          <div style={{background:'#fef3c7',border:'1px solid #fcd34d',borderRadius:'8px',
            padding:'8px 12px',marginBottom:'1rem',fontSize:'13px',color:'#92400e'}}>
            ⚠️ Late arrival will deduct <strong>120 minutes</strong> from this employee's permission balance this month.
          </div>
        )}

        {status===STATUS.PERMISSION && (
          <div style={{marginBottom:'1rem'}}>
            <label>Permission Duration (minutes)</label>
            <input type="number" value={permMins} onChange={e=>setPermMins(e.target.value)}
              placeholder="e.g. 60" min="1" max="480"/>
            {overLimit && (
              <p style={{color:'#e02424',fontSize:'12px',marginTop:'4px'}}>
                ⚠️ Over 120 mins — will be marked as <strong>Late</strong> (deducts 120 min from balance)
              </p>
            )}
            {mins>0 && !overLimit && (
              <p style={{color:'#0e9f6e',fontSize:'12px',marginTop:'4px'}}>✓ Within allowed limit</p>
            )}
          </div>
        )}

        <div><label>Note (optional)</label><input value={note} onChange={e=>setNote(e.target.value)} placeholder="Any remarks..."/></div>

        <div style={{display:'flex',gap:'8px',marginTop:'1.5rem',justifyContent:'flex-end'}}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save — {effectiveStatus.toUpperCase()}</button>
        </div>
      </div>
    </div>
  );
}

// ── Permission Balance Helper ──────────────────────────────────────────────
function getPermBalance(empId, month, records) {
  const recs = records.filter(r => r.empId===empId && r.date.startsWith(month));
  const permUsed = recs.filter(r=>r.status===STATUS.PERMISSION).reduce((s,r)=>s+(r.permMins||0),0);
  const lateDeduction = recs.filter(r=>r.status===STATUS.LATE).length * MAX_PERMISSION_MINS;
  const totalUsed = permUsed + lateDeduction;
  const left = Math.max(0, MAX_PERMISSION_MINS - totalUsed);
  return { totalUsed, left, permUsed, lateDeduction };
}

// ── Today Tab ─────────────────────────────────────────────────────────────
function TodayTab({ employees, records, onRefresh }) {
  const [markEmp, setMarkEmp] = useState(null);
  const today = todayStr();
  const mo = monthStr();
  const todayRecs = records.filter(r=>r.date===today);
  const byEmpId = Object.fromEntries(todayRecs.map(r=>[r.empId,r]));

  const present = todayRecs.filter(r=>r.status===STATUS.PRESENT).length;
  const absent = todayRecs.filter(r=>r.status===STATUS.ABSENT).length;
  const late = todayRecs.filter(r=>r.status===STATUS.LATE).length;
  const perm = todayRecs.filter(r=>r.status===STATUS.PERMISSION).length;
  const unmarked = employees.length - todayRecs.length;

  return (
    <div>
      <div style={{marginBottom:'1rem'}}>
        <h1 style={{fontSize:'22px',fontWeight:'700'}}>Today's Attendance</h1>
        <p style={{color:'#6b7280',fontSize:'14px'}}>{format(new Date(),'EEEE, dd MMMM yyyy')}</p>
      </div>

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

      {/* Group by shift */}
      {SHIFTS.map(shift => {
        const shiftEmps = employees.filter(e=>(e.shiftId||'A')===shift.id);
        if (shiftEmps.length===0) return null;
        return (
          <div key={shift.id} style={{marginBottom:'1.5rem'}}>
            <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'8px'}}>
              <h3 style={{fontSize:'15px',fontWeight:'700'}}>{shift.label}</h3>
              <span style={{fontSize:'13px',color:'#6b7280'}}>{shift.display}</span>
              <span style={{fontSize:'12px',background:'#f3f4f6',padding:'2px 8px',borderRadius:'20px',color:'#374151'}}>
                {shiftEmps.length} members
              </span>
            </div>
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead><tr>
                    <th>#</th><th>Name</th><th>Designation</th>
                    <th>Status</th><th>Perm Left</th><th>Leaves</th><th>Action</th>
                  </tr></thead>
                  <tbody>
                    {shiftEmps.map((emp,i) => {
                      const rec = byEmpId[emp.id];
                      const bal = getPermBalance(emp.id, mo, records);
                      const empMoRecs = records.filter(r=>r.empId===emp.id&&r.date.startsWith(mo));
                      const leavesUsed = empMoRecs.filter(r=>[STATUS.ABSENT,STATUS.LATE].includes(r.status)).length;
                      const overLeave = leavesUsed >= MAX_LEAVES;
                      return (
                        <tr key={emp.id}>
                          <td style={{color:'#6b7280'}}>{i+1}</td>
                          <td style={{fontWeight:600}}>{emp.name}</td>
                          <td style={{color:'#6b7280'}}>{emp.designation||'—'}</td>
                          <td>{rec?<StatusBadge status={rec.status}/>:<span style={{color:'#6b7280',fontSize:'13px'}}>—</span>}</td>
                          <td>
                            <span style={{fontSize:'13px',fontWeight:600,color:bal.left===0?'#e02424':bal.left<60?'#d97706':'#0e9f6e'}}>
                              {bal.left} min
                            </span>
                            {bal.lateDeduction>0&&<span style={{fontSize:'11px',color:'#6b7280',display:'block'}}>(-{bal.lateDeduction}m late)</span>}
                          </td>
                          <td>
                            <span style={{color:overLeave?'#e02424':'#374151',fontWeight:overLeave?700:400,fontSize:'13px'}}>
                              {leavesUsed}/{MAX_LEAVES}
                              {overLeave&&' ⚠️'}
                            </span>
                          </td>
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
          onSave={()=>{setMarkEmp(null);onRefresh();}} onClose={()=>setMarkEmp(null)}/>
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

      {/* Shift summary */}
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
              <th>#</th><th>Name</th><th>Shift</th><th>Designation</th><th>Phone</th>
              <th>Leaves</th><th>Perm Left</th><th>Actions</th>
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
                    <td style={{color:'#6b7280'}}>{emp.phone||'—'}</td>
                    <td style={{color:leavesUsed>=MAX_LEAVES?'#e02424':'#374151',fontWeight:leavesUsed>=MAX_LEAVES?700:400}}>
                      {leavesUsed}/{MAX_LEAVES}{leavesUsed>=MAX_LEAVES&&' ⚠️'}
                    </td>
                    <td style={{color:bal.left===0?'#e02424':bal.left<60?'#d97706':'#0e9f6e',fontWeight:600,fontSize:'13px'}}>
                      {bal.left} min
                    </td>
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
                <tr><td colSpan={8} style={{textAlign:'center',color:'#6b7280',padding:'2rem'}}>No employees yet. Add your first employee!</td></tr>
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

  const present = empRecs.filter(r=>r.status===STATUS.PRESENT).length;
  const absent = empRecs.filter(r=>r.status===STATUS.ABSENT).length;
  const late = empRecs.filter(r=>r.status===STATUS.LATE).length;
  const perm = empRecs.filter(r=>r.status===STATUS.PERMISSION).length;
  const leavesUsed = absent+late;
  const bal = emp ? getPermBalance(emp.id, mo, records) : {left:120,totalUsed:0,permUsed:0,lateDeduction:0};

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
              {label:'Present',value:present,color:'#065f46'},
              {label:'Absent',value:absent,color:'#991b1b'},
              {label:'Late',value:late,color:'#5b21b6'},
              {label:'Permission Days',value:perm,color:'#0c4a6e'},
              {label:`Leaves (${leavesUsed}/${MAX_LEAVES})`,value:leavesUsed,color:leavesUsed>=MAX_LEAVES?'#e02424':'#374151'},
              {label:'Perm Mins Left',value:`${bal.left}m`,color:bal.left===0?'#e02424':bal.left<60?'#d97706':'#0e9f6e'},
            ].map(s=>(
              <div key={s.label} className="stat-card">
                <div className="value" style={{color:s.color,fontSize:typeof s.value==='string'?'20px':'28px'}}>{s.value}</div>
                <div className="label">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Permission balance breakdown */}
          {(bal.permUsed>0||bal.lateDeduction>0)&&(
            <div style={{background:'#fef3c7',border:'1px solid #fcd34d',borderRadius:'8px',
              padding:'10px 14px',marginBottom:'1rem',fontSize:'13px',color:'#92400e'}}>
              📊 Permission balance: 120 min total
              {bal.permUsed>0&&<span> — {bal.permUsed} min used for permission days</span>}
              {bal.lateDeduction>0&&<span> — {bal.lateDeduction} min deducted for {late} late day(s)</span>}
              &nbsp;= <strong>{bal.left} min remaining</strong>
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
                else if(rec) cls+=` ${rec.status}`;
                if(isToday(day)) cls+=' today';
                return (
                  <div key={ds} className={cls} title={rec?`${rec.status}${rec.permMins?' ('+rec.permMins+' min)':''}`:''}>
                    {format(day,'d')}
                  </div>
                );
              })}
            </div>
            <div style={{display:'flex',gap:'12px',marginTop:'1rem',flexWrap:'wrap'}}>
              {[['present','#d1fae5','#065f46'],['absent','#fee2e2','#991b1b'],
                ['late','#ede9fe','#5b21b6'],['permission','#e0f2fe','#0c4a6e']].map(([s,bg,color])=>(
                <div key={s} style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'13px'}}>
                  <span style={{width:'14px',height:'14px',borderRadius:'3px',background:bg,display:'inline-block'}}/>
                  <span style={{color:'#6b7280',textTransform:'capitalize'}}>{s}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{marginTop:'1rem'}}>
            <h3 style={{fontSize:'15px',fontWeight:'600',marginBottom:'0.75rem'}}>Month Details</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Status</th><th>Permission Mins</th><th>Note</th></tr></thead>
                <tbody>
                  {empRecs.sort((a,b)=>a.date.localeCompare(b.date)).map(r=>(
                    <tr key={r.id}>
                      <td>{format(new Date(r.date),'EEE, dd MMM')}</td>
                      <td><StatusBadge status={r.status}/></td>
                      <td style={{fontSize:'13px'}}>
                        {r.status===STATUS.PERMISSION&&r.permMins?`${r.permMins} min`:''}
                        {r.status===STATUS.LATE?<span style={{color:'#d97706',fontSize:'12px'}}>-120 min (late deduction)</span>:''}
                        {r.status===STATUS.PRESENT||r.status===STATUS.ABSENT?'—':''}
                      </td>
                      <td style={{color:'#6b7280'}}>{r.note||'—'}</td>
                    </tr>
                  ))}
                  {empRecs.length===0&&(
                    <tr><td colSpan={4} style={{textAlign:'center',color:'#6b7280'}}>No records for this month</td></tr>
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
    const present = recs.filter(r=>r.status===STATUS.PRESENT).length;
    const absent = recs.filter(r=>r.status===STATUS.ABSENT).length;
    const late = recs.filter(r=>r.status===STATUS.LATE).length;
    const perm = recs.filter(r=>r.status===STATUS.PERMISSION).length;
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
      alert(`✅ Report downloaded and ${moRecs.length} records deleted for ${mo}`);
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
        ⚠️ "Download + Delete Month" will export CSV and permanently delete all attendance data for that month.
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>#</th><th>Employee</th><th>Shift</th><th>Present</th><th>Absent</th>
              <th>Late</th><th>Perm Days</th><th>Perm Used</th><th>Late Deduct</th><th>Perm Left</th><th>Leaves</th><th>Status</th>
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
                  <td style={{fontWeight:600,color:bal.left===0?'#e02424':bal.left<60?'#d97706':'#0e9f6e'}}>{bal.left} min</td>
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
                <tr><td colSpan={12} style={{textAlign:'center',color:'#6b7280',padding:'2rem'}}>No employees yet</td></tr>
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
