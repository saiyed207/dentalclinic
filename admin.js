module.exports = {
  renderAdminPage: function () {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Dashboard | Sparkle Dental Care</title>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
        :root {
            --bg-primary: #F7F9FC; --primary-blue: #5687F5; --deep-navy: #203451; 
            --surface-white: #FFFFFF; --text-body: #536178; --border-light: #E4EAF2;
            --success: #198754; --warning: #F59E0B; --error: #C62828;
            --radius-md: 16px;
            --clay-shadow: 6px 6px 18px rgba(35, 65, 105, 0.05), -6px -6px 18px rgba(255, 255, 255, 0.9);
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
        body { background: var(--bg-primary); color: var(--text-body); }
        
        /* Layout */
        .app-container { display: flex; height: 100vh; overflow: hidden; }
        .sidebar { width: 260px; background: var(--surface-white); border-right: 1px solid var(--border-light); display: flex; flex-direction: column; padding: 20px; }
        .main-content { flex: 1; overflow-y: auto; padding: 30px; }
        
        /* Login Screen */
        #loginScreen { position: fixed; inset: 0; background: var(--bg-primary); display: flex; align-items: center; justify-content: center; z-index: 1000; }
        .login-card { background: var(--surface-white); padding: 40px; border-radius: var(--radius-md); box-shadow: var(--clay-shadow); width: 100%; max-width: 400px; text-align: center; }
        .form-control { width: 100%; padding: 12px 16px; margin-bottom: 20px; border: 1px solid var(--border-light); border-radius: 8px; outline: none; }
        .btn { padding: 12px 20px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; width: 100%; transition: opacity 0.2s; }
        .btn-primary { background: var(--primary-blue); color: white; }
        .btn-primary:hover { opacity: 0.9; }
        
        /* Sidebar */
        .brand { font-size: 1.2rem; font-weight: 700; color: var(--deep-navy); margin-bottom: 40px; display: flex; align-items: center; gap: 10px; }
        .nav-item { padding: 12px 16px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 12px; margin-bottom: 10px; font-weight: 500; transition: background 0.2s; }
        .nav-item.active, .nav-item:hover { background: #E5EEFF; color: var(--primary-blue); }
        .logout-btn { margin-top: auto; color: var(--error); }
        
        /* Dashboard */
        .header { margin-bottom: 30px; display: flex; justify-content: space-between; align-items: center; }
        .header h1 { color: var(--deep-navy); font-size: 1.8rem; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 40px; }
        .stat-card { background: var(--surface-white); padding: 20px; border-radius: var(--radius-md); box-shadow: var(--clay-shadow); }
        .stat-value { font-size: 2rem; font-weight: 700; color: var(--deep-navy); margin-top: 10px; }
        
        /* Tables */
        .card { background: var(--surface-white); border-radius: var(--radius-md); box-shadow: var(--clay-shadow); padding: 20px; overflow: hidden; }
        table { width: 100%; border-collapse: collapse; text-align: left; }
        th, td { padding: 15px; border-bottom: 1px solid var(--border-light); }
        th { font-weight: 600; color: var(--deep-navy); }
        .badge { padding: 4px 10px; border-radius: 100px; font-size: 0.8rem; font-weight: 600; }
        .bg-pending { background: #FEF3C7; color: #D97706; }
        .bg-confirmed { background: #D1FAE5; color: #059669; }
        .bg-completed { background: #DBEAFE; color: #2563EB; }
        .bg-cancelled { background: #FEE2E2; color: #DC2626; }
        
        .action-select { padding: 6px; border: 1px solid var(--border-light); border-radius: 6px; outline: none; }
        
        /* Utility */
        .hidden { display: none !important; }
        .toast { position: fixed; bottom: 20px; right: 20px; background: var(--deep-navy); color: white; padding: 12px 24px; border-radius: 8px; transition: opacity 0.3s; opacity: 0; z-index: 2000; pointer-events: none; }
    </style>
</head>
<body>

    <div id="loginScreen">
        <div class="login-card">
            <h2 style="margin-bottom: 20px; color: var(--deep-navy);"><i data-lucide="lock"></i> Admin Login</h2>
            <div id="loginError" style="color: var(--error); margin-bottom: 15px; font-size: 0.9rem;"></div>
            <form id="loginForm">
                <input type="text" id="username" class="form-control" placeholder="Username" required>
                <input type="password" id="password" class="form-control" placeholder="Password" required>
                <button type="submit" class="btn btn-primary" id="loginBtn">Sign In</button>
            </form>
        </div>
    </div>

    <div class="app-container hidden" id="app">
        <aside class="sidebar">
            <div class="brand"><i data-lucide="sparkles"></i> Admin Panel</div>
            <div class="nav-item active" onclick="switchTab('dashboard')"><i data-lucide="layout-dashboard"></i> Dashboard</div>
            <div class="nav-item" onclick="switchTab('appointments')"><i data-lucide="calendar"></i> Appointments</div>
            <div class="nav-item" onclick="switchTab('inquiries')"><i data-lucide="message-square"></i> Inquiries</div>
            <div class="nav-item logout-btn" onclick="logout()"><i data-lucide="log-out"></i> Logout</div>
        </aside>
        
        <main class="main-content">
            <div id="toast" class="toast">Action successful</div>
            
            <!-- Dashboard Tab -->
            <section id="tab-dashboard">
                <div class="header">
                    <h1>Overview</h1>
                    <div>Welcome back, <strong id="adminName">Admin</strong></div>
                </div>
                <div class="stats-grid">
                    <div class="stat-card"><div>Total Appointments</div><div class="stat-value" id="sTotal">-</div></div>
                    <div class="stat-card"><div>Pending Requests</div><div class="stat-value" id="sPending" style="color:var(--warning)">-</div></div>
                    <div class="stat-card"><div>Confirmed</div><div class="stat-value" id="sConfirmed" style="color:var(--success)">-</div></div>
                    <div class="stat-card"><div>New Inquiries</div><div class="stat-value" id="sInquiries">-</div></div>
                </div>
            </section>

            <!-- Appointments Tab -->
            <section id="tab-appointments" class="hidden">
                <div class="header">
                    <h1>Appointments</h1>
                    <button class="btn btn-primary" style="width:auto;" onclick="loadAppointments()"><i data-lucide="refresh-cw"></i> Refresh</button>
                </div>
                <div class="card">
                    <div style="overflow-x:auto;">
                        <table id="appTable">
                            <thead>
                                <tr>
                                    <th>Ref</th>
                                    <th>Patient</th>
                                    <th>Contact</th>
                                    <th>Service & Date</th>
                                    <th>Status</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody><!-- Dynamic --></tbody>
                        </table>
                    </div>
                </div>
            </section>

            <!-- Inquiries Tab -->
            <section id="tab-inquiries" class="hidden">
                <div class="header">
                    <h1>Inquiries</h1>
                </div>
                <div class="card">
                    <div style="overflow-x:auto;">
                        <table id="inqTable">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Name</th>
                                    <th>Contact</th>
                                    <th>Message</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody><!-- Dynamic --></tbody>
                        </table>
                    </div>
                </div>
            </section>

        </main>
    </div>

    <script>
        lucide.createIcons();
        
        // Setup Auth headers & CSRF protection natively handled via secure cookies. 
        // We ensure JSON fetch config handles credentials.
        const fetchConfig = { headers: { 'Content-Type': 'application/json' } };

        // Initialization
        async function checkAuth() {
            try {
                const res = await fetch('/api/admin/me');
                if (res.ok) {
                    const data = await res.json();
                    document.getElementById('adminName').textContent = data.username;
                    document.getElementById('loginScreen').classList.add('hidden');
                    document.getElementById('app').classList.remove('hidden');
                    loadDashboard();
                } else {
                    document.getElementById('loginScreen').classList.remove('hidden');
                    document.getElementById('app').classList.add('hidden');
                }
            } catch (e) {
                console.error("Auth check failed", e);
            }
        }
        checkAuth();

        // Login
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('loginBtn');
            const err = document.getElementById('loginError');
            btn.textContent = 'Verifying...';
            btn.disabled = true;
            
            try {
                const res = await fetch('/api/admin/login', {
                    method: 'POST', ...fetchConfig,
                    body: JSON.stringify({
                        username: document.getElementById('username').value,
                        password: document.getElementById('password').value
                    })
                });
                if (res.ok) {
                    err.textContent = '';
                    checkAuth();
                } else {
                    const data = await res.json();
                    err.textContent = data.error || 'Login failed';
                }
            } finally {
                btn.textContent = 'Sign In';
                btn.disabled = false;
            }
        });

        // Logout
        async function logout() {
            await fetch('/api/admin/logout', { method: 'POST' });
            window.location.reload();
        }

        // Navigation
        function switchTab(tab) {
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            event.currentTarget.classList.add('active');
            
            ['dashboard', 'appointments', 'inquiries'].forEach(t => {
                document.getElementById('tab-' + t).classList.add('hidden');
            });
            document.getElementById('tab-' + tab).classList.remove('hidden');
            
            if(tab === 'dashboard') loadDashboard();
            if(tab === 'appointments') loadAppointments();
            if(tab === 'inquiries') loadInquiries();
        }

        function showToast(msg) {
            const t = document.getElementById('toast');
            t.textContent = msg;
            t.style.opacity = '1';
            setTimeout(() => t.style.opacity = '0', 3000);
        }

        // Data Loaders
        async function loadDashboard() {
            try {
                const res = await fetch('/api/admin/dashboard');
                if(res.ok) {
                    const d = await res.json();
                    document.getElementById('sTotal').textContent = d.totalAppointments;
                    document.getElementById('sPending').textContent = d.pendingAppointments;
                    document.getElementById('sConfirmed').textContent = d.confirmedAppointments;
                    document.getElementById('sInquiries').textContent = d.newInquiries;
                }
            } catch(e) {}
        }

        async function loadAppointments() {
            try {
                const res = await fetch('/api/admin/appointments');
                if(res.ok) {
                    const data = await res.json();
                    const tbody = document.querySelector('#appTable tbody');
                    tbody.innerHTML = '';
                    
                    data.appointments.forEach(app => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = \`
                            <td><strong>\${escapeHTML(app.reference)}</strong></td>
                            <td>\${escapeHTML(app.patientName)}<br><small>\${app.firstVisit === 'Yes' ? 'First Visit' : 'Returning'}</small></td>
                            <td>\${escapeHTML(app.phone)}<br><small>\${escapeHTML(app.email || '')}</small></td>
                            <td>\${escapeHTML(app.service)}<br><small>\${app.preferredDate} \${app.preferredTime}</small></td>
                            <td><span class="badge bg-\${app.status.replace('_', '-')}">\${app.status}</span></td>
                            <td>
                                <select class="action-select" onchange="updateStatus('\${app._id}', this.value)">
                                    <option value="" disabled selected>Update...</option>
                                    <option value="pending">Pending</option>
                                    <option value="confirmed">Confirm</option>
                                    <option value="completed">Complete</option>
                                    <option value="cancelled">Cancel</option>
                                    <option value="no_show">No Show</option>
                                </select>
                            </td>
                        \`;
                        tbody.appendChild(tr);
                    });
                }
            } catch(e) {}
        }

        async function loadInquiries() {
            try {
                const res = await fetch('/api/admin/inquiries');
                if(res.ok) {
                    const data = await res.json();
                    const tbody = document.querySelector('#inqTable tbody');
                    tbody.innerHTML = '';
                    
                    data.inquiries.forEach(inq => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = \`
                            <td>\${new Date(inq.createdAt).toLocaleDateString()}</td>
                            <td>\${escapeHTML(inq.name)}</td>
                            <td>\${escapeHTML(inq.contactInfo)}</td>
                            <td><div style="max-width:300px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">\${escapeHTML(inq.message)}</div></td>
                            <td>
                                <select class="action-select" onchange="updateInqStatus('\${inq._id}', this.value)">
                                    <option value="\${inq.status}" selected>\${inq.status}</option>
                                    <option value="new">New</option>
                                    <option value="in_progress">In Progress</option>
                                    <option value="resolved">Resolved</option>
                                </select>
                            </td>
                        \`;
                        tbody.appendChild(tr);
                    });
                }
            } catch(e) {}
        }

        async function updateStatus(id, status) {
            if(!status) return;
            try {
                const res = await fetch(\`/api/admin/appointments/\${id}\`, {
                    method: 'PATCH', ...fetchConfig, body: JSON.stringify({ status })
                });
                if(res.ok) { showToast('Status updated'); loadAppointments(); loadDashboard(); }
                else showToast('Update failed');
            } catch(e) { showToast('Network error'); }
        }

        async function updateInqStatus(id, status) {
            try {
                const res = await fetch(\`/api/admin/inquiries/\${id}\`, {
                    method: 'PATCH', ...fetchConfig, body: JSON.stringify({ status })
                });
                if(res.ok) { showToast('Inquiry updated'); loadInquiries(); loadDashboard(); }
                else showToast('Update failed');
            } catch(e) { showToast('Network error'); }
        }

        function escapeHTML(str) {
            if (!str) return '';
            return str.replace(/[&<>'"]/g, 
                tag => ({
                    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
                }[tag])
            );
        }
    </script>
</body>
</html>`;
  }
};
