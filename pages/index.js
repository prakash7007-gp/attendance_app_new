import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import {
  collection, doc, setDoc, getDoc, getDocs, deleteDoc,
  query, where, orderBy, writeBatch
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { format, startOfMonth, endOfMonth, eachDayOfInterval,
         getDaysInMonth, getDay, isToday, isSunday } from 'date-fns';

// ── Constants ──────────────────────────────────────────────────────────────
const MAX_LEAVES = 4;
const MAX_PERMISSION_MINS = 120;
const STATUS = { PRESENT: 'present', ABSENT: 'absent', LATE: 'late', PERMISSION: 'permission' };

// ── Helpers ────────────────────────────────────────────────────────────────
function todayStr() { return format(new Date(), 'yyyy-MM-dd'); }
function monthStr(d = new Date()) { return format(d, 'yyyy-MM'); }

function exportCSV(employees, records, month) {
  const days = getDaysInMonth(new Date(month + '-01'));
  const header = ['Employee', 'Designation',
    ...Array.from({length: days}, (_, i) => `${String(i+1).padStart(2,'0')}`),
    'Present', 'Absent', 'Late', 'Permission', 'Total Leave', 'Permission Mins'
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
    const present = empRecs.filter(r => r.status === STATUS.PRESENT).length;
    const absent = empRecs.filter(r => r.status === STATUS.ABSENT).length;
    const late = empRecs.filter(r => r.status === STATUS.LATE).length;
    const perm = empRecs.filter(r => r.status === STATUS.PERMISSION).length;
    const leaves = absent + late;
    const permMins = empRecs.filter(r => r.status === STATUS.PERMISSION)
                             .reduce((s,r) => s + (r.permMins||0), 0);
    return [emp.name, emp.designation || '', ...dayCells,
            present, absent, late, perm, leaves, permMins];
  });

  const csv = [header, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `attendance_${month}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Components ─────────────────────────────────────────────────────────────
function Nav({ tab, setTab }) {
  return (
    <nav className="nav">
      <div className="nav-inner">
        <span className="nav-brand">📋 AttendEase</span>
        <div className="nav-tabs">
          {[['today','Today'],['employees','Employees'],['calendar','Calendar'],['report','Report']].map(([key,label]) => (
            <button key={key} className={`nav-tab${tab===key?' active':''}`} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}

function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

// ── Add/Edit Employee Modal ────────────────────────────────────────────────
function EmployeeModal({ emp, onSave, onClose }) {
  const [form, setForm] = useState({ name: emp?.name||'', designation: emp?.designation||'', phone: emp?.phone||'' });
  const set = (k, v) => setForm(f => ({...f, [k]: v}));

  async function save() {
    if (!form.name.trim()) return alert('Name is required');
    const id = emp?.id || `emp_${Date.now()}`;
    await setDoc(doc(db, 'employees', id), { ...form, id, createdAt: emp?.createdAt || Date.now() });
    onSave();
  }

  return (
    <div className="modal-overlay" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal">
        <h2>{emp ? 'Edit Employee' : 'Add Employee'}</h2>
        <div style={{display:'flex',flexDirection:'column',gap:'1rem'}}>
          <div><label>Full Name *</label><input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="e.g. Rajan Kumar"/></div>
          <div><label>Designation</label><input value={form.designation} onChange={e=>set('designation',e.target.value)} placeholder="e.g. Sales Executive"/></div>
          <div><label>Phone</label><input value={form.phone} onChange={e=>set('phone',e.target.value)} placeholder="e.g. 9876543210"/></div>
        </div>
        <div style={{display:'flex',gap:'8px',marginTop:'1.5rem',justifyContent:'flex-end'}}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>{emp ? 'Update' : 'Add Employee'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Mark Attendance Modal ─────────────────────────────────────────────────
function AttendanceModal({ emp, existing, onSave, onClose }) {
  const [status, setStatus] = useState(existing?.status || STATUS.PRESENT);
  const [permMins, setPermMins] = useState(existing?.permMins || '');
  const [note, setNote] = useState(existing?.note || '');

  const effectiveStatus = status === STATUS.PERMISSION && Number(permMins) > MAX_PERMISSION_MINS
    ? STATUS.LATE : status;

  async function save() {
    const mins = status === STATUS.PERMISSION ? Number(permMins)||0 : 0;
    const finalStatus = status === STATUS.PERMISSION && mins > MAX_PERMISSION_MINS
      ? STATUS.LATE : status;
    const recId = `${emp.id}_${todayStr()}`;
    await setDoc(doc(db, 'attendance', recId), {
      id: recId, empId: emp.id, empName: emp.name,
      date: todayStr(), month: monthStr(),
      status: finalStatus,
      permMins: mins, note,
      markedAt: Date.now()
    });
    onSave();
  }

  return (
    <div className="modal-overlay" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Mark Attendance — {emp.name}</h2>
        <p style={{color:'var(--text-muted)',fontSize:'14px',marginBottom:'1rem'}}>{todayStr()}</p>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'1rem'}}>
          {Object.values(STATUS).map(s => (
            <button key={s} onClick={() => setStatus(s)}
              style={{padding:'12px',borderRadius:'8px',border:`2px solid ${status===s?'var(--primary)':'var(--border)'}`,
                background:status===s?'#eff6ff':'white',cursor:'pointer',fontWeight:600,
                fontSize:'14px',textTransform:'capitalize',color:status===s?'var(--primary)':'var(--text)'}}>
              {s === STATUS.PRESENT && '✅'} {s === STATUS.ABSENT && '❌'} {s === STATUS.LATE && '⏰'} {s === STATUS.PERMISSION && '🕐'}
              &nbsp;{s}
            </button>
          ))}
        </div>

        {status === STATUS.PERMISSION && (
          <div style={{marginBottom:'1rem'}}>
            <label>Permission Duration (minutes)</label>
            <input type="number" value={permMins} onChange={e=>setPermMins(e.target.value)} placeholder="e.g. 60" min="1" max="480"/>
            {Number(permMins) > MAX_PERMISSION_MINS && (
              <p style={{color:'var(--danger)',fontSize:'12px',marginTop:'4px'}}>
                ⚠️ Over 120 mins — will be marked as <strong>Late</strong>
              </p>
            )}
            {Number(permMins) > 0 && Number(permMins) <= MAX_PERMISSION_MINS && (
              <p style={{color:'var(--success)',fontSize:'12px',marginTop:'4px'}}>✓ Within allowed limit</p>
            )}
          </div>
        )}

        <div><label>Note (optional)</label><input value={note} onChange={e=>setNote(e.target.value)} placeholder="Any remarks..."/></div>

        <div style={{display:'flex',gap:'8px',marginTop:'1.5rem',justifyContent:'flex-end'}}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>
            Save — {effectiveStatus.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Today Tab ─────────────────────────────────────────────────────────────
function TodayTab({ employees, records, onRefresh }) {
  const [markEmp, setMarkEmp] = useState(null);
  const today = todayStr();
  const todayRecs = records.filter(r => r.date === today);
  const byEmpId = Object.fromEntries(todayRecs.map(r => [r.empId, r]));

  // Stats
  const present = todayRecs.filter(r => r.status===STATUS.PRESENT).length;
  const absent = todayRecs.filter(r => r.status===STATUS.ABSENT).length;
  const late = todayRecs.filter(r => r.status===STATUS.LATE).length;
  const perm = todayRecs.filter(r => r.status===STATUS.PERMISSION).length;
  const unmarked = employees.length - todayRecs.length;

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1rem'}}>
        <div>
          <h1 style={{fontSize:'22px',fontWeight:'700'}}>Today's Attendance</h1>
          <p style={{color:'var(--text-muted)',fontSize:'14px'}}>{format(new Date(),'EEEE, dd MMMM yyyy')}</p>
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
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className="value" style={{color:s.color}}>{s.value}</div>
            <div className="label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Employees list */}
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>#</th><th>Name</th><th>Designation</th>
              <th>Status</th><th>Permission</th><th>Note</th><th>Action</th>
            </tr></thead>
            <tbody>
              {employees.map((emp, i) => {
                const rec = byEmpId[emp.id];
                // Count this month's leaves
                const mo = monthStr();
                const empMoRecs = records.filter(r => r.empId===emp.id && r.date.startsWith(mo));
                const leavesUsed = empMoRecs.filter(r => r.status===STATUS.ABSENT||r.status===STATUS.LATE).length;
                const overLimit = leavesUsed >= MAX_LEAVES;
                return (
                  <tr key={emp.id}>
                    <td style={{color:'var(--text-muted)'}}>{i+1}</td>
                    <td style={{fontWeight:600}}>{emp.name}</td>
                    <td style={{color:'var(--text-muted)'}}>{emp.designation||'—'}</td>
                    <td>{rec ? <StatusBadge status={rec.status}/> : <span style={{color:'var(--text-muted)',fontSize:'13px'}}>—</span>}</td>
                    <td style={{fontSize:'13px'}}>{rec?.status===STATUS.PERMISSION ? `${rec.permMins} min` : '—'}</td>
                    <td style={{fontSize:'13px',color:'var(--text-muted)'}}>{rec?.note||'—'}</td>
                    <td>
                      <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                        <button className="btn btn-primary" style={{padding:'5px 12px',fontSize:'13px'}}
                          onClick={() => setMarkEmp(emp)}>
                          {rec ? 'Edit' : 'Mark'}
                        </button>
                        {overLimit && !rec && (
                          <span style={{fontSize:'11px',color:'var(--danger)',fontWeight:600}}>⚠️ Limit</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {markEmp && (
        <AttendanceModal
          emp={markEmp}
          existing={byEmpId[markEmp.id]}
          onSave={() => { setMarkEmp(null); onRefresh(); }}
          onClose={() => setMarkEmp(null)}
        />
      )}
    </div>
  );
}

// ── Employees Tab ─────────────────────────────────────────────────────────
function EmployeesTab({ employees, records, onRefresh }) {
  const [modal, setModal] = useState(null); // null | 'add' | emp object
  const mo = monthStr();

  async function deleteEmp(emp) {
    if (!confirm(`Delete ${emp.name}? This will not delete their attendance records.`)) return;
    await deleteDoc(doc(db, 'employees', emp.id));
    onRefresh();
  }

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1rem'}}>
        <h1 style={{fontSize:'22px',fontWeight:'700'}}>Employees ({employees.length})</h1>
        <button className="btn btn-primary" onClick={() => setModal('add')}>+ Add Employee</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>#</th><th>Name</th><th>Designation</th><th>Phone</th>
              <th>This Month Leaves</th><th>Perm. Used</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {employees.map((emp, i) => {
                const empRecs = records.filter(r => r.empId===emp.id && r.date.startsWith(mo));
                const leavesUsed = empRecs.filter(r => [STATUS.ABSENT,STATUS.LATE].includes(r.status)).length;
                const permMins = empRecs.filter(r => r.status===STATUS.PERMISSION).reduce((s,r)=>s+(r.permMins||0),0);
                const overLeave = leavesUsed >= MAX_LEAVES;
                return (
                  <tr key={emp.id}>
                    <td style={{color:'var(--text-muted)'}}>{i+1}</td>
                    <td style={{fontWeight:600}}>{emp.name}</td>
                    <td style={{color:'var(--text-muted)'}}>{emp.designation||'—'}</td>
                    <td style={{color:'var(--text-muted)'}}>{emp.phone||'—'}</td>
                    <td>
                      <span style={{color:overLeave?'var(--danger)':'var(--text)',fontWeight:overLeave?700:400}}>
                        {leavesUsed}/{MAX_LEAVES}
                      </span>
                      {overLeave && <span style={{marginLeft:'6px',fontSize:'12px',color:'var(--danger)'}}>⚠️ Exceeded</span>}
                    </td>
                    <td style={{fontSize:'13px'}}>{permMins} min</td>
                    <td>
                      <div style={{display:'flex',gap:'6px'}}>
                        <button className="btn btn-outline" style={{padding:'5px 10px',fontSize:'13px'}} onClick={() => setModal(emp)}>Edit</button>
                        <button className="btn btn-danger" style={{padding:'5px 10px',fontSize:'13px'}} onClick={() => deleteEmp(emp)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {employees.length === 0 && (
                <tr><td colSpan={7} style={{textAlign:'center',color:'var(--text-muted)',padding:'2rem'}}>No employees yet. Add your first employee!</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <EmployeeModal
          emp={modal === 'add' ? null : modal}
          onSave={() => { setModal(null); onRefresh(); }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

// ── Calendar Tab ──────────────────────────────────────────────────────────
function CalendarTab({ employees, records }) {
  const [selEmp, setSelEmp] = useState('');
  const [viewDate, setViewDate] = useState(new Date());
  const mo = monthStr(viewDate);
  const emp = employees.find(e => e.id === selEmp);

  const days = eachDayOfInterval({ start: startOfMonth(viewDate), end: endOfMonth(viewDate) });
  const firstDay = getDay(startOfMonth(viewDate)); // 0=Sun
  const blanks = Array(firstDay).fill(null);

  const empRecs = records.filter(r => r.empId === selEmp && r.date.startsWith(mo));
  const byDate = Object.fromEntries(empRecs.map(r => [r.date, r]));

  const present = empRecs.filter(r=>r.status===STATUS.PRESENT).length;
  const absent = empRecs.filter(r=>r.status===STATUS.ABSENT).length;
  const late = empRecs.filter(r=>r.status===STATUS.LATE).length;
  const perm = empRecs.filter(r=>r.status===STATUS.PERMISSION).length;
  const permTotal = empRecs.filter(r=>r.status===STATUS.PERMISSION).reduce((s,r)=>s+(r.permMins||0),0);
  const leavesUsed = absent + late;

  function prevMonth() { setViewDate(d => new Date(d.getFullYear(), d.getMonth()-1, 1)); }
  function nextMonth() { setViewDate(d => new Date(d.getFullYear(), d.getMonth()+1, 1)); }

  return (
    <div>
      <h1 style={{fontSize:'22px',fontWeight:'700',marginBottom:'1rem'}}>Calendar View</h1>

      <div className="card" style={{marginBottom:'1rem'}}>
        <div style={{display:'flex',gap:'1rem',alignItems:'center',flexWrap:'wrap'}}>
          <div style={{flex:'1',minWidth:'200px'}}>
            <label>Select Employee</label>
            <select value={selEmp} onChange={e=>setSelEmp(e.target.value)}>
              <option value="">— Choose employee —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginTop:'18px'}}>
            <button className="btn btn-outline" style={{padding:'8px'}} onClick={prevMonth}>←</button>
            <span style={{fontWeight:600,minWidth:'130px',textAlign:'center'}}>{format(viewDate,'MMMM yyyy')}</span>
            <button className="btn btn-outline" style={{padding:'8px'}} onClick={nextMonth}>→</button>
          </div>
        </div>
      </div>

      {selEmp && emp && (
        <>
          {/* Stats row */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'10px',marginBottom:'1rem'}}>
            {[
              {label:'Present',value:present,color:'#065f46'},
              {label:'Absent',value:absent,color:'#991b1b'},
              {label:'Late',value:late,color:'#5b21b6'},
              {label:'Permission',value:perm,color:'#0c4a6e'},
              {label:`Leaves (${leavesUsed}/${MAX_LEAVES})`,value:leavesUsed,color:leavesUsed>=MAX_LEAVES?'var(--danger)':'#374151'},
            ].map(s=>(
              <div key={s.label} className="stat-card">
                <div className="value" style={{color:s.color}}>{s.value}</div>
                <div className="label">{s.label}</div>
              </div>
            ))}
          </div>

          {leavesUsed >= MAX_LEAVES && (
            <div className="alert alert-danger">⚠️ {emp.name} has used all {MAX_LEAVES} allowed leaves this month.</div>
          )}

          {/* Calendar */}
          <div className="card">
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:'4px',marginBottom:'8px',textAlign:'center'}}>
              {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>(
                <div key={d} style={{fontSize:'12px',fontWeight:'600',color:'var(--text-muted)',padding:'4px'}}>{d}</div>
              ))}
            </div>
            <div className="calendar-grid">
              {blanks.map((_,i)=><div key={`b${i}`} className="cal-day empty"/>)}
              {days.map(day => {
                const ds = format(day,'yyyy-MM-dd');
                const rec = byDate[ds];
                const sun = isSunday(day);
                let cls = 'cal-day';
                if (sun) cls += ' sunday';
                else if (rec) cls += ` ${rec.status}`;
                if (isToday(day)) cls += ' today';
                return (
                  <div key={ds} className={cls} title={rec ? `${rec.status}${rec.permMins?' ('+rec.permMins+' min)':''}` : ''}>
                    {format(day,'d')}
                  </div>
                );
              })}
            </div>
            {/* Legend */}
            <div style={{display:'flex',gap:'12px',marginTop:'1rem',flexWrap:'wrap'}}>
              {[['present','#d1fae5','#065f46'],['absent','#fee2e2','#991b1b'],
                ['late','#ede9fe','#5b21b6'],['permission','#e0f2fe','#0c4a6e']].map(([s,bg,color])=>(
                <div key={s} style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'13px'}}>
                  <span style={{width:'14px',height:'14px',borderRadius:'3px',background:bg,display:'inline-block'}}/>
                  <span style={{color:'var(--text-muted)',textTransform:'capitalize'}}>{s}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Detail table */}
          <div className="card" style={{marginTop:'1rem'}}>
            <h3 style={{fontSize:'15px',fontWeight:'600',marginBottom:'0.75rem'}}>Month Details</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Status</th><th>Permission</th><th>Note</th></tr></thead>
                <tbody>
                  {empRecs.sort((a,b)=>a.date.localeCompare(b.date)).map(r=>(
                    <tr key={r.id}>
                      <td>{format(new Date(r.date),'EEE, dd MMM')}</td>
                      <td><StatusBadge status={r.status}/></td>
                      <td>{r.permMins?`${r.permMins} min`:'—'}</td>
                      <td style={{color:'var(--text-muted)'}}>{r.note||'—'}</td>
                    </tr>
                  ))}
                  {empRecs.length === 0 && (
                    <tr><td colSpan={4} style={{textAlign:'center',color:'var(--text-muted)'}}>No records for this month</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!selEmp && (
        <div className="card" style={{textAlign:'center',padding:'3rem',color:'var(--text-muted)'}}>
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
  const moRecs = records.filter(r => r.date.startsWith(mo));

  // Summary per employee
  const summary = employees.map(emp => {
    const recs = moRecs.filter(r => r.empId === emp.id);
    const present = recs.filter(r=>r.status===STATUS.PRESENT).length;
    const absent = recs.filter(r=>r.status===STATUS.ABSENT).length;
    const late = recs.filter(r=>r.status===STATUS.LATE).length;
    const perm = recs.filter(r=>r.status===STATUS.PERMISSION).length;
    const permMins = recs.filter(r=>r.status===STATUS.PERMISSION).reduce((s,r)=>s+(r.permMins||0),0);
    const leavesUsed = absent + late;
    return { emp, present, absent, late, perm, permMins, leavesUsed };
  });

  async function handleDownloadAndDelete() {
    if (!confirm(`Download report for ${mo} and then DELETE all data for that month?`)) return;
    exportCSV(employees, records, mo);
    setDeleting(true);
    try {
      const batch = writeBatch(db);
      const toDelete = moRecs;
      toDelete.forEach(r => batch.delete(doc(db, 'attendance', r.id)));
      await batch.commit();
      alert(`✅ Report downloaded and ${toDelete.length} records deleted for ${mo}`);
      onRefresh();
    } catch(e) {
      alert('Error deleting: ' + e.message);
    }
    setDeleting(false);
  }

  function handleDownloadOnly() {
    exportCSV(employees, records, mo);
  }

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1rem',flexWrap:'wrap',gap:'8px'}}>
        <h1 style={{fontSize:'22px',fontWeight:'700'}}>Monthly Report</h1>
        <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
          <input type="month" value={reportMonth} onChange={e=>setReportMonth(e.target.value)}
            style={{width:'160px'}}/>
          <button className="btn btn-outline" onClick={handleDownloadOnly}>⬇ Download CSV</button>
          <button className="btn btn-danger" onClick={handleDownloadAndDelete} disabled={deleting}>
            {deleting ? 'Deleting...' : '⬇ Download + Delete Month'}
          </button>
        </div>
      </div>

      <div className="alert alert-warning">
        ⚠️ "Download + Delete Month" will export the CSV report and permanently delete all attendance data for that month from the database.
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>#</th><th>Employee</th><th>Designation</th>
              <th>Present</th><th>Absent</th><th>Late</th><th>Permission</th>
              <th>Perm. Mins</th><th>Leaves Used</th><th>Status</th>
            </tr></thead>
            <tbody>
              {summary.map(({emp,present,absent,late,perm,permMins,leavesUsed},i)=>(
                <tr key={emp.id}>
                  <td style={{color:'var(--text-muted)'}}>{i+1}</td>
                  <td style={{fontWeight:600}}>{emp.name}</td>
                  <td style={{color:'var(--text-muted)'}}>{emp.designation||'—'}</td>
                  <td style={{color:'var(--success)',fontWeight:600}}>{present}</td>
                  <td style={{color:'var(--danger)',fontWeight:600}}>{absent}</td>
                  <td style={{color:'var(--late)',fontWeight:600}}>{late}</td>
                  <td style={{color:'var(--permission)',fontWeight:600}}>{perm}</td>
                  <td style={{fontSize:'13px'}}>{permMins}</td>
                  <td style={{color:leavesUsed>=MAX_LEAVES?'var(--danger)':'var(--text)',fontWeight:leavesUsed>=MAX_LEAVES?700:400}}>
                    {leavesUsed}/{MAX_LEAVES}
                  </td>
                  <td>
                    {leavesUsed >= MAX_LEAVES
                      ? <span className="badge badge-absent">Exceeded</span>
                      : <span className="badge badge-present">OK</span>}
                  </td>
                </tr>
              ))}
              {employees.length === 0 && (
                <tr><td colSpan={10} style={{textAlign:'center',color:'var(--text-muted)',padding:'2rem'}}>No employees yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────
export default function Home() {
  const [tab, setTab] = useState('today');
  const [employees, setEmployees] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [empSnap, recSnap] = await Promise.all([
        getDocs(query(collection(db, 'employees'), orderBy('createdAt','asc'))),
        getDocs(query(collection(db, 'attendance'), orderBy('date','desc')))
      ]);
      setEmployees(empSnap.docs.map(d => d.data()));
      setRecords(recSnap.docs.map(d => d.data()));
    } catch(e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <>
      <Head>
        <title>AttendEase — Company Attendance</title>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
      </Head>
      <Nav tab={tab} setTab={setTab}/>
      <div className="container" style={{padding:'1.5rem 1rem'}}>
        {loading ? (
          <div style={{textAlign:'center',padding:'4rem',color:'var(--text-muted)'}}>
            Loading...
          </div>
        ) : (
          <>
            {tab === 'today' && <TodayTab employees={employees} records={records} onRefresh={fetchData}/>}
            {tab === 'employees' && <EmployeesTab employees={employees} records={records} onRefresh={fetchData}/>}
            {tab === 'calendar' && <CalendarTab employees={employees} records={records}/>}
            {tab === 'report' && <ReportTab employees={employees} records={records} onRefresh={fetchData}/>}
          </>
        )}
      </div>
    </>
  );
}
