import type { SignInRequest, SignInResponse, TokenPairResponse, ResendOtpResponse } from '@gwc/contracts/auth';
import type {
  EmailCodeSent, OnboardingStatus, RegisterRequest, RegisterResponse, VerifyMobileResponse,
} from '@gwc/contracts/onboarding';
import type {
  MemberProfile, OrganisationProfile, PublicMemberProfile, UpdateProfileRequest,
} from '@gwc/contracts/profile';
import type {
  EventDetail, EventList, EventRegistration, RegisterForEventRequest,
} from '@gwc/contracts/events';
import type {
  Feed, FeedScope, FollowState, PostList, ThreadPost, ThreadView,
} from '@gwc/contracts/threads';

import { api } from './client';

/**
 * Every endpoint the app calls, typed from `@gwc/contracts`.
 *
 * No shape is declared here. A field the server renames is a type error in
 * this file and in every screen that reads it — which is the whole reason the
 * contracts package exists (CLAUDE.md).
 */

const q = (params: Record<string, string | undefined | null>) => {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '') as [string, string][];
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
};

export const authApi = {
  signIn: (body: SignInRequest) => api<SignInResponse>('/auth/sign-in', { method: 'POST', body, anonymous: true }),
  verifyOtp: (body: { challengeId: string; code: string; deviceId: string }) =>
    api<TokenPairResponse>('/auth/verify-otp', { method: 'POST', body, anonymous: true }),
  resendOtp: (challengeId: string) =>
    api<ResendOtpResponse>('/auth/otp/resend', { method: 'POST', body: { challengeId }, anonymous: true }),
  signOut: () => api<void>('/auth/sign-out', { method: 'POST' }),
};

export const onboardingApi = {
  register: (body: RegisterRequest) =>
    api<RegisterResponse>('/onboarding/register', { method: 'POST', body, anonymous: true }),
  verifyMobile: (body: { challengeId: string; code: string; deviceId: string }) =>
    api<VerifyMobileResponse>('/onboarding/verify-mobile', { method: 'POST', body, anonymous: true }),
  status: () => api<OnboardingStatus>('/onboarding/status'),
  sendEmailCode: () => api<EmailCodeSent>('/onboarding/email/send', { method: 'POST' }),
  verifyEmail: (body: { challengeId: string; code: string }) =>
    api<OnboardingStatus>('/onboarding/email/verify', { method: 'POST', body }),
};

export const profileApi = {
  me: () => api<MemberProfile>('/profile/me'),
  update: (body: UpdateProfileRequest) => api<MemberProfile>('/profile/me', { method: 'PATCH', body }),
  member: (id: string) => api<PublicMemberProfile>(`/profile/members/${id}`),
  organisation: (kind: 'merchant' | 'partner') => api<OrganisationProfile>(`/profile/${kind}`),
};

export const eventsApi = {
  list: (when: 'upcoming' | 'past', cursor?: string | null) =>
    api<EventList>(`/member/events${q({ when, cursor })}`),
  detail: (id: string) => api<EventDetail>(`/member/events/${id}`),
  register: (id: string, body: RegisterForEventRequest) =>
    api<EventRegistration>(`/member/events/${id}/registration`, { method: 'POST', body }),
  cancel: (id: string) => api<void>(`/member/events/${id}/registration`, { method: 'DELETE' }),
};

export const threadsApi = {
  feed: (scope: FeedScope, cursor?: string | null) => api<Feed>(`/threads/feed${q({ scope, cursor })}`),
  thread: (id: string, cursor?: string | null) => api<ThreadView>(`/threads/posts/${id}${q({ cursor })}`),
  memberPosts: (memberId: string, cursor?: string | null) =>
    api<PostList>(`/threads/members/${memberId}/posts${q({ cursor })}`),
  create: (body: string, replyToId?: string) =>
    api<ThreadPost>('/threads/posts', { method: 'POST', body: { body, ...(replyToId ? { replyToId } : {}) } }),
  remove: (id: string) => api<void>(`/threads/posts/${id}`, { method: 'DELETE' }),
  setLike: (id: string, on: boolean) => api<ThreadPost>(`/threads/posts/${id}/like`, { method: on ? 'PUT' : 'DELETE' }),
  setRepost: (id: string, on: boolean) => api<ThreadPost>(`/threads/posts/${id}/repost`, { method: on ? 'PUT' : 'DELETE' }),
  report: (id: string, reason: string) =>
    api<{ reported: true }>(`/threads/posts/${id}/report`, { method: 'POST', body: { reason } }),
  setFollow: (memberId: string, on: boolean) =>
    api<FollowState>(`/threads/follows/${memberId}`, { method: on ? 'PUT' : 'DELETE' }),
};
