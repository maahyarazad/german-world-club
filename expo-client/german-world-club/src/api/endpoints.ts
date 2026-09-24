import type { SignInRequest, SignInResponse, TokenPairResponse, ResendOtpResponse } from '@gwc/contracts/auth';
import type {
  EmailCodeSent, OnboardingStatus, RegisterRequest, RegisterResponse, VerifyMobileResponse,
} from '@gwc/contracts/onboarding';
import type {
  MemberProfile, OrganisationProfile, OrganisationPublicProfile, ProfileLink, PublicMemberProfile,
  UpdateOrganisationProfileRequest, UpdateProfileRequest,
} from '@gwc/contracts/profile';
import type { Asset } from '@gwc/contracts/media';
import type {
  EventDetail, EventList, EventRegistration, RegisterForEventRequest,
} from '@gwc/contracts/events';
import type {
  ActivityPage, AuthorList, CreatePostRequest, Feed, FeedScope, FollowState, PostList, ProfileTab,
  ThreadPost, ThreadView,
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
  byHandle: (handle: string) => api<PublicMemberProfile>(`/profile/handles/${encodeURIComponent(handle)}`),
  handleAvailable: (handle: string) =>
    api<{ available: boolean }>(`/profile/handles/${encodeURIComponent(handle)}/available`),
  setHandle: (handle: string) => api<MemberProfile>('/profile/me/handle', { method: 'PUT', body: { handle } }),
  setAvatar: (assetId: string | null) => api<MemberProfile>('/profile/me/avatar', { method: 'PUT', body: { assetId } }),
  setLinks: (links: ProfileLink[]) => api<MemberProfile>('/profile/me/links', { method: 'PUT', body: { links } }),
  organisation: (kind: 'merchant' | 'partner') => api<OrganisationProfile>(`/profile/${kind}`),
  updateOrganisation: (kind: 'merchant' | 'partner', body: UpdateOrganisationProfileRequest) =>
    api<OrganisationProfile>(`/profile/${kind}/public`, { method: 'PATCH', body }),
  organisationPublic: (slug: string) => api<OrganisationPublicProfile>(`/profile/organisations/${encodeURIComponent(slug)}`),
};

/**
 * Uploads (feature 010). A member uploads at /media; a merchant or partner
 * uploads its logo at /media/{kind} — the same pipeline, one route per
 * audience. `alt` goes before the file: the server reads the fields that
 * precede the file part.
 */
export const mediaApi = {
  upload: (file: { uri: string; name: string; type: string }, alt: string, route = '/media') => {
    const form = new FormData();
    form.append('alt', alt);
    // React Native's FormData takes a { uri, name, type } descriptor for a file.
    form.append('file', file as unknown as Blob);
    return api<Asset>(route, { method: 'POST', body: form });
  },
  get: (id: string) => api<Asset>(`/media/${id}`),
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
  memberPosts: (memberId: string, cursor?: string | null, tab: ProfileTab = 'threads') =>
    api<PostList>(`/threads/members/${memberId}/posts${q({ tab, cursor })}`),
  create: (body: CreatePostRequest) => api<ThreadPost>('/threads/posts', { method: 'POST', body }),
  quotes: (id: string, cursor?: string | null) => api<PostList>(`/threads/posts/${id}/quotes${q({ cursor })}`),
  likes: (id: string, cursor?: string | null) => api<AuthorList>(`/threads/posts/${id}/likes${q({ cursor })}`),
  followers: (memberId: string, cursor?: string | null) =>
    api<AuthorList>(`/threads/members/${memberId}/followers${q({ cursor })}`),
  following: (memberId: string, cursor?: string | null) =>
    api<AuthorList>(`/threads/members/${memberId}/following${q({ cursor })}`),
  activity: (cursor?: string | null) => api<ActivityPage>(`/threads/activity${q({ cursor })}`),
  unread: () => api<{ unread: number }>('/threads/activity/unread'),
  markSeen: (upTo: string) => api<void>('/threads/activity/seen', { method: 'POST', body: { upTo } }),
  setBlock: (memberId: string, on: boolean) =>
    api<{ blocked: boolean }>(`/threads/blocks/${memberId}`, { method: on ? 'PUT' : 'DELETE' }),
  setMute: (memberId: string, on: boolean) =>
    api<{ muted: boolean }>(`/threads/mutes/${memberId}`, { method: on ? 'PUT' : 'DELETE' }),
  blocks: () => api<AuthorList>('/threads/blocks'),
  mutes: () => api<AuthorList>('/threads/mutes'),
  remove: (id: string) => api<void>(`/threads/posts/${id}`, { method: 'DELETE' }),
  setLike: (id: string, on: boolean) => api<ThreadPost>(`/threads/posts/${id}/like`, { method: on ? 'PUT' : 'DELETE' }),
  setRepost: (id: string, on: boolean) => api<ThreadPost>(`/threads/posts/${id}/repost`, { method: on ? 'PUT' : 'DELETE' }),
  report: (id: string, reason: string) =>
    api<{ reported: true }>(`/threads/posts/${id}/report`, { method: 'POST', body: { reason } }),
  setFollow: (memberId: string, on: boolean) =>
    api<FollowState>(`/threads/follows/${memberId}`, { method: on ? 'PUT' : 'DELETE' }),
};
