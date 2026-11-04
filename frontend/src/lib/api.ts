import { client } from './client';
import type {
  CompletionRead,
  CoursePage,
  CourseProgress,
  CourseRead,
  CourseStats,
  EnrolledCoursePage,
  EnrollmentRead,
  InstructorStudentPage,
  Level,
  PublicCourseDetail,
  PublicCoursePage,
  Status,
  StudentCourseRead,
  StudentDashboard,
  StudentLessonRead,
} from './types';

export interface PageParams {
  page?: number;
  page_size?: number;
}
export interface CatalogParams extends PageParams {
  search?: string;
  category?: string;
  level?: Level;
}
export interface InstructorCourseParams extends PageParams {
  status?: Status;
}
export interface AdminCourseParams extends InstructorCourseParams {
  search?: string;
}

function query(params: object = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '')
      search.set(key, String(value));
  }
  return search.size ? `?${search}` : '';
}

const id = encodeURIComponent;
const managementPath = (courseId: string, admin = false) =>
  `/${admin ? 'admin' : 'instructor'}/courses/${id(courseId)}`;

export const api = {
  catalog: (params: CatalogParams = {}, signal?: AbortSignal) =>
    client.request<PublicCoursePage>(`/courses${query(params)}`, {
      auth: false,
      signal,
    }),
  publicCourse: (slug: string, signal?: AbortSignal) =>
    client.request<PublicCourseDetail>(`/courses/${id(slug)}`, {
      auth: false,
      signal,
    }),
  enroll: (courseId: string) =>
    client.request<EnrollmentRead>(`/courses/${id(courseId)}/enroll`, {
      method: 'POST',
    }),
  studentCourses: (params: PageParams = {}, signal?: AbortSignal) =>
    client.request<EnrolledCoursePage>(`/students/me/courses${query(params)}`, {
      signal,
    }),
  studentCourse: (courseId: string, signal?: AbortSignal) =>
    client.request<StudentCourseRead>(`/students/me/courses/${id(courseId)}`, {
      signal,
    }),
  lesson: (lessonId: string, signal?: AbortSignal) =>
    client.request<StudentLessonRead>(`/students/me/lessons/${id(lessonId)}`, {
      signal,
    }),
  completeLesson: (lessonId: string) =>
    client.request<CompletionRead>(
      `/students/me/lessons/${id(lessonId)}/complete`,
      { method: 'POST' },
    ),
  incompleteLesson: (lessonId: string) =>
    client.request<CompletionRead>(
      `/students/me/lessons/${id(lessonId)}/complete`,
      { method: 'DELETE' },
    ),
  studentProgress: (courseId: string, signal?: AbortSignal) =>
    client.request<CourseProgress>(
      `/students/me/courses/${id(courseId)}/progress`,
      { signal },
    ),
  dashboard: (signal?: AbortSignal) =>
    client.request<StudentDashboard>('/students/me/dashboard', { signal }),
  instructorCourses: (
    params: InstructorCourseParams = {},
    signal?: AbortSignal,
  ) =>
    client.request<CoursePage>(`/instructor/courses${query(params)}`, {
      signal,
    }),
  adminCourses: (params: AdminCourseParams = {}, signal?: AbortSignal) =>
    client.request<CoursePage>(`/admin/courses${query(params)}`, { signal }),
  managementCourse: (courseId: string, admin = false, signal?: AbortSignal) =>
    client.request<CourseRead>(managementPath(courseId, admin), { signal }),
  publishCourse: (courseId: string, admin = false) =>
    client.request<CourseRead>(`${managementPath(courseId, admin)}/publish`, {
      method: 'POST',
    }),
  unpublishCourse: (courseId: string, admin = false) =>
    client.request<CourseRead>(`${managementPath(courseId, admin)}/unpublish`, {
      method: 'POST',
    }),
  courseStudents: (
    courseId: string,
    params: PageParams = {},
    signal?: AbortSignal,
  ) =>
    client.request<InstructorStudentPage>(
      `/instructor/courses/${id(courseId)}/students${query(params)}`,
      { signal },
    ),
  courseStats: (courseId: string, signal?: AbortSignal) =>
    client.request<CourseStats>(`/instructor/courses/${id(courseId)}/stats`, {
      signal,
    }),
};
