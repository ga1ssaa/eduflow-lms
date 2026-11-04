// Contract types generated from the registered backend OpenAPI components.
// Kept in source so builds do not require local analysis artifacts.

export interface CompletionRead {
  lesson_id: string;
  is_completed: boolean;
  completed_at: string | null;
  progress: CourseProgress;
}

export interface CourseCreate {
  title: string;
  slug: string;
  description?: string;
  category?: string;
  level?: 'beginner' | 'intermediate' | 'advanced';
}

export interface CoursePage {
  items: Array<CourseSummary>;
  total: number;
  page: number;
  page_size: number;
}

export interface CourseProgress {
  course_id: string;
  total_lessons: number;
  completed_lessons: number;
  progress_percentage: number;
  is_completed: boolean;
}

export interface CourseRead {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  instructor_name: string;
  module_count: number;
  lesson_count: number;
  published_at: string | null;
  instructor_id: string;
  status: 'draft' | 'published';
  created_at: string;
  updated_at: string;
  modules: Array<ModuleRead>;
}

export interface CourseStats {
  course_id: string;
  total_students: number;
  completed_students: number;
  in_progress_students: number;
  average_progress_percentage: number;
  total_lessons: number;
}

export interface CourseSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  instructor_name: string;
  module_count: number;
  lesson_count: number;
  published_at: string | null;
  instructor_id: string;
  status: 'draft' | 'published';
  created_at: string;
  updated_at: string;
}

export interface CourseUpdate {
  title?: string | null;
  slug?: string | null;
  description?: string | null;
  category?: string | null;
  level?: 'beginner' | 'intermediate' | 'advanced' | null;
}

export type EmptyBody = Record<string, never>;

export interface EnrolledCoursePage {
  items: Array<EnrolledCourseSummary>;
  total: number;
  page: number;
  page_size: number;
}

export interface EnrolledCourseSummary {
  course_id: string;
  total_lessons: number;
  completed_lessons: number;
  progress_percentage: number;
  is_completed: boolean;
  enrollment_id: string;
  title: string;
  slug: string;
  description: string;
  category: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  status: 'draft' | 'published';
  is_available: boolean;
  instructor_name: string;
  enrolled_at: string;
}

export interface EnrollmentRead {
  id: string;
  student_id: string;
  course_id: string;
  enrolled_at: string;
}

export interface HTTPValidationError {
  detail?: Array<ValidationError>;
}

export interface HealthResponse {
  status?: 'ok';
}

export interface InstructorStudentPage {
  items: Array<InstructorStudentRead>;
  total: number;
  page: number;
  page_size: number;
}

export interface InstructorStudentRead {
  student_id: string;
  full_name: string;
  enrollment_id: string;
  enrolled_at: string;
  total_lessons: number;
  completed_lessons: number;
  progress_percentage: number;
  is_completed: boolean;
}

export interface LessonCreate {
  title: string;
  content?: string;
  video_url?: string | null;
}

export interface LessonOutline {
  id: string;
  title: string;
  position: number;
}

export interface LessonRead {
  id: string;
  title: string;
  position: number;
  module_id: string;
  content: string;
  video_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface LessonUpdate {
  title?: string | null;
  content?: string | null;
  video_url?: string | null;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ModuleCreate {
  title: string;
}

export interface ModuleOutline {
  id: string;
  title: string;
  position: number;
  lessons: Array<LessonOutline>;
}

export interface ModuleRead {
  id: string;
  course_id: string;
  title: string;
  position: number;
  created_at: string;
  updated_at: string;
  lessons: Array<LessonRead>;
}

export interface ModuleUpdate {
  title?: string | null;
}

export interface OrderUpdate {
  ids: Array<string>;
}

export interface PublicCourseDetail {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  instructor_name: string;
  module_count: number;
  lesson_count: number;
  published_at: string | null;
  modules: Array<ModuleOutline>;
}

export interface PublicCoursePage {
  items: Array<PublicCourseSummary>;
  total: number;
  page: number;
  page_size: number;
}

export interface PublicCourseSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  instructor_name: string;
  module_count: number;
  lesson_count: number;
  published_at: string | null;
}

export interface RegisterRequest {
  email: string;
  password: string;
  full_name: string;
}

export interface StudentCourseRead {
  course_id: string;
  total_lessons: number;
  completed_lessons: number;
  progress_percentage: number;
  is_completed: boolean;
  enrollment_id: string;
  title: string;
  slug: string;
  description: string;
  category: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  status: 'draft' | 'published';
  is_available: boolean;
  instructor_name: string;
  enrolled_at: string;
  modules: Array<ModuleOutline>;
  progress: CourseProgress;
}

export interface StudentDashboard {
  total_enrolled_courses: number;
  completed_courses: number;
  in_progress_courses: number;
  courses: Array<EnrolledCourseSummary>;
}

export interface StudentLessonRead {
  id: string;
  title: string;
  content: string;
  video_url: string | null;
  position: number;
  course_id: string;
  module_id: string;
  module_title: string;
  course_title: string;
  is_completed: boolean;
  completed_at: string | null;
}

export interface TokenResponse {
  access_token: string;
  token_type?: 'bearer';
  expires_in: number;
}

export interface UserRead {
  id: string;
  email: string;
  full_name: string;
  role: 'student' | 'instructor' | 'admin';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ValidationError {
  loc: Array<string | number>;
  msg: string;
  type: string;
  input?: unknown;
  ctx?: Record<string, unknown>;
}

export type User = UserRead;
export type Role = User['role'];
export type LoginInput = LoginRequest;
export type RegisterInput = RegisterRequest;
export type Level = PublicCourseSummary['level'];
export type Status = CourseSummary['status'];
