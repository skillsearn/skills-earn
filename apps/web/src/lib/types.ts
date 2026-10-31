export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Package {
  id: string;
  name: string;
  slug: string;
  level: number;
  price: number;
  directRateBps: number;
  maxGenerations: number;
  description: string | null;
  features: string[];
  isActive: boolean;
  generationRatesBps: number[];
}

export interface Me {
  id: string;
  userCode: string;
  fullName: string;
  email: string;
  mobile: string;
  referralCode: string;
  referralLink: string;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  packageActivatedAt: string | null;
  payoutDetails: PayoutDetails | null;
  upiQrUrl?: string | null;
  createdAt: string;
  activePackage: { id: string; name: string; slug: string; level: number; price: string; maxGenerations: number } | null;
  sponsor: { userCode: string; fullName: string } | null;
}

export interface PayoutDetails {
  upiId?: string;
  accountName?: string;
  accountNumber?: string;
  ifsc?: string;
  bankName?: string;
  upiQrPath?: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt?: number;
}

export interface WalletSummary {
  availableBalance: number;
  onHold: number;
  pendingCommission: number;
  totalIncome: number;
  todayIncome: number;
  weeklyIncome: number;
  monthlyIncome: number;
  directIncome: number;
  gen1Income: number;
  gen2Income: number;
  gen3Income: number;
  turnoverIncome: number;
  generationIncome: Record<string, number>;
  skippedCommission: number;
  ownTurnover: number;
  teamTurnover: number;
  totalWithdrawn: number;
  totalCharges: number;
}

export interface TeamSummary {
  directReferrals: number;
  totalDownline: number;
  active: number;
  inactive: number;
  byDepth: Record<string, number>;
  referralCode?: string;
  referralLink?: string;
}

export interface WithdrawalSchedule {
  mode: 'weekly' | 'monthly';
  weeklyDay: number;
  monthlyDay: number;
  windowDays: number;
  minAmount: number;
  chargeBps: number;
  processingEnabled: boolean;
  manualPayoutConfirmation: boolean;
  windowOpenNow: boolean;
  nextWindowStart: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface Purchase {
  id: string;
  type: 'new' | 'upgrade';
  amount: string;
  commissionBase: string;
  status: 'pending' | 'paid' | 'failed' | 'cancelled';
  provider: string | null;
  providerPaymentId: string | null;
  paidAt: string | null;
  commissionStatus: string;
  createdAt: string;
  notes: string | null;
  manualProofPath?: string | null;
  manualUtr?: string | null;
  manualNote?: string | null;
  manualSubmittedAt?: string | null;
  proofUrl?: string | null;
  package: { name: string; level: number } | null;
  fromPackage: { name: string; level: number } | null;
  user?: { id?: string; userCode: string; fullName: string; mobile: string; email?: string };
}

export interface Commission {
  id: string;
  purchaseId: string;
  level: number;
  rateBps: number;
  baseAmount: string;
  amount: string;
  calculation: string;
  status: 'pending' | 'credited' | 'skipped';
  skipReason: string | null;
  availableAt: string | null;
  createdAt: string;
  source: { userCode: string; fullName: string } | null;
  beneficiary: { userCode: string; fullName: string } | null;
  purchase: { type: string; amount: string; package: { name: string } | null } | null;
}

export interface LedgerEntry {
  id: string;
  txnId: string;
  type: string;
  amount: string;
  balanceAfter: string;
  description: string;
  generation: number | null;
  createdAt: string;
  user?: { userCode: string; fullName: string };
}

export interface Withdrawal {
  id: string;
  grossAmount: string;
  chargeBps: number;
  chargeAmount: string;
  netAmount: string;
  method: 'upi' | 'bank';
  payoutDetails: PayoutDetails;
  status: 'requested' | 'under_review' | 'approved' | 'processing' | 'paid' | 'rejected' | 'failed';
  adminNote: string | null;
  paymentReference: string | null;
  requestedAt: string;
  paidAt: string | null;
  payoutProvider?: 'manual' | 'razorpayx' | null;
  payoutId?: string | null;
  payoutMode?: string | null;
  payoutStatus?: string | null;
  payoutUtr?: string | null;
  payoutError?: string | null;
  user?: { id?: string; userCode: string; fullName: string; mobile: string; email?: string; status?: string };
}

export interface PayoutGatewayStatus {
  enabled: boolean;
  testMode: boolean;
  reason: string | null;
}

export interface CheckoutPayload {
  purchaseId: string;
  type: 'new' | 'upgrade';
  packageName: string;
  amount: number;
  provider: 'razorpay' | 'mock' | 'manual';
  status: string;
  manual: ManualPaymentInfo | null;
  proof: { utr: string | null; submittedAt: string | null } | null;
  keyId?: string;
  orderId?: string;
  amountPaise?: number;
  currency?: string;
  prefill?: { name: string; email: string; contact: string };
}

export interface DownlineMember {
  id: string;
  userCode: string;
  fullName: string;
  depth: number;
  sponsorCode: string | null;
  packageName: string | null;
  packageLevel: number | null;
  status: string;
  isActive: boolean;
  joinedAt: string;
}

export interface CourseSummary {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  thumbnailUrl: string | null;
  category: string | null;
  duration: string | null;
  minPackageLevel: number;
  lessonCount: number;
  completedCount: number;
  locked: boolean;
}

export interface Lesson {
  id: string;
  title: string;
  videoUrl: string | null;
  content: string | null;
  durationMinutes: number | null;
  sort: number;
  isPreview: boolean;
  locked?: boolean;
  completed?: boolean;
}

export interface ManualPaymentInfo {
  enabled: boolean;
  upiId?: string;
  payeeName?: string;
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
  ifsc?: string;
  instructions?: string;
  qrUrl: string | null;
}
