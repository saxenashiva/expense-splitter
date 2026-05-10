import axios from 'axios';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Activity,
  Bell,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Mail,
  Pencil,
  QrCode,
  ReceiptText,
  Save,
  Sparkles,
  UserCircle,
  Users,
  WalletCards,
} from 'lucide-react';

const rawApiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const apiUrl = rawApiUrl.replace(/\/$/, '');
const API_URL = apiUrl.endsWith('/api') ? apiUrl : `${apiUrl}/api`;
const TOKEN_KEY = 'expense-splitter-token';

type User = {
  id: string;
  name: string;
  email: string;
  upiId?: string | null;
};

type Member = {
  id: string;
  userId: string;
  user: User;
};

type Group = {
  id: string;
  name: string;
  description?: string | null;
  ownerId: string;
  owner?: User;
  members: Member[];
  _count?: { expenses: number };
};

type Expense = {
  id: string;
  title: string;
  amount: number;
  createdAt: string;
  notes?: string | null;
  paidBy: User;
  splits: Array<{
    id: string;
    userId: string;
    amount: number;
    user: User;
  }>;
};

type SettlementStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

type Settlement = {
  id: string;
  amount: number;
  note?: string | null;
  status: SettlementStatus;
  createdAt: string;
  approvedAt?: string | null;
  paidBy: User;
  receivedBy: User;
};

type GroupDetail = Group & {
  expenses: Expense[];
  settlements: Settlement[];
};

type BalanceResponse = {
  members: Array<{ user: User; balance: number }>;
  suggestedSettlements: Array<{ from: User; to: User; amount: number }>;
};

type DashboardData = {
  groupCount: number;
  friends: Array<{ user: User; groups: string[] }>;
  activities: Array<{
    id: string;
    type: string;
    status: string;
    group: { id: string; name: string };
    title: string;
    amount?: number;
    createdAt: string;
  }>;
};

type Toast = {
  id: number;
  message: string;
  tone: 'success' | 'error' | 'info';
};

const money = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

const createUpiLink = (to: User, amount: number, groupName: string) => {
  const params = new URLSearchParams({
    pa: to.upiId || '',
    pn: to.name,
    am: amount.toFixed(2),
    cu: 'INR',
    tn: `Expense Splitter - ${groupName}`,
  });

  return `upi://pay?${params.toString()}`;
};

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [user, setUser] = useState<User | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroupId, setActiveGroupId] = useState('');
  const [activePage, setActivePage] = useState<'groups' | 'dashboard' | 'friends' | 'profile'>('groups');
  const [activeGroup, setActiveGroup] = useState<GroupDetail | null>(null);
  const [balances, setBalances] = useState<BalanceResponse | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '', upiId: '' });
  const [groupForm, setGroupForm] = useState({ name: '', description: '' });
  const [memberEmail, setMemberEmail] = useState('');
  const [expenseForm, setExpenseForm] = useState({ title: '', amount: '', paidById: '', notes: '' });
  const [profileForm, setProfileForm] = useState({ name: '', upiId: '' });
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [selectedSplitUserIds, setSelectedSplitUserIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isBusy, setIsBusy] = useState(false);

  const api = useMemo(() => {
    const instance = axios.create({ baseURL: API_URL });
    instance.interceptors.request.use((config) => {
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });
    return instance;
  }, [token]);

  const pushToast = (message: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now();
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  };

  const showError = (unknownError: unknown) => {
    let message = 'Something went wrong';
    if (axios.isAxiosError(unknownError)) {
      message = String(
        unknownError.response?.data?.error ||
          unknownError.message ||
          'Network error. Make sure the backend is running and the API URL is correct.',
      );
    }
    setError(message);
    pushToast(message, 'error');
  };

  const loadGroups = async () => {
    const response = await api.get<{ groups: Group[] }>('/groups');
    setGroups(response.data.groups);
    if (!activeGroupId && response.data.groups[0]) {
      setActiveGroupId(response.data.groups[0].id);
    }
  };

  const loadDashboard = async () => {
    const response = await api.get<DashboardData>('/dashboard');
    setDashboard(response.data);
  };

  const loadActiveGroup = async (groupId: string) => {
    if (!groupId) return;
    const response = await api.get<{ group: GroupDetail; balances: BalanceResponse }>(`/groups/${groupId}`);
    setActiveGroup(response.data.group);
    setBalances(response.data.balances);
    setExpenseForm((current) => ({
      ...current,
      paidById: current.paidById || response.data.group.members[0]?.userId || '',
    }));
    setSelectedSplitUserIds((current) => {
      const memberIds = response.data.group.members.map((member) => member.userId);
      const validCurrent = current.filter((userId) => memberIds.includes(userId));
      return validCurrent.length ? validCurrent : memberIds;
    });
  };

  useEffect(() => {
    if (!token) return;

    api
      .get<{ user: User }>('/auth/me')
      .then((response) => {
        setUser(response.data.user);
        setProfileForm({ name: response.data.user.name, upiId: response.data.user.upiId || '' });
        return Promise.all([loadGroups(), loadDashboard()]);
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken('');
      });
  }, [token]);

  useEffect(() => {
    if (!token || !activeGroupId) return;
    loadActiveGroup(activeGroupId).catch(showError);
  }, [activeGroupId, token]);

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault();
    setIsBusy(true);
    setError('');

    try {
      const payload =
        authMode === 'register'
          ? authForm
          : { email: authForm.email, password: authForm.password };
      const response = await api.post<{ user: User; token: string }>(`/auth/${authMode}`, payload);
      localStorage.setItem(TOKEN_KEY, response.data.token);
      setToken(response.data.token);
      setUser(response.data.user);
      setProfileForm({ name: response.data.user.name, upiId: response.data.user.upiId || '' });
    } catch (unknownError) {
      showError(unknownError);
    } finally {
      setIsBusy(false);
    }
  };

  const createGroup = async (event: FormEvent) => {
    event.preventDefault();
    setIsBusy(true);
    setError('');

    try {
      const response = await api.post<{ group: Group }>('/groups', groupForm);
      setGroupForm({ name: '', description: '' });
      await Promise.all([loadGroups(), loadDashboard()]);
      setActiveGroupId(response.data.group.id);
      pushToast('Group created', 'success');
    } catch (unknownError) {
      showError(unknownError);
    } finally {
      setIsBusy(false);
    }
  };

  const addMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeGroupId) return;
    setIsBusy(true);
    setError('');

    try {
      const response = await api.post<{ emailSent: boolean }>(`/groups/${activeGroupId}/members`, { email: memberEmail });
      setMemberEmail('');
      await Promise.all([loadGroups(), loadActiveGroup(activeGroupId), loadDashboard()]);
      pushToast(
        response.data.emailSent
          ? 'Member added and email sent'
          : 'Member added. Email is not configured, so no email was sent.',
        response.data.emailSent ? 'success' : 'info',
      );
    } catch (unknownError) {
      showError(unknownError);
    } finally {
      setIsBusy(false);
    }
  };

  const addExpense = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeGroupId) return;
    setIsBusy(true);
    setError('');

    try {
      await api.post(`/groups/${activeGroupId}/expenses`, {
        ...expenseForm,
        splitUserIds: selectedSplitUserIds,
      });
      setExpenseForm({ title: '', amount: '', paidById: expenseForm.paidById, notes: '' });
      await Promise.all([loadGroups(), loadActiveGroup(activeGroupId), loadDashboard()]);
      pushToast('Expense split created', 'success');
    } catch (unknownError) {
      showError(unknownError);
    } finally {
      setIsBusy(false);
    }
  };

  const removeMember = async (userId: string) => {
    if (!activeGroupId) return;
    setIsBusy(true);
    setError('');

    try {
      await api.delete(`/groups/${activeGroupId}/members/${userId}`);
      setSelectedSplitUserIds((current) => current.filter((id) => id !== userId));
      await Promise.all([loadGroups(), loadActiveGroup(activeGroupId), loadDashboard()]);
      pushToast('Member removed from group', 'success');
    } catch (unknownError) {
      showError(unknownError);
    } finally {
      setIsBusy(false);
    }
  };

  const toggleSplitUser = (userId: string) => {
    setSelectedSplitUserIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  };

  const markPaymentPaid = async (to: User, amount: number, label: string) => {
    if (!activeGroupId || !user) return;
    setIsBusy(true);
    setError('');

    try {
      await api.post(`/groups/${activeGroupId}/settlements`, {
        amount,
        paidById: user.id,
        receivedById: to.id,
        note: `${label} / UPI ${to.upiId}`,
      });
      await Promise.all([loadActiveGroup(activeGroupId), loadDashboard()]);
      pushToast('Payment marked as paid. Waiting for approval.', 'success');
    } catch (unknownError) {
      showError(unknownError);
    } finally {
      setIsBusy(false);
    }
  };

  const reviewSettlement = async (settlementId: string, action: 'approve' | 'reject') => {
    if (!activeGroupId) return;
    setIsBusy(true);
    setError('');

    try {
      await api.patch(`/settlements/${settlementId}/${action}`);
      await Promise.all([loadActiveGroup(activeGroupId), loadDashboard()]);
      pushToast(action === 'approve' ? 'Payment approved' : 'Payment rejected', 'success');
    } catch (unknownError) {
      showError(unknownError);
    } finally {
      setIsBusy(false);
    }
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setIsBusy(true);
    setError('');

    try {
      const response = await api.patch<{ user: User }>('/auth/me', profileForm);
      setUser(response.data.user);
      setProfileForm({ name: response.data.user.name, upiId: response.data.user.upiId || '' });
      setIsEditingProfile(false);
      await Promise.all([loadGroups(), loadDashboard(), activeGroupId ? loadActiveGroup(activeGroupId) : Promise.resolve()]);
      pushToast('Profile updated. New UPI QR is ready.', 'success');
    } catch (unknownError) {
      showError(unknownError);
    } finally {
      setIsBusy(false);
    }
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
    setUser(null);
    setGroups([]);
    setActiveGroup(null);
    setActiveGroupId('');
    setDashboard(null);
  };

  const paymentRequests = useMemo(() => {
    if (!activeGroup) return [];

    return activeGroup.expenses.flatMap((expense) =>
      expense.splits
        .filter((split) => split.userId !== expense.paidBy.id && split.amount > 0)
        .map((split) => ({
          id: `${expense.id}-${split.userId}`,
          expenseId: expense.id,
          expenseTitle: expense.title,
          createdAt: expense.createdAt,
          from: split.user,
          to: expense.paidBy,
          amount: split.amount,
        })),
    );
  }, [activeGroup]);

  const navigationItems = [
    { id: 'groups' as const, label: 'Groups', icon: LayoutDashboard },
    { id: 'dashboard' as const, label: 'Activity', icon: Activity },
    { id: 'friends' as const, label: 'Friends', icon: Users },
    { id: 'profile' as const, label: 'My Profile', icon: UserCircle },
  ];

  if (!token || !user) {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-950">
        <section className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-6 py-10 lg:grid-cols-[1fr_420px]">
          <div>
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">
              UPI settlement ready
            </p>
            <h1 className="max-w-2xl text-5xl font-bold leading-tight text-slate-950 sm:text-6xl">
              Expense Splitter
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-slate-600">
              Split expenses, scan UPI QR codes, mark payments as paid, and approve them inside the group chat.
            </p>
          </div>

          <form onSubmit={submitAuth} className="rounded-lg border border-slate-200 bg-white p-6 shadow-panel">
            <div className="mb-6 flex rounded-md bg-slate-100 p-1">
              {(['register', 'login'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAuthMode(mode)}
                  className={`flex-1 rounded px-4 py-2 text-sm font-semibold capitalize ${
                    authMode === mode ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
            {authMode === 'register' && (
              <>
                <label className="field">
                  Name
                  <input
                    value={authForm.name}
                    onChange={(event) => setAuthForm({ ...authForm, name: event.target.value })}
                    minLength={2}
                    required
                  />
                </label>
                <label className="field">
                  UPI ID
                  <input
                    placeholder="name@bank"
                    value={authForm.upiId}
                    onChange={(event) => setAuthForm({ ...authForm, upiId: event.target.value })}
                    minLength={3}
                    required
                  />
                </label>
              </>
            )}
            <label className="field">
              Email
              <input
                type="email"
                value={authForm.email}
                onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}
                required
              />
            </label>
            <label className="field">
              Password
              <input
                type="password"
                value={authForm.password}
                onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
                minLength={8}
                required
              />
            </label>
            {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button disabled={isBusy} className="primary-button w-full">
              {isBusy ? 'Working...' : authMode === 'register' ? 'Create account' : 'Sign in'}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell text-slate-950">
      <div className="toast-stack">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            {toast.message}
          </div>
        ))}
      </div>

      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <WalletCards size={24} />
          </div>
          <div>
            <h1>SplitPay</h1>
            <p>Expense Splitter</p>
          </div>
        </div>

        <nav className="side-nav">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            return (
            <button
              key={item.id}
              onClick={() => setActivePage(item.id)}
              className={`side-nav-item ${activePage === item.id ? 'side-nav-item-active' : ''}`}
            >
              <Icon size={19} />
              <span>{item.label}</span>
            </button>
            );
          })}
        </nav>

        <div className="sidebar-profile">
          <div className="avatar avatar-blue">{user.name.slice(0, 1).toUpperCase()}</div>
          <div className="min-w-0">
            <p className="truncate font-black">{user.name}</p>
            <p className="truncate text-xs text-blue-100">{user.upiId || user.email}</p>
          </div>
        </div>

        <button onClick={logout} className="sidebar-logout">
          <LogOut size={18} />
          Sign out
        </button>
      </aside>

      <section className="main-stage">
        <header className="topbar">
          <div>
            <p className="kicker"><Sparkles size={15} /> Beautiful splitting, calmer settling</p>
            <h2>
              {activePage === 'groups'
                ? activeGroup?.name || 'Groups'
                : activePage === 'dashboard'
                  ? 'Activity Dashboard'
                  : activePage === 'friends'
                    ? 'Friends'
                    : 'My Profile'}
            </h2>
          </div>
          <div className="topbar-actions">
            <div className="mini-stat">
              <Users size={17} />
              {dashboard?.groupCount || groups.length} groups
            </div>
            <div className="mini-stat mini-stat-red">
              <Bell size={17} />
              {dashboard?.activities.filter((activity) => activity.status === 'pending').length || 0} pending
            </div>
          </div>
        </header>

      {activePage === 'dashboard' && (
        <section className="page-section">
          <div className="hero-panel">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-700">Activity dashboard</p>
              <h2 className="mt-2 text-4xl font-black text-slate-950">Your split pulse</h2>
            </div>
            <div className="stat-card">
              <span>{dashboard?.groupCount || 0}</span>
              <p>Groups you are in</p>
            </div>
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
            <div className="panel">
              <h3 className="section-title">Requests and approvals</h3>
              <div className="activity-list">
                {dashboard?.activities.map((activity) => (
                  <button
                    key={activity.id}
                    onClick={() => {
                      setActiveGroupId(activity.group.id);
                      setActivePage('groups');
                    }}
                    className="activity-item"
                  >
                    <div>
                      <p className="flex items-center gap-2 font-bold">
                        <ReceiptText size={17} className="text-blue-600" />
                        {activity.title}
                      </p>
                      <p className="text-sm text-slate-500">
                        {activity.group.name} / {new Date(activity.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right">
                      {activity.amount && <p className="font-black">{money.format(activity.amount)}</p>}
                      <span className={`status-chip status-${activity.status}`}>{activity.status}</span>
                    </div>
                  </button>
                ))}
                {!dashboard?.activities.length && <p className="text-sm text-slate-500">No activity yet.</p>}
              </div>
            </div>
            <div className="panel">
              <h3 className="section-title">Inbox signals</h3>
              <div className="space-y-3 text-sm text-slate-600">
                <p className="notice-card"><Mail size={17} /> When SMTP accepts a group invite email, you will see a toast instantly.</p>
                <p className="notice-card"><CreditCard size={17} /> When someone approves your split payment, it appears here as an approved activity.</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {activePage === 'friends' && (
        <section className="page-section">
          <div className="hero-panel">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-700">Friends</p>
              <h2 className="mt-2 text-4xl font-black text-slate-950">People you split with</h2>
            </div>
            <div className="stat-card">
              <span>{dashboard?.friends.length || 0}</span>
              <p>Friends and group members</p>
            </div>
          </div>
          <div className="friend-grid mt-6">
            {dashboard?.friends.map((friend) => (
              <div key={friend.user.id} className="friend-card">
                <div className="avatar avatar-red">{friend.user.name.slice(0, 1).toUpperCase()}</div>
                <div className="min-w-0">
                  <p className="truncate font-black">{friend.user.name}</p>
                  <p className="truncate text-sm text-slate-500">{friend.user.email}</p>
                  <p className="truncate text-sm text-emerald-700">{friend.user.upiId || 'No UPI ID'}</p>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                    {friend.groups.length} shared groups
                  </p>
                  <p className="text-sm text-slate-600">{friend.groups.join(', ')}</p>
                </div>
              </div>
            ))}
            {!dashboard?.friends.length && <div className="panel text-sm text-slate-500">No friends yet.</div>}
          </div>
        </section>
      )}

      {activePage === 'profile' && (
        <section className="page-section">
          <div className="profile-hero">
            <div className="profile-avatar">{user.name.slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0">
              <p className="kicker"><UserCircle size={15} /> My profile</p>
              <h2>{user.name}</h2>
              <p>{user.email}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setProfileForm({ name: user.name, upiId: user.upiId || '' });
                setIsEditingProfile((current) => !current);
              }}
              className="profile-edit-button"
            >
              <Pencil size={17} />
              {isEditingProfile ? 'Cancel' : 'Edit'}
            </button>
          </div>

          <div className="profile-grid mt-6">
            <div className="panel metric-panel">
              <Users className="text-blue-600" />
              <span>{dashboard?.groupCount || groups.length}</span>
              <p>Groups joined</p>
            </div>
            <div className="panel metric-panel">
              <QrCode className="text-red-500" />
              <span>{user.upiId || 'Missing'}</span>
              <p>UPI ID</p>
            </div>
            <div className="panel metric-panel">
              <Activity className="text-indigo-600" />
              <span>{dashboard?.activities.length || 0}</span>
              <p>Related activities</p>
            </div>
          </div>

          <div className="profile-edit-grid mt-6">
            <form onSubmit={saveProfile} className="panel">
              <h3 className="section-title">Account details</h3>
              <label className="field">
                Name
                <input
                  disabled={!isEditingProfile}
                  value={profileForm.name}
                  onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })}
                  required
                  minLength={2}
                />
              </label>
              <label className="field">
                Email
                <input disabled value={user.email} />
              </label>
              <label className="field">
                UPI ID
                <input
                  disabled={!isEditingProfile}
                  value={profileForm.upiId}
                  onChange={(event) => setProfileForm({ ...profileForm, upiId: event.target.value })}
                  required
                  minLength={3}
                />
              </label>
              {isEditingProfile && (
                <button disabled={isBusy} className="primary-button">
                  <Save size={17} />
                  Save profile
                </button>
              )}
            </form>

            <div className="panel qr-preview-panel">
              <h3 className="section-title">Your UPI QR</h3>
              <div className="qr-preview">
                <QRCodeSVG
                  value={createUpiLink(
                    { ...user, name: profileForm.name || user.name, upiId: profileForm.upiId || user.upiId },
                    1,
                    'Profile QR',
                  )}
                  size={190}
                />
              </div>
              <p className="mt-4 text-sm font-semibold text-slate-600">
                This QR updates from your edited UPI ID before saving.
              </p>
              <p className="mt-1 text-sm text-slate-500">{profileForm.upiId || user.upiId || 'Add a UPI ID'}</p>
            </div>
          </div>
        </section>
      )}

      {activePage === 'groups' && (
      <div className="groups-layout">
        <aside className="space-y-4">
          <form onSubmit={createGroup} className="panel">
            <h2 className="section-title">New group</h2>
            <label className="field">
              Name
              <input
                value={groupForm.name}
                onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })}
                required
              />
            </label>
            <label className="field">
              Description
              <textarea
                value={groupForm.description}
                onChange={(event) => setGroupForm({ ...groupForm, description: event.target.value })}
                rows={3}
              />
            </label>
            <button disabled={isBusy} className="primary-button w-full">Create group</button>
          </form>

          <div className="panel">
            <h2 className="section-title">Groups</h2>
            <div className="space-y-2">
              {groups.map((group) => (
                <button
                  key={group.id}
                  onClick={() => setActiveGroupId(group.id)}
                  className={`group-button ${activeGroupId === group.id ? 'group-button-active' : ''}`}
                >
                  <span className="flex items-center gap-2 font-semibold"><Users size={17} /> {group.name}</span>
                  <span className="text-xs text-slate-500">
                    {group.members.length} members / {group._count?.expenses || 0} expenses
                  </span>
                </button>
              ))}
              {!groups.length && <p className="text-sm text-slate-500">Create your first group to begin.</p>}
            </div>
          </div>
        </aside>

        <section className="space-y-6">
          {error && <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

          {activeGroup ? (
            <>
              <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-panel md:flex-row">
                <div>
                  <h2 className="text-2xl font-bold">{activeGroup.name}</h2>
                  <p className="text-slate-500">{activeGroup.description || 'No description'}</p>
                </div>
                <form onSubmit={addMember} className="flex min-w-0 gap-2">
                  <input
                    className="min-w-0 rounded-md border border-slate-300 px-3 py-2"
                    type="email"
                    placeholder="member@email.com"
                    value={memberEmail}
                    onChange={(event) => setMemberEmail(event.target.value)}
                    required
                  />
                    <button disabled={isBusy} className="primary-button">Add</button>
                </form>
              </div>

              <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.85fr)_minmax(440px,1fr)]">
                <div className="space-y-6">
                  <form onSubmit={addExpense} className="panel expense-panel">
                    <h3 className="section-title">Add expense</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="field">
                        Title
                        <input
                          value={expenseForm.title}
                          onChange={(event) => setExpenseForm({ ...expenseForm, title: event.target.value })}
                          required
                        />
                      </label>
                      <label className="field">
                        Amount
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={expenseForm.amount}
                          onChange={(event) => setExpenseForm({ ...expenseForm, amount: event.target.value })}
                          required
                        />
                      </label>
                      <label className="field">
                        Paid by
                        <select
                          value={expenseForm.paidById}
                          onChange={(event) => setExpenseForm({ ...expenseForm, paidById: event.target.value })}
                        >
                          {activeGroup.members.map((member) => (
                            <option key={member.userId} value={member.userId}>{member.user.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Notes
                        <input
                          value={expenseForm.notes}
                          onChange={(event) => setExpenseForm({ ...expenseForm, notes: event.target.value })}
                        />
                      </label>
                    </div>
                    <div className="mt-2">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <h4 className="text-sm font-bold text-slate-700">Split with</h4>
                        <button
                          type="button"
                          onClick={() => setSelectedSplitUserIds(activeGroup.members.map((member) => member.userId))}
                          className="text-sm font-bold text-emerald-700"
                        >
                          Select all
                        </button>
                      </div>
                      <div className="member-check-grid">
                        {activeGroup.members.map((member) => (
                          <label key={member.userId} className="member-check">
                            <input
                              type="checkbox"
                              checked={selectedSplitUserIds.includes(member.userId)}
                              onChange={() => toggleSplitUser(member.userId)}
                            />
                            <span>
                              <strong>{member.user.name}</strong>
                              <small>{member.user.email}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <button disabled={isBusy} className="primary-button mt-2">Split equally</button>
                  </form>

                  <div className="panel">
                    <h3 className="section-title">Expenses</h3>
                    <div className="divide-y divide-slate-100">
                      {activeGroup.expenses.map((expense) => (
                        <div key={expense.id} className="flex items-center justify-between gap-4 py-3">
                          <div>
                            <p className="font-semibold">{expense.title}</p>
                            <p className="text-sm text-slate-500">
                              Paid by {expense.paidBy.name} on {new Date(expense.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                          <p className="font-bold">{money.format(expense.amount)}</p>
                        </div>
                      ))}
                      {!activeGroup.expenses.length && <p className="py-4 text-sm text-slate-500">No expenses yet.</p>}
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="panel">
                    <h3 className="section-title">Members</h3>
                    <div className="space-y-2">
                      {activeGroup.members.map((member) => (
                        <div key={member.userId} className="member-row">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold">{member.user.name}</p>
                            <p className="truncate text-xs text-slate-500">{member.user.email}</p>
                          </div>
                          <button
                            disabled={
                              isBusy ||
                              activeGroup.members.length <= 1 ||
                              activeGroup.ownerId !== user.id ||
                              member.userId === activeGroup.ownerId
                            }
                            onClick={() => removeMember(member.userId)}
                            className="danger-button"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="panel">
                    <h3 className="section-title">Balances</h3>
                    <div className="space-y-3">
                      {balances?.members.map((member) => (
                        <div key={member.user.id} className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium">{member.user.name}</span>
                          <span className={member.balance >= 0 ? 'text-emerald-700' : 'text-red-700'}>
                            {money.format(member.balance)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="chat-shell">
                    <div className="chat-header">
                      <div>
                        <h3 className="flex items-center gap-2 font-bold"><QrCode size={18} /> Group Pay Chat</h3>
                        <p className="text-xs text-emerald-100">Scan, mark paid, then wait for approval</p>
                      </div>
                    </div>

                    <div className="chat-feed">
                      <div className="rounded-lg bg-white p-3 text-sm text-slate-600">
                        <span className="font-bold text-slate-900">Payment requests</span> appear here for every split.
                        QR codes are visible to the person who has to pay.
                      </div>

                      {paymentRequests.map((request) => {
                        const relatedSettlements = activeGroup.settlements.filter(
                          (settlement) =>
                            settlement.paidBy.id === request.from.id &&
                            settlement.receivedBy.id === request.to.id &&
                            Math.abs(settlement.amount - request.amount) < 0.01 &&
                            Boolean(settlement.note?.includes(request.expenseTitle)),
                        );
                        const isMine = request.from.id === user.id;
                        const isReceiver = request.to.id === user.id;
                        const canPay = isMine && Boolean(request.to.upiId);
                        const isApproved = relatedSettlements.some((settlement) => settlement.status === 'APPROVED');
                        const isPending = relatedSettlements.some((settlement) => settlement.status === 'PENDING');
                        const upiLink = createUpiLink(request.to, request.amount, activeGroup.name);

                        return (
                          <div key={request.id} className={`chat-row ${isMine ? 'justify-end' : 'justify-start'}`}>
                            <div className={`chat-bubble ${isMine ? 'chat-bubble-me' : 'chat-bubble-other'}`}>
                              <p className="text-sm font-semibold">
                                {request.from.name} needs to pay {request.to.name}
                              </p>
                              <p className="mt-1 text-xs opacity-80">{request.expenseTitle}</p>
                              <p className="mt-1 text-2xl font-black">{money.format(request.amount)}</p>
                              <p className="mt-1 text-xs opacity-80">UPI: {request.to.upiId || 'not available'}</p>
                              <p className="mt-2 inline-flex rounded-full bg-white/70 px-2 py-1 text-xs font-bold text-slate-800">
                                {isApproved ? 'approved' : isPending ? 'approval pending' : 'unpaid'}
                              </p>
                              {canPay && !isApproved && !isPending && (
                                <div className="mt-3 rounded-lg bg-white p-3 text-center">
                                  <QRCodeSVG value={upiLink} size={150} />
                                  <a href={upiLink} className="primary-button mt-3 w-full">
                                    Open UPI app
                                  </a>
                                  <button
                                    disabled={isBusy}
                                    onClick={() => markPaymentPaid(request.to, request.amount, request.expenseTitle)}
                                    className="secondary-button mt-2 w-full"
                                  >
                                    Mark as paid
                                  </button>
                                </div>
                              )}
                              {isMine && isPending && (
                                <p className="mt-3 rounded-md bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700">
                                  Waiting for {request.to.name} to approve.
                                </p>
                              )}
                              {isReceiver && isPending && (
                                <p className="mt-3 rounded-md bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700">
                                  A payment from {request.from.name} is waiting below for your approval.
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {activeGroup.settlements.map((settlement) => {
                        const isMine = settlement.paidBy.id === user.id;
                        const canReview = settlement.receivedBy.id === user.id && settlement.status === 'PENDING';

                        return (
                          <div key={settlement.id} className={`chat-row ${isMine ? 'justify-end' : 'justify-start'}`}>
                            <div className={`chat-bubble ${isMine ? 'chat-bubble-me' : 'chat-bubble-other'}`}>
                              <p className="text-sm font-semibold">
                                {settlement.paidBy.name} paid {settlement.receivedBy.name}
                              </p>
                              <p className="mt-1 text-2xl font-black">{money.format(settlement.amount)}</p>
                              <p className="mt-2 inline-flex rounded-full bg-white/70 px-2 py-1 text-xs font-bold text-slate-800">
                                {settlement.status.toLowerCase()}
                              </p>
                              {settlement.note && <p className="mt-2 text-xs opacity-80">{settlement.note}</p>}
                              {canReview && (
                                <div className="mt-3 grid grid-cols-2 gap-2">
                                  <button
                                    disabled={isBusy}
                                    onClick={() => reviewSettlement(settlement.id, 'reject')}
                                    className="secondary-button"
                                  >
                                    Reject
                                  </button>
                                  <button
                                    disabled={isBusy}
                                    onClick={() => reviewSettlement(settlement.id, 'approve')}
                                    className="primary-button"
                                  >
                                    Approve
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {!paymentRequests.length && !activeGroup.settlements.length && (
                        <div className="rounded-lg bg-white p-4 text-center text-sm text-slate-500">
                          Add an expense to create payment requests and QR codes.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="panel">
              <h2 className="text-2xl font-bold">Start by creating a group</h2>
              <p className="mt-2 text-slate-500">Your expenses and balances will show here.</p>
            </div>
          )}
        </section>
      </div>
      )}
      </section>
    </main>
  );
}
