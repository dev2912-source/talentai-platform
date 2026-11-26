export interface UserProfileOut {
  id: string;
  email: string;
  username: string;
  is_hr: boolean;
  department: string;
  salary: number;
  leave_balance: number;
  attendance_score: number;
}

export interface CandidateOut {
  id: string;
  job_id: string;
  name: string;
  email: string | null;
  match_score: number;
  matched_skills: string;
  interview_slot: string;
  email_subject: string;
  email_body: string;
  resume_source: string;
  resume_storage_path: string;
  email_sent: boolean;
  status: string;
  created_at: string | null;
}

export interface JobPostingOut {
  id: string;
  title: string;
  department: string;
  description: string;
  required_skills: string;
  experience_years: number;
  status: string;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface JobPostingSummaryOut extends JobPostingOut {
  candidate_count: number;
}

export interface ScreenJobResponse {
  job_id: string;
  status: string;
  candidates: CandidateOut[];
}

export interface JobDetailResponse {
  job: JobPostingOut;
  candidates: CandidateOut[];
  email_mode?: string;
}

export interface CandidateDecisionIn {
  candidate_id: string;
  approved: boolean;
  email?: string | null;
  email_subject: string;
  email_body: string;
  interview_slot?: string | null;
}

export interface ApproveJobRequest {
  decisions: CandidateDecisionIn[];
}

export interface ApproveJobResponse {
  job_id: string;
  status: string;
  sent_count: number;
  rejected_count: number;
  email_mode?: string;
  candidates: CandidateOut[];
}

export interface TapDataOut {
  id: number | string;
  employeeId: string;
  tapType: string;
  tapNumber: number;
  timestamp: string;
  deviceType: string;
  location: string;
}

export interface TapResponse {
  status: string;
  message: string;
  data: TapDataOut;
}

export interface AttendanceLogOut {
  id: number | string;
  employee_id: string;
  timestamp: string;
  device_type: string;
  location: string;
  tap_type: string;
  created_at: string | null;
}

export interface AttendanceReportOut {
  id: string;
  batch_id: string;
  employee_name: string;
  total_hours: number;
  leaves_taken: number;
  ai_score: number | null;
  ai_feedback: string;
  created_at: string | null;
}

export interface AttendanceReportBatchResponse {
  batch_id: string | null;
  reports: AttendanceReportOut[];
}

export interface AttendanceBatchSummaryOut {
  batch_id: string;
  created_at: string | null;
  employee_count: number;
}

export interface PerformanceRecordOut {
  id: string;
  batch_id: string;
  employee_id: string;
  employee_name: string;
  employee_email: string;
  department: string;
  review_period: string;
  kpi_data: string;
  performance_score: number | null;
  kpi_achievement_percent: number | null;
  strengths: string | null;
  areas_for_improvement: string | null;
  recommended_actions: string | null;
  created_at: string | null;
}

export interface PerformanceBatchResponse {
  batch_id: string | null;
  records: PerformanceRecordOut[];
}

export interface PerformanceBatchSummaryOut {
  batch_id: string;
  review_period: string;
  created_at: string | null;
  employee_count: number;
}

export interface PolicyIn {
  title: string;
  content: string;
}

export interface PolicyOut {
  id: string;
  title: string;
  content: string;
  last_updated: string | null;
}

export interface FaqIn {
  question: string;
  answer: string;
}

export interface FaqOut {
  id: string;
  question: string;
  answer: string;
  created_at: string | null;
}

export interface KbOverviewResponse {
  policies: PolicyOut[];
  faqs: FaqOut[];
  employees: UserProfileOut[];
}

export interface ChatRequest {
  message: string;
}

export interface ChatResponse {
  response: string;
}
