import bcrypt from 'bcrypt';
import cors from 'cors';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { PrismaClient, SettlementStatus, User } from '@prisma/client';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = Number(process.env.PORT || 5000);
const JWT_SECRET = process.env.JWT_SECRET;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}

type PublicUser = Pick<User, 'id' | 'name' | 'email' | 'upiId' | 'createdAt'>;

type AuthRequest = Request & {
  user?: PublicUser;
};

class AppError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const asyncHandler =
  (handler: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void handler(req as AuthRequest, res, next).catch(next);
  };

const publicUser = (user: User): PublicUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
  upiId: user.upiId,
  createdAt: user.createdAt,
});

const signToken = (user: PublicUser) =>
  jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

const mailer =
  SMTP_HOST && SMTP_USER && SMTP_PASS && MAIL_FROM
    ? nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
      })
    : null;

const sendGroupInviteEmail = async ({
  to,
  invitedName,
  groupName,
  invitedBy,
}: {
  to: string;
  invitedName: string;
  groupName: string;
  invitedBy: string;
}) => {
  if (!mailer || !MAIL_FROM) {
    console.info(`Email not configured. Skipping group invite to ${to}.`);
    return false;
  }

  await mailer.sendMail({
    from: MAIL_FROM,
    to,
    subject: `You were added to ${groupName} on Expense Splitter`,
    text: `${invitedName}, ${invitedBy} added you to the split group "${groupName}". Open Expense Splitter to view expenses and settle payments.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
        <h2>You were added to ${groupName}</h2>
        <p>${invitedBy} added you to the split group <strong>${groupName}</strong>.</p>
        <p>Open Expense Splitter to view expenses, scan UPI QR codes, and settle payments.</p>
      </div>
    `,
  });

  return true;
};

const sendPasswordResetEmail = async ({
  to,
  userName,
  resetCode,
}: {
  to: string;
  userName: string;
  resetCode: string;
}) => {
  if (!mailer || !MAIL_FROM) {
    console.info(`Email not configured. Skipping password reset email to ${to}.`);
    return false;
  }

  await mailer.sendMail({
    from: MAIL_FROM,
    to,
    subject: 'Password Reset Code - Expense Splitter',
    text: `Hi ${userName},\n\nYour password reset code is: ${resetCode}\n\nThis code will expire in 1 hour.\n\nIf you didn't request this, please ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
        <h2>Password Reset Request</h2>
        <p>Hi ${userName},</p>
        <p>We received a request to reset your password. Use the code below to reset your password:</p>
        <p style="font-size:24px;font-weight:bold;letter-spacing:2px;margin:20px 0">${resetCode}</p>
        <p><strong>This code will expire in 1 hour.</strong></p>
        <p style="color:#666">If you didn't request this, please ignore this email.</p>
      </div>
    `,
  });

  return true;
};

const sendNewSplitEmail = async ({
  to,
  userName,
  expenseTitle,
  amount,
  paidByName,
  groupName,
}: {
  to: string;
  userName: string;
  expenseTitle: string;
  amount: number;
  paidByName: string;
  groupName: string;
}) => {
  if (!mailer || !MAIL_FROM) {
    console.info(`Email not configured. Skipping split notification to ${to}.`);
    return false;
  }

  await mailer.sendMail({
    from: MAIL_FROM,
    to,
    subject: `New expense in ${groupName} - Expense Splitter`,
    text: `Hi ${userName},\n\n${paidByName} added a new expense "${expenseTitle}" for ₹${amount.toFixed(2)} in the group "${groupName}".\n\nOpen Expense Splitter to view details and manage payments.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
        <h2>New Expense Added</h2>
        <p>Hi ${userName},</p>
        <p><strong>${paidByName}</strong> added a new expense in the group <strong>${groupName}</strong>:</p>
        <div style="background:#f3f4f6;padding:15px;border-radius:8px;margin:15px 0">
          <p style="margin:5px 0"><strong>Expense:</strong> ${expenseTitle}</p>
          <p style="margin:5px 0"><strong>Amount:</strong> ₹${amount.toFixed(2)}</p>
        </div>
        <p>Open Expense Splitter to view details and manage payments.</p>
      </div>
    `,
  });

  return true;
};

const isMemberSettled = async (groupId: string, userId: string) => {
  const balances = await calculateBalances(groupId);
  const memberBalance = balances.members.find((member) => member.user.id === userId)?.balance || 0;
  const pendingPayments = await prisma.settlement.count({
    where: {
      groupId,
      status: SettlementStatus.PENDING,
      OR: [{ paidById: userId }, { receivedById: userId }],
    },
  });

  return Math.abs(memberBalance) < 0.01 && pendingPayments === 0;
};

const requireString = (value: unknown, label: string, min = 1) => {
  if (typeof value !== 'string' || value.trim().length < min) {
    throw new AppError(400, `${label} is required`);
  }

  return value.trim();
};

const requireAmount = (value: unknown) => {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError(400, 'Amount must be greater than 0');
  }

  return Math.round(amount * 100) / 100;
};

const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'Authentication required');
  }

  const payload = jwt.verify(header.slice(7), JWT_SECRET) as { sub?: string };

  if (!payload.sub) {
    throw new AppError(401, 'Invalid token');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });

  if (!user) {
    throw new AppError(401, 'User no longer exists');
  }

  req.user = publicUser(user);
  next();
});

const ensureGroupMember = async (groupId: string, userId: string) => {
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
  });

  if (!membership) {
    throw new AppError(404, 'Group not found');
  }

  return membership;
};

const calculateBalances = async (groupId: string) => {
  const [members, expenses, settlements] = await Promise.all([
    prisma.groupMember.findMany({
      where: { groupId },
      include: { user: { select: { id: true, name: true, email: true, upiId: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.expense.findMany({
      where: { groupId },
      include: { splits: true },
    }),
    prisma.settlement.findMany({ where: { groupId, status: SettlementStatus.APPROVED } }),
  ]);

  const balances = new Map<string, number>();
  members.forEach((member) => balances.set(member.userId, 0));

  expenses.forEach((expense) => {
    balances.set(expense.paidById, (balances.get(expense.paidById) || 0) + expense.amount);
    expense.splits.forEach((split) => {
      balances.set(split.userId, (balances.get(split.userId) || 0) - split.amount);
    });
  });

  settlements.forEach((settlement) => {
    balances.set(settlement.paidById, (balances.get(settlement.paidById) || 0) + settlement.amount);
    balances.set(
      settlement.receivedById,
      (balances.get(settlement.receivedById) || 0) - settlement.amount,
    );
  });

  const memberSummaries = members.map((member) => ({
    user: member.user,
    balance: Math.round((balances.get(member.userId) || 0) * 100) / 100,
  }));

  const debtors = memberSummaries
    .filter((member) => member.balance < -0.01)
    .map((member) => ({ ...member, amount: Math.abs(member.balance) }));
  const creditors = memberSummaries
    .filter((member) => member.balance > 0.01)
    .map((member) => ({ ...member, amount: member.balance }));
  const suggestedSettlements: Array<{
    from: typeof memberSummaries[number]['user'];
    to: typeof memberSummaries[number]['user'];
    amount: number;
  }> = [];

  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.round(Math.min(debtor.amount, creditor.amount) * 100) / 100;

    suggestedSettlements.push({
      from: debtor.user,
      to: creditor.user,
      amount,
    });

    debtor.amount = Math.round((debtor.amount - amount) * 100) / 100;
    creditor.amount = Math.round((creditor.amount - amount) * 100) / 100;

    if (debtor.amount <= 0.01) debtorIndex += 1;
    if (creditor.amount <= 0.01) creditorIndex += 1;
  }

  return { members: memberSummaries, suggestedSettlements };
};

app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(
  cors({
    origin: CLIENT_ORIGIN === '*' ? true : CLIENT_ORIGIN.split(',').map((origin) => origin.trim()),
    credentials: true,
  }),
);

app.get('/', (_req, res) => {
  res.json({ message: 'Expense Splitter API Running' });
});

app.get('/api/health', asyncHandler(async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
}));

app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const name = requireString(req.body.name, 'Name', 2);
  const email = requireString(req.body.email, 'Email').toLowerCase();
  const password = requireString(req.body.password, 'Password', 8);
  const upiId = requireString(req.body.upiId, 'UPI ID', 3).toLowerCase();

  if (!email.includes('@')) {
    throw new AppError(400, 'Valid email is required');
  }

  if (!upiId.includes('@')) {
    throw new AppError(400, 'Valid UPI ID is required');
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser) {
    throw new AppError(409, 'Email is already registered');
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      upiId,
      password: await bcrypt.hash(password, 12),
    },
  });
  const safeUser = publicUser(user);

  res.status(201).json({ user: safeUser, token: signToken(safeUser) });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const email = requireString(req.body.email, 'Email').toLowerCase();
  const password = requireString(req.body.password, 'Password');
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    throw new AppError(401, 'Invalid email or password');
  }

  const safeUser = publicUser(user);
  res.json({ user: safeUser, token: signToken(safeUser) });
}));

app.post('/api/auth/forgot-password', asyncHandler(async (req, res) => {
  const email = requireString(req.body.email, 'Email').toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    throw new AppError(404, 'User not found');
  }

  const resetCode = Math.random().toString().slice(2, 8).padStart(6, '0');
  const resetToken = await bcrypt.hash(resetCode, 12);
  const resetTokenExpiresAt = new Date(Date.now() + 3600000); // 1 hour

  await prisma.user.update({
    where: { id: user.id },
    data: { resetToken, resetTokenExpiresAt },
  });

  let emailSent = false;

  try {
    emailSent = await sendPasswordResetEmail({
      to: user.email,
      userName: user.name,
      resetCode,
    });
  } catch (error) {
    console.error('Failed to send password reset email', error);
  }

  res.json({ message: 'Password reset code sent to your email', emailSent });
}));

app.post('/api/auth/reset-password', asyncHandler(async (req, res) => {
  const email = requireString(req.body.email, 'Email').toLowerCase();
  const resetCode = requireString(req.body.resetCode, 'Reset code', 6);
  const newPassword = requireString(req.body.newPassword, 'Password', 8);

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    throw new AppError(404, 'User not found');
  }

  if (!user.resetToken || !user.resetTokenExpiresAt) {
    throw new AppError(400, 'No password reset request found');
  }

  if (user.resetTokenExpiresAt < new Date()) {
    throw new AppError(400, 'Reset code has expired');
  }

  const isValidCode = await bcrypt.compare(resetCode, user.resetToken);

  if (!isValidCode) {
    throw new AppError(400, 'Invalid reset code');
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      password: await bcrypt.hash(newPassword, 12),
      resetToken: null,
      resetTokenExpiresAt: null,
    },
  });

  const safeUser = publicUser(updatedUser);
  res.json({ message: 'Password reset successful', user: safeUser, token: signToken(safeUser) });
}));

app.get('/api/auth/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: req.user });
}));

app.patch('/api/auth/me', requireAuth, asyncHandler(async (req, res) => {
  const name = requireString(req.body.name, 'Name', 2);
  const upiId = requireString(req.body.upiId, 'UPI ID', 3).toLowerCase();

  if (!upiId.includes('@')) {
    throw new AppError(400, 'Valid UPI ID is required');
  }

  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: { name, upiId },
  });

  res.json({ user: publicUser(user) });
}));

app.get('/api/dashboard', requireAuth, asyncHandler(async (req, res) => {
  const groups = await prisma.group.findMany({
    where: { members: { some: { userId: req.user!.id } } },
    include: {
      owner: { select: { id: true, name: true, email: true, upiId: true } },
      members: { include: { user: { select: { id: true, name: true, email: true, upiId: true } } } },
      expenses: {
        include: {
          paidBy: { select: { id: true, name: true, email: true, upiId: true } },
          splits: { include: { user: { select: { id: true, name: true, email: true, upiId: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      },
      settlements: {
        include: {
          paidBy: { select: { id: true, name: true, email: true, upiId: true } },
          receivedBy: { select: { id: true, name: true, email: true, upiId: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  type FriendUser = Pick<User, 'id' | 'name' | 'email' | 'upiId'>;
  const friends = new Map<string, { user: FriendUser; groups: string[] }>();
  const activities: Array<{
    id: string;
    type: string;
    status: string;
    group: { id: string; name: string };
    title: string;
    amount?: number;
    createdAt: Date;
  }> = [];

  groups.forEach((group) => {
    group.members.forEach((member) => {
      if (member.user.id === req.user!.id) return;
      const existing = friends.get(member.user.id) || { user: member.user, groups: [] as string[] };
      existing.groups.push(group.name);
      friends.set(member.user.id, existing);
    });

    group.expenses.forEach((expense) => {
      expense.splits
        .filter((split) => split.userId === req.user!.id && expense.paidById !== req.user!.id)
        .forEach((split) => {
          activities.push({
            id: `split-${expense.id}-${split.id}`,
            type: 'split_request',
            status: 'open',
            group: { id: group.id, name: group.name },
            title: `You owe ${expense.paidBy.name} for ${expense.title}`,
            amount: split.amount,
            createdAt: expense.createdAt,
          });
        });
    });

    group.settlements
      .filter((settlement) => settlement.paidById === req.user!.id || settlement.receivedById === req.user!.id)
      .forEach((settlement) => {
        const isPayer = settlement.paidById === req.user!.id;
        activities.push({
          id: `settlement-${settlement.id}`,
          type: isPayer ? 'payment_sent' : 'approval_request',
          status: settlement.status.toLowerCase(),
          group: { id: group.id, name: group.name },
          title: isPayer
            ? `${settlement.receivedBy.name} ${settlement.status === SettlementStatus.APPROVED ? 'approved' : 'received'} your payment`
            : `${settlement.paidBy.name} marked a payment for your approval`,
          amount: settlement.amount,
          createdAt: settlement.approvedAt || settlement.createdAt,
        });
      });
  });

  activities.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  res.json({
    groupCount: groups.length,
    friends: Array.from(friends.values()),
    activities,
  });
}));

app.get('/api/groups', requireAuth, asyncHandler(async (req, res) => {
  const groups = await prisma.group.findMany({
    where: { members: { some: { userId: req.user!.id } } },
    include: {
      owner: { select: { id: true, name: true, email: true, upiId: true } },
      members: { include: { user: { select: { id: true, name: true, email: true, upiId: true } } } },
      _count: { select: { expenses: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  res.json({ groups });
}));

app.post('/api/groups', requireAuth, asyncHandler(async (req, res) => {
  const name = requireString(req.body.name, 'Group name', 2);
  const description =
    typeof req.body.description === 'string' && req.body.description.trim()
      ? req.body.description.trim()
      : null;

  const group = await prisma.group.create({
    data: {
      name,
      description,
      ownerId: req.user!.id,
      members: { create: { userId: req.user!.id } },
    },
    include: {
      owner: { select: { id: true, name: true, email: true, upiId: true } },
      members: { include: { user: { select: { id: true, name: true, email: true, upiId: true } } } },
      _count: { select: { expenses: true } },
    },
  });

  res.status(201).json({ group });
}));

app.get('/api/groups/:groupId', requireAuth, asyncHandler(async (req, res) => {
  await ensureGroupMember(req.params.groupId, req.user!.id);

  const group = await prisma.group.findUnique({
    where: { id: req.params.groupId },
    include: {
      owner: { select: { id: true, name: true, email: true, upiId: true } },
      members: {
        include: { user: { select: { id: true, name: true, email: true, upiId: true } } },
        orderBy: { joinedAt: 'asc' },
      },
      expenses: {
        include: {
          paidBy: { select: { id: true, name: true, email: true, upiId: true } },
          splits: { include: { user: { select: { id: true, name: true, email: true, upiId: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      },
      settlements: {
        include: {
          paidBy: { select: { id: true, name: true, email: true, upiId: true } },
          receivedBy: { select: { id: true, name: true, email: true, upiId: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  res.json({ group, balances: await calculateBalances(req.params.groupId) });
}));

app.post('/api/groups/:groupId/members', requireAuth, asyncHandler(async (req, res) => {
  await ensureGroupMember(req.params.groupId, req.user!.id);

  const email = requireString(req.body.email, 'Member email').toLowerCase();
  const [user, group] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.group.findUnique({ where: { id: req.params.groupId } }),
  ]);

  if (!user) {
    throw new AppError(404, 'User must register before being added');
  }

  if (!group) {
    throw new AppError(404, 'Group not found');
  }

  const member = await prisma.groupMember.upsert({
    where: { userId_groupId: { userId: user.id, groupId: req.params.groupId } },
    create: { userId: user.id, groupId: req.params.groupId },
    update: {},
    include: { user: { select: { id: true, name: true, email: true, upiId: true } } },
  });

  await prisma.group.update({ where: { id: req.params.groupId }, data: { updatedAt: new Date() } });
  let emailSent = false;

  try {
    emailSent = await sendGroupInviteEmail({
      to: user.email,
      invitedName: user.name,
      groupName: group.name,
      invitedBy: req.user!.name,
    });
  } catch (error) {
    console.error('Failed to send group invite email', error);
  }

  res.status(201).json({ member, emailSent });
}));

app.delete('/api/groups/:groupId/members/:userId', requireAuth, asyncHandler(async (req, res) => {
  await ensureGroupMember(req.params.groupId, req.user!.id);
  const group = await prisma.group.findUnique({ where: { id: req.params.groupId } });

  if (!group) {
    throw new AppError(404, 'Group not found');
  }

  if (group.ownerId !== req.user!.id) {
    throw new AppError(403, 'Only the group creator can remove members');
  }

  if (req.params.userId === group.ownerId) {
    throw new AppError(400, 'The group creator cannot be removed');
  }

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: req.params.userId, groupId: req.params.groupId } },
  });

  if (!membership) {
    throw new AppError(404, 'Member not found');
  }

  const memberCount = await prisma.groupMember.count({ where: { groupId: req.params.groupId } });

  if (memberCount <= 1) {
    throw new AppError(400, 'A group needs at least one member');
  }

  if (!(await isMemberSettled(req.params.groupId, req.params.userId))) {
    throw new AppError(400, 'Member can be removed only after their group balance is settled and no payment is pending');
  }

  await prisma.groupMember.delete({ where: { id: membership.id } });
  await prisma.group.update({ where: { id: req.params.groupId }, data: { updatedAt: new Date() } });
  res.status(204).send();
}));

app.post('/api/groups/:groupId/expenses', requireAuth, asyncHandler(async (req, res) => {
  await ensureGroupMember(req.params.groupId, req.user!.id);

  const title = requireString(req.body.title, 'Title', 2);
  const amount = requireAmount(req.body.amount);
  const paidById =
    typeof req.body.paidById === 'string' && req.body.paidById.trim()
      ? req.body.paidById.trim()
      : req.user!.id;
  const notes =
    typeof req.body.notes === 'string' && req.body.notes.trim() ? req.body.notes.trim() : null;
  const members = await prisma.groupMember.findMany({ where: { groupId: req.params.groupId } });
  const requestedSplitUserIds: string[] = Array.isArray(req.body.splitUserIds)
    ? req.body.splitUserIds.filter((id: unknown): id is string => typeof id === 'string')
    : [];
  const splitUserIds: string[] = requestedSplitUserIds.length
    ? Array.from(new Set(requestedSplitUserIds))
    : members.map((member) => member.userId);

  if (!members.some((member) => member.userId === paidById)) {
    throw new AppError(400, 'Payer must be a group member');
  }

  if (!splitUserIds.length) {
    throw new AppError(400, 'Select at least one member to split with');
  }

  const groupMemberIds = new Set(members.map((member) => member.userId));

  if (!splitUserIds.every((userId) => groupMemberIds.has(userId))) {
    throw new AppError(400, 'Split members must belong to the group');
  }

  const share = Math.floor((amount / splitUserIds.length) * 100) / 100;
  const remainder = Math.round((amount - share * splitUserIds.length) * 100) / 100;

  const expense = await prisma.expense.create({
    data: {
      title,
      amount,
      notes,
      paidById,
      groupId: req.params.groupId,
      splits: {
        create: splitUserIds.map((userId, index) => ({
          userId,
          amount: index === 0 ? Math.round((share + remainder) * 100) / 100 : share,
        })),
      },
    },
    include: {
      paidBy: { select: { id: true, name: true, email: true, upiId: true } },
      splits: { include: { user: { select: { id: true, name: true, email: true, upiId: true } } } },
    },
  });

  await prisma.group.update({ where: { id: req.params.groupId }, data: { updatedAt: new Date() } });
  
  // Send email notifications to users involved in the split
  const paidByUser = await prisma.user.findUnique({ where: { id: paidById }, select: { name: true } });
  const group = await prisma.group.findUnique({ where: { id: req.params.groupId }, select: { name: true } });
  
  if (paidByUser && group) {
    for (const split of expense.splits) {
      if (split.userId !== paidById) {
        try {
          await sendNewSplitEmail({
            to: split.user.email,
            userName: split.user.name,
            expenseTitle: title,
            amount: split.amount,
            paidByName: paidByUser.name,
            groupName: group.name,
          });
        } catch (error) {
          console.error(`Failed to send split email to ${split.user.email}`, error);
        }
      }
    }
  }
  
  res.status(201).json({ expense, balances: await calculateBalances(req.params.groupId) });
}));

app.delete('/api/expenses/:expenseId', requireAuth, asyncHandler(async (req, res) => {
  const expense = await prisma.expense.findUnique({
    where: { id: req.params.expenseId },
    include: { group: { select: { ownerId: true } } },
  });

  if (!expense) {
    throw new AppError(404, 'Expense not found');
  }

  await ensureGroupMember(expense.groupId, req.user!.id);

  // Only the payer or group owner can delete an expense
  if (expense.paidById !== req.user!.id && expense.group.ownerId !== req.user!.id) {
    throw new AppError(403, 'Only the payer or group owner can delete this expense');
  }

  await prisma.expense.delete({ where: { id: expense.id } });
  await prisma.group.update({ where: { id: expense.groupId }, data: { updatedAt: new Date() } });
  res.status(204).send();
}));

app.post('/api/groups/:groupId/settlements', requireAuth, asyncHandler(async (req, res) => {
  await ensureGroupMember(req.params.groupId, req.user!.id);

  const amount = requireAmount(req.body.amount);
  const paidById =
    typeof req.body.paidById === 'string' && req.body.paidById.trim()
      ? req.body.paidById.trim()
      : req.user!.id;
  const receivedById = requireString(req.body.receivedById, 'Received by');
  const note = typeof req.body.note === 'string' && req.body.note.trim() ? req.body.note.trim() : null;

  if (paidById !== req.user!.id) {
    throw new AppError(403, 'Only the payer can mark a payment as paid');
  }

  if (paidById === receivedById) {
    throw new AppError(400, 'Settlement needs two different members');
  }

  await Promise.all([
    ensureGroupMember(req.params.groupId, paidById),
    ensureGroupMember(req.params.groupId, receivedById),
  ]);

  const settlement = await prisma.settlement.create({
    data: { amount, note, paidById, receivedById, groupId: req.params.groupId },
    include: {
      paidBy: { select: { id: true, name: true, email: true, upiId: true } },
      receivedBy: { select: { id: true, name: true, email: true, upiId: true } },
    },
  });

  await prisma.group.update({ where: { id: req.params.groupId }, data: { updatedAt: new Date() } });
  res.status(201).json({ settlement, balances: await calculateBalances(req.params.groupId) });
}));

app.patch('/api/settlements/:settlementId/approve', requireAuth, asyncHandler(async (req, res) => {
  const settlement = await prisma.settlement.findUnique({
    where: { id: req.params.settlementId },
  });

  if (!settlement) {
    throw new AppError(404, 'Settlement not found');
  }

  await ensureGroupMember(settlement.groupId, req.user!.id);

  if (settlement.receivedById !== req.user!.id) {
    throw new AppError(403, 'Only the receiver can approve this payment');
  }

  if (settlement.status !== SettlementStatus.PENDING) {
    throw new AppError(400, 'Payment has already been reviewed');
  }

  const updatedSettlement = await prisma.settlement.update({
    where: { id: settlement.id },
    data: { status: SettlementStatus.APPROVED, approvedAt: new Date() },
    include: {
      paidBy: { select: { id: true, name: true, email: true, upiId: true } },
      receivedBy: { select: { id: true, name: true, email: true, upiId: true } },
    },
  });

  res.json({ settlement: updatedSettlement, balances: await calculateBalances(settlement.groupId) });
}));

app.patch('/api/settlements/:settlementId/reject', requireAuth, asyncHandler(async (req, res) => {
  const settlement = await prisma.settlement.findUnique({
    where: { id: req.params.settlementId },
  });

  if (!settlement) {
    throw new AppError(404, 'Settlement not found');
  }

  await ensureGroupMember(settlement.groupId, req.user!.id);

  if (settlement.receivedById !== req.user!.id) {
    throw new AppError(403, 'Only the receiver can reject this payment');
  }

  if (settlement.status !== SettlementStatus.PENDING) {
    throw new AppError(400, 'Payment has already been reviewed');
  }

  const updatedSettlement = await prisma.settlement.update({
    where: { id: settlement.id },
    data: { status: SettlementStatus.REJECTED },
    include: {
      paidBy: { select: { id: true, name: true, email: true, upiId: true } },
      receivedBy: { select: { id: true, name: true, email: true, upiId: true } },
    },
  });

  res.json({ settlement: updatedSettlement, balances: await calculateBalances(settlement.groupId) });
}));

app.use((_req, _res, next) => {
  next(new AppError(404, 'Route not found'));
});

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  const status = error instanceof AppError ? error.status : 500;
  const message = status === 500 ? 'Something went wrong' : error.message;

  if (status === 500) {
    console.error(error);
  }

  res.status(status).json({ error: message });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(() => {
    void prisma.$disconnect();
  });
});
