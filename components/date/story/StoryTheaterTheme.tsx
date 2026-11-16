import MeetingAppearanceControl from '../MeetingAppearanceControl';
import {meetingAppearance, MEETING_READING_CSS, meetingCustomCss} from '../../../utils/meetingAppearance';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Moon, Palette, Sparkle, SquaresFour, Sun, X } from '@phosphor-icons/react';
import { STORY_THEATER_APPEARANCE_STORAGE_KEY } from '../../../utils/storyTheaterBackup';
import { useOS } from '../../../context/OSContext';

export type StoryColorMode = 'light' | 'dark';
export type StoryDecorMode = 'plain' | 'cinema';

interface StoryAppearance {
    color: StoryColorMode;
    decor: StoryDecorMode;
}

interface StoryThemeContextValue {
    appearance: StoryAppearance;
    setColor: (value: StoryColorMode) => void;
    setDecor: (value: StoryDecorMode) => void;
}

const STORAGE_KEY = STORY_THEATER_APPEARANCE_STORAGE_KEY;
const STORY_APPEARANCE_HISTORY_KEY = '__sullyStoryAppearance';
const DEFAULT_APPEARANCE: StoryAppearance = { color: 'light', decor: 'plain' };
const StoryThemeContext = createContext<StoryThemeContextValue | null>(null);

function readAppearance(): StoryAppearance {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_APPEARANCE;
        const value = JSON.parse(raw) as Partial<StoryAppearance>;
        return {
            color: value.color === 'dark' ? 'dark' : 'light',
            decor: value.decor === 'cinema' ? 'cinema' : 'plain',
        };
    } catch {
        return DEFAULT_APPEARANCE;
    }
}

export const STORY_THEME_CSS = `
.story-theme {
  --story-bg: #f3f3f3;
  --story-surface: #ffffff;
  --story-raised: #ffffff;
  --story-ink: #262626;
  --story-muted: #737373;
  --story-faint: #a3a3a3;
  --story-line: #dedede;
  --story-soft: #eeeeee;
  --story-accent: #444444;
  --story-accent-soft: #eeeeee;
  --story-accent-ink: #262626;
  position: relative;
  isolation: isolate;
  overflow: hidden;
  background: var(--story-bg);
  color: var(--story-ink);
  color-scheme: light;
}
.story-theme-dark {
  --story-bg: #171717;
  --story-surface: #202020;
  --story-raised: #292929;
  --story-ink: #f5f5f5;
  --story-muted: #b0b0b0;
  --story-faint: #888888;
  --story-line: #444444;
  --story-soft: #333333;
  --story-accent: #cccccc;
  --story-accent-soft: #383838;
  --story-accent-ink: #eeeeee;
  color-scheme: dark;
}
.story-theme.story-decor-cinema {
  --story-bg: #eaeaea;
  --story-surface: #f8f8f8;
  --story-raised: #ffffff;
  --story-line: #cccccc;
  --story-accent: #444444;
  --story-accent-soft: #e5e5e5;
  --story-accent-ink: #444444;
}
.story-theme-dark.story-decor-cinema {
  --story-bg: #101010;
  --story-surface: #191919;
  --story-raised: #242424;
  --story-line: #444444;
  --story-accent: #eeeeee;
  --story-accent-soft: #333333;
  --story-accent-ink: #ffffff;
}
.story-theme::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity 240ms ease;
}
.story-theme.story-decor-cinema::before {
  opacity: 1;
  background:
    radial-gradient(circle at 10% 4%, color-mix(in srgb, var(--story-accent) 17%, transparent) 0, transparent 28%),
    radial-gradient(circle at 92% 34%, rgba(193,193,193,.12) 0, transparent 25%),
    linear-gradient(115deg, transparent 0 47%, rgba(255,255,255,.035) 48% 49%, transparent 50% 100%);
}
.story-theme > * { position: relative; z-index: 1; }
.story-theme .bg-stone-100 { background-color: var(--story-bg) !important; }
.story-theme .bg-stone-100\\/95 { background-color: var(--story-bg) !important; }
.story-theme .bg-white { background-color: var(--story-raised) !important; }
.story-theme .bg-slate-50, .story-theme .bg-slate-100 { background-color: var(--story-surface) !important; }
.story-theme .bg-slate-200 { background-color: var(--story-soft) !important; }
.story-theme .bg-slate-900 { background-color: var(--story-ink) !important; color: var(--story-bg) !important; }
/* Editor-only dark palette: remove the glaring near-white action buttons and memory notice.
   The ordinary story theme and all light-mode panels keep their existing colors. */
.story-theme.story-theme-dark .story-setup-save {
  background-color: #424242 !important;
  color: #f0f0f0 !important;
  border: 1px solid #555555;
}
.story-theme.story-theme-dark .story-setup-save:active {
  background-color: #505050 !important;
}
.story-theme.story-theme-dark .story-memory-live-card {
  background-color: #303030 !important;
  color: #e8e8e8 !important;
  border-color: #494949 !important;
}
.story-theme.story-theme-dark .story-memory-live-card .text-amber-800 {
  color: #efefef !important;
}
.story-theme.story-theme-dark .story-memory-live-card .text-amber-700 {
  color: #c9c9c9 !important;
}
.story-theme.story-theme-dark .story-memory-live-card .border-amber-200 {
  border-color: #505050 !important;
}
.story-theme .text-slate-900, .story-theme .text-slate-800, .story-theme .text-slate-700, .story-theme .text-slate-600 { color: var(--story-ink) !important; }
.story-theme .text-slate-500, .story-theme .text-slate-400 { color: var(--story-muted) !important; }
.story-theme .text-slate-300 { color: var(--story-faint) !important; }
.story-theme .border-slate-100, .story-theme .border-slate-200, .story-theme .border-slate-300 { border-color: var(--story-line) !important; }
.story-theme .divide-slate-200 > :not([hidden]) ~ :not([hidden]) { border-color: var(--story-line) !important; }
.story-theme .text-violet-500, .story-theme .text-violet-600, .story-theme .text-violet-700 { color: var(--story-accent-ink) !important; }
.story-theme .bg-violet-50, .story-theme .bg-violet-100 { background-color: var(--story-accent-soft) !important; }
.story-theme .bg-violet-500, .story-theme .bg-violet-600 { background-color: var(--story-accent) !important; }
.story-theme .border-violet-100, .story-theme .border-violet-200 { border-color: color-mix(in srgb, var(--story-accent) 34%, var(--story-line)) !important; }
.story-theme-dark .bg-rose-50\\/70 { background-color: rgba(46,46,46,.72) !important; }
.story-theme-dark .text-rose-800, .story-theme-dark .text-rose-700, .story-theme-dark .text-rose-600, .story-theme-dark .text-rose-500 { color: #eeeeee !important; }
.story-theme-dark .border-rose-200, .story-theme-dark .border-rose-200\\/70 { border-color: rgba(186,186,186,.28) !important; }
.story-theme .story-safe-header { padding-top: max(1.25rem, var(--safe-top)); }
.story-theme .story-safe-footer { padding-bottom: calc(var(--safe-bottom) + 12px); }
.story-theme .story-safe-sheet { padding-bottom: calc(var(--safe-bottom) + 18px); }
.story-theme .story-quick-preset { bottom: calc(var(--safe-bottom) + 112px); }
.story-theme .story-page-scroll {
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  scrollbar-color: var(--story-line) transparent;
}
.story-theme .story-page-scroll:hover,
.story-theme .story-page-scroll:focus-within { scrollbar-color: var(--story-faint) transparent; }
/* WebKit styling also removes the Windows arrow buttons and opaque track. */
@supports selector(::-webkit-scrollbar) {
  .story-theme .story-page-scroll { scrollbar-width: auto; scrollbar-color: auto; }
  .story-theme .story-page-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
  .story-theme .story-page-scroll::-webkit-scrollbar-track,
  .story-theme .story-page-scroll::-webkit-scrollbar-corner { background: transparent; }
  .story-theme .story-page-scroll::-webkit-scrollbar-thumb { background: var(--story-line); border-radius: 999px; }
  .story-theme .story-page-scroll:hover::-webkit-scrollbar-thumb,
  .story-theme .story-page-scroll:focus-within::-webkit-scrollbar-thumb { background: var(--story-faint); }
  .story-theme .story-page-scroll::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
.story-theme.story-decor-plain .shadow-sm { box-shadow: none !important; }
.story-theme.story-decor-cinema .story-cinema-rule { position: relative; }
.story-theme.story-decor-cinema .story-cinema-rule::after {
  content: '✦  ·  ✦';
  position: absolute;
  right: 0;
  bottom: -5px;
  padding-left: 10px;
  color: var(--story-accent);
  background: var(--story-bg);
  font-size: 8px;
  letter-spacing: .24em;
}
/* The cinema skin must be visible on the real story reader, not only in the
   appearance portal. The root ::before sits behind opaque reader/header layers.
   Scope all visible flourishes to a selected cinema skin with NO custom reading
   preset, so plain and imported reading CSS remain untouched. */
.story-theme.story-decor-cinema:not(.meeting-reading) {
  --story-cinema-trim: rgba(83,83,83,.34);
  --story-cinema-wash: rgba(83,83,83,.10);
}
.story-theme.story-theme-dark.story-decor-cinema:not(.meeting-reading) {
  --story-cinema-trim: rgba(229,229,229,.38);
  --story-cinema-wash: rgba(229,229,229,.085);
}
.story-theme.story-decor-cinema:not(.meeting-reading) .meeting-reading-page {
  background-image:
    radial-gradient(ellipse at 0% 2%, var(--story-cinema-wash), transparent 39%),
    radial-gradient(ellipse at 100% 95%, var(--story-cinema-wash), transparent 43%);
}
.story-theme.story-decor-cinema:not(.meeting-reading) .story-reading-floor {
  position: relative;
  isolation: isolate;
  border-radius: 0;
  padding-left: clamp(4px, 1.2vw, 10px);
  padding-right: clamp(4px, 1.2vw, 10px);
  background: transparent;
  box-shadow: none;
}
.story-theme.story-decor-cinema:not(.meeting-reading) .story-reading-floor::before {
  content: '✦';
  position: absolute;
  top: 20px;
  right: 9px;
  pointer-events: none;
  color: var(--story-cinema-trim);
  font-size: 9px;
  line-height: 1;
  opacity: .55;
  letter-spacing: 0;
}
.story-theme.story-decor-cinema:not(.meeting-reading) .story-reading-floor > :first-child {
  padding-right: 24px;
}
.story-theme.story-decor-cinema:not(.meeting-reading) .story-reading-floor .meeting-user-turn {
  border-left-color: var(--story-cinema-trim) !important;
}
.story-theme.story-decor-cinema:not(.meeting-reading) .story-safe-header {
  border-bottom-color: var(--story-cinema-trim) !important;
  background-image: linear-gradient(90deg, transparent, var(--story-cinema-wash) 55%, transparent);
}

/* Memory pages share the reader's canvas: clear typography, fine lines, no stacked white cards. */
.story-theme .story-memory-workspace {
  --memory-hairline: color-mix(in srgb, var(--story-ink) 10%, transparent);
  --memory-divider: color-mix(in srgb, var(--story-ink) 14%, transparent);
  background: var(--story-bg) !important;
  font-variant-numeric: tabular-nums;
}
.story-theme .story-memory-header {
  background: var(--story-bg) !important;
  border-bottom: 0 !important;
}
.story-theme .story-memory-header-row { gap: 2px; padding-inline: 12px; height: 64px; }
.story-theme .story-memory-header-row h1 {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -.025em;
  line-height: 1.4;
}
.story-theme .story-memory-header-row p {
  color: var(--story-muted) !important;
  font-size: 10px;
  letter-spacing: .06em;
  margin-bottom: 2px;
}
.story-theme .story-memory-header button { color: var(--story-ink) !important; }
.story-theme .story-memory-header-create,
.story-theme .story-memory-icon-button {
  border: 0 !important;
  background: transparent !important;
  color: var(--story-muted) !important;
  padding: 0;
  min-height: 44px;
  min-width: 44px;
  transition: background-color 120ms ease, color 120ms ease;
}
.story-theme .story-memory-icon-button:hover:not(:disabled),
.story-theme .story-memory-header-create:hover:not(:disabled),
.story-theme .story-memory-icon-button:focus-visible,
.story-theme .story-memory-header-create:focus-visible {
  background: var(--story-soft) !important;
  color: var(--story-ink) !important;
}
.story-theme .story-memory-tabs {
  background: transparent !important;
  border: 0 !important;
  border-bottom: 1px solid var(--memory-hairline) !important;
  border-radius: 0 !important;
  gap: 0;
  margin-bottom: 0;
}
.story-theme .story-memory-tabs button {
  position: relative;
  min-width: 0;
  min-height: 45px;
  flex: 1 1 0;
  border-radius: 0 !important;
  background: transparent !important;
  color: var(--story-muted) !important;
  box-shadow: none !important;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: .01em;
}
.story-theme .story-memory-tabs button[aria-pressed="true"] {
  background: transparent !important;
  color: var(--story-ink) !important;
  box-shadow: none !important;
  font-weight: 600;
}
.story-theme .story-memory-tabs button[aria-pressed="true"]::after {
  content: '';
  position: absolute;
  width: 40px;
  height: 2px;
  bottom: -1px;
  left: calc(50% - 20px);
  border-radius: 2px;
  background: var(--story-ink);
}
.story-theme .story-memory-search-bar {
  padding-top: 4px;
  padding-bottom: 11px;
  background: var(--story-bg) !important;
}
.story-theme .story-memory-search-field { isolation: isolate; }
.story-theme .story-memory-search-field svg {
  color: var(--story-muted) !important;
  left: 5px !important;
  top: 15px !important;
}
.story-theme .story-memory-search-input {
  appearance: none;
  border: none !important;
  border-bottom: 1px solid var(--memory-divider) !important;
  border-radius: 0 !important;
  background: transparent !important;
  color: var(--story-ink) !important;
  box-shadow: none !important;
  padding-left: 34px !important;
  padding-right: 4px !important;
  font-size: 14px;
}
.story-theme .story-memory-search-input::placeholder { color: var(--story-faint); opacity: 1; }
.story-theme .story-memory-search-input:focus {
  outline: none !important;
  border-bottom: 1px solid var(--story-ink) !important;
}
.story-theme .story-memory-scroll {
  background: var(--story-bg);
  padding: 6px 22px calc(var(--safe-bottom) + 24px) !important;
}
.story-theme .story-memory-count { margin-top: 8px; margin-bottom: 2px; }
.story-theme .story-memory-count h2 {
  color: var(--story-muted) !important;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: .02em;
}
.story-theme .story-memory-repeated-toggle,
.story-theme .story-memory-count button {
  color: var(--story-muted) !important;
  background: transparent;
  text-decoration: none !important;
}
.story-theme .story-memory-repeated-toggle:hover { background: var(--story-soft); }
.story-theme .story-memory-pager {
  margin: 0 0 6px !important;
  min-height: 51px;
  border: 0 !important;
  border-bottom: 1px solid var(--memory-hairline) !important;
  border-radius: 0 !important;
  background: transparent !important;
}
.story-theme .story-memory-pager button,
.story-theme .story-memory-bottom-page button {
  border-radius: 50%;
  color: var(--story-ink) !important;
}
.story-theme .story-memory-pager button:hover:not(:disabled),
.story-theme .story-memory-bottom-page button:hover:not(:disabled) {
  background: var(--story-soft) !important;
}
.story-theme .story-memory-page-number { color: var(--story-muted); font-size: 12px; }
.story-theme .story-memory-page-number select {
  min-width: 46px;
  background: transparent !important;
  border: 0 !important;
  border-bottom: 1px solid var(--memory-divider) !important;
  border-radius: 0 !important;
  padding: 5px 3px;
  color: var(--story-ink) !important;
  text-align: center;
  font-size: 13px;
}
.story-theme .story-memory-record-list { display: flex; flex-direction: column; }
.story-theme .story-memory-node {
  border: 0 !important;
  border-bottom: 1px solid var(--memory-hairline) !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  overflow: visible;
}
.story-theme .story-memory-node-open {
  padding: 16px 42px 18px 2px !important;
  border-radius: 0 !important;
  color: var(--story-ink) !important;
}
.story-theme .story-memory-node-open > span:first-child {
  color: var(--story-muted);
  font-size: 12px;
  gap: 8px;
}
.story-theme .story-memory-node-open > span:first-child strong {
  color: var(--story-ink);
  font-size: 12px;
  font-weight: 600;
}
.story-theme .story-memory-node-open > span:nth-child(2) {
  margin-top: 7px;
  font-size: 14px;
  line-height: 1.8;
  letter-spacing: .008em;
}
.story-theme .story-memory-node-open span.rounded.bg-stone-100 {
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11px;
  color: var(--story-muted) !important;
  background: var(--story-soft) !important;
}
.story-theme .story-memory-node-more {
  top: 11px !important;
  right: -4px !important;
  color: var(--story-muted) !important;
}
.story-theme .story-memory-node-more:hover { background: var(--story-soft); }
.story-theme .story-memory-bottom-page {
  max-width: none;
  padding: 16px 0 2px;
  margin: 12px 0 0 !important;
  background: transparent !important;
  border: 0 !important;
  border-top: 1px solid var(--memory-hairline) !important;
  border-radius: 0 !important;
}
.story-theme .story-memory-page-progress {
  font-size: 12px;
  letter-spacing: .08em;
  color: var(--story-muted);
}
.story-theme .story-memory-archive-list { display: flex; flex-direction: column; gap: 0; }
.story-theme .story-memory-archive-item {
  padding: 14px 0 17px !important;
  border: 0 !important;
  border-bottom: 1px solid var(--memory-hairline) !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}
.story-theme .story-memory-archive-item:last-child { border-bottom: 0 !important; }
.story-theme .story-memory-archive-heading { min-width: 0; gap: 7px; align-items: center; }
.story-theme .story-memory-archive-heading h2 {
  font-size: 14px;
  font-weight: 600;
  color: var(--story-ink) !important;
  letter-spacing: -.01em;
}
.story-theme .story-memory-archive-heading p {
  margin-top: 5px;
  color: var(--story-muted) !important;
  font-size: 11px;
  line-height: 1.5;
}
.story-theme .story-memory-archive-heading input[type="checkbox"] { accent-color: var(--story-ink); }
.story-theme .story-memory-archive-actions {
  display: flex;
  flex-shrink: 0;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0;
  margin: 0 -5px 0 0;
}
.story-theme .story-memory-archive-actions .story-memory-icon-button {
  height: 44px;
  width: 44px;
  color: var(--story-muted) !important;
}
.story-theme .story-memory-archive-item > details { padding-left: 0 !important; margin-top: 5px; }
.story-theme .story-memory-archive-item details summary {
  color: var(--story-muted) !important;
  font-size: 12px;
  line-height: 1.65;
}
.story-theme .story-memory-archive-item > details > summary {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 42px;
}
.story-theme .story-memory-expand-summary { list-style: none; }
.story-theme .story-memory-expand-summary::-webkit-details-marker { display: none; }
.story-theme .story-memory-expand-caret { transition: transform 140ms ease; }
.story-theme .story-memory-archive-item details[open] > .story-memory-expand-summary .story-memory-expand-caret { transform: rotate(180deg); }
.story-theme .story-memory-archive-item > details > div { padding-left: 10px; border-left: 1px solid var(--memory-hairline); }
.story-theme .story-memory-range {
  border: 0 !important;
  border-left: 2px solid var(--story-muted) !important;
  border-radius: 2px !important;
  padding: 13px 12px !important;
  background: color-mix(in srgb, var(--story-ink) 3%, var(--story-bg)) !important;
  box-shadow: none !important;
}
.story-theme .story-memory-recent-range { color: var(--story-ink) !important; }
.story-theme .story-memory-recent-range:hover,
.story-theme .story-memory-range-cancel:hover { background: var(--story-soft); }
.story-theme .story-memory-range input[type="number"],
.story-theme .story-memory-workspace input[type="date"],
.story-theme .story-memory-workspace select:not(.story-memory-page-number select) {
  border: 1px solid var(--memory-divider) !important;
  color: var(--story-ink) !important;
  background: var(--story-bg) !important;
}
.story-theme .story-memory-action-icon {
  background: transparent !important;
  border: 0 !important;
  color: var(--story-muted) !important;
}
.story-theme .story-memory-action-icon:hover:not(:disabled) { background: var(--story-soft) !important; }
.story-theme .story-memory-delete-trigger { color: var(--story-muted) !important; }
.story-theme .story-memory-dialog {
  background: var(--story-bg) !important;
  color: var(--story-ink) !important;
  border-top: 1px solid var(--memory-divider) !important;
  box-shadow: 0 -16px 48px rgba(0,0,0,.12);
}
.story-theme .story-memory-dialog button.bg-violet-700 {
  background: var(--story-ink) !important;
  color: var(--story-bg) !important;
}
.story-theme .story-memory-workspace button:focus-visible,
.story-theme .story-memory-workspace input:focus-visible,
.story-theme .story-memory-workspace select:focus-visible,
.story-theme .story-memory-workspace textarea:focus-visible {
  outline: 2px solid var(--story-muted);
  outline-offset: 2px;
}
@media (max-width: 359px) {
  .story-theme .story-memory-scroll { padding-inline: 17px !important; }
  .story-theme .story-memory-archive-heading { gap: 4px; }
  .story-theme .story-memory-archive-actions .story-memory-icon-button { width: 40px; min-width: 40px; }
}
/* Archive groups and history paging are light dividers, never nested cards. */
.story-theme .story-archive-summary::before,
.story-theme .story-archive-summary::after,
.story-theme .story-load-more::before,
.story-theme .story-load-more::after {
  content: '';
  display: block;
  height: 1px;
  min-width: 12px;
  flex: 1 1 0;
  background: color-mix(in srgb, var(--story-line) 55%, transparent);
}
.story-theme .story-load-more { gap: 10px; }
.story-theme .story-load-more-button,
.story-theme .story-archive-summary { color: var(--story-muted) !important; }
.story-theme .story-load-more-button:hover,
.story-theme .story-archive-summary:hover { color: var(--story-ink) !important; }
.story-theme .story-archive-content {
  border-top: 1px solid color-mix(in srgb, var(--story-line) 55%, transparent);
}
.story-theme .story-archive-content > section {
  border-color: color-mix(in srgb, var(--story-line) 55%, transparent) !important;
}
.story-theme.story-decor-cinema:not(.meeting-reading) .story-reading-floor.story-archive-range {
  background: transparent;
  box-shadow: none;
  border-radius: 0;
  padding-left: 0;
  padding-right: 0;
}
.story-theme.story-decor-cinema:not(.meeting-reading) .story-reading-floor.story-archive-range::before {
  content: none;
}
.story-theme.story-decor-cinema:not(.meeting-reading) .story-reading-floor.story-archive-range > :first-child {
  padding-right: 0;
}
.story-theme.story-decor-cinema:not(.meeting-reading) .meeting-reading-page .divide-y.divide-slate-200 > :not([hidden]) ~ :not([hidden]) {
  border-color: color-mix(in srgb, var(--story-line) 45%, transparent) !important;
}
@media (max-width: 360px) {
  .story-theme.story-decor-cinema:not(.meeting-reading) .story-reading-floor::before {
    right: 7px;
  }
  .story-theme.story-decor-cinema:not(.meeting-reading) .story-reading-floor > :first-child {
    padding-right: 22px;
  }
  .story-theme.story-decor-cinema:not(.meeting-reading) .story-reading-floor.story-archive-range > :first-child {
    padding-right: 0;
  }
}
body.ios-keyboard-open .story-theme .story-safe-footer { padding-bottom: 12px !important; }
body.ios-keyboard-open .story-theme .story-safe-sheet { padding-bottom: 18px !important; }
body.ios-keyboard-open .story-theme .story-quick-preset { bottom: 112px !important; }
@media (prefers-reduced-motion: reduce) {
  .story-theme *, .story-theme *::before, .story-theme *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; }
}
`;

export const StoryTheaterThemeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
    const [appearance, setAppearance] = useState<StoryAppearance>(readAppearance);
    const {theme} = useOS();
    const reading = meetingAppearance(theme.storyAppearance);
    const color = reading.id === 'none' ? appearance.color : reading.id === 'night' ? 'dark' : 'light';

    useEffect(() => {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance)); }
        catch { /* Some Android WebViews deny storage writes; retain the active in-memory theme. */ }
    }, [appearance]);

    const value = useMemo<StoryThemeContextValue>(() => ({
        appearance,
        setColor: color => setAppearance(current => ({ ...current, color })),
        setDecor: decor => setAppearance(current => ({ ...current, decor })),
    }), [appearance]);

    return <StoryThemeContext.Provider value={value}>
        <div className={`story-theme story-theme-${color} story-decor-${appearance.decor} h-full w-full min-h-0 ${reading.id!=='none'?'meeting-reading':''}`} data-reading-preset={reading.id}>
            <style>{STORY_THEME_CSS + MEETING_READING_CSS + '\n' + meetingCustomCss(theme.storyAppearance)}</style>
            {children}
        </div>
    </StoryThemeContext.Provider>;
};

export const StoryAppearanceButton: React.FC<{ className?: string }> = ({ className = '' }) => {
    const context = useContext(StoryThemeContext);
    const { registerBackHandler, theme } = useOS();
    const [open, setOpen] = useState(false);
    const closePanel = useCallback(() => {
        setOpen(false);
        try {
            if (window.history.state?.[STORY_APPEARANCE_HISTORY_KEY]) window.history.back();
        } catch { /* history 不可用时仍正常关闭 */ }
    }, []);

    useEffect(() => {
        if (!open) return;

        try {
            const previous = window.history.state && typeof window.history.state === 'object'
                ? window.history.state
                : {};
            if (!previous[STORY_APPEARANCE_HISTORY_KEY]) {
                window.history.pushState({ ...previous, [STORY_APPEARANCE_HISTORY_KEY]: true }, '');
            }
        } catch { /* 某些内嵌 WebView 禁用 history，保留其它关闭方式 */ }

        const unregister = registerBackHandler(() => {
            closePanel();
            return true;
        });
        const handlePopState = () => setOpen(false);
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closePanel();
        };
        window.addEventListener('popstate', handlePopState);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            unregister();
            window.removeEventListener('popstate', handlePopState);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [closePanel, open, registerBackHandler]);
    if (!context) return null;
    const { appearance, setColor, setDecor } = context;

    return <>
        <button type='button' onClick={() => setOpen(true)} className={`w-9 h-9 rounded-full grid place-items-center ${className}`} title='剧情外观' aria-label='剧情外观'>
            <Palette size={18} weight={appearance.decor === 'cinema' ? 'fill' : 'regular'} />
        </button>
        {open && createPortal(<div
            className={`story-theme story-theme-${appearance.color} story-decor-${appearance.decor} fixed inset-0 z-[90] flex items-end sm:items-center justify-center overflow-y-auto overscroll-contain`}
            style={{ position: 'fixed', paddingTop: 'max(12px, var(--safe-top))', paddingBottom: 'max(0px, var(--safe-bottom))', backgroundColor: 'rgba(0, 0, 0, .35)' }}
            onClick={closePanel}
            role='presentation'
        >
            <div
                className='story-safe-sheet relative flex w-full max-h-full flex-col overflow-hidden sm:max-w-sm rounded-t-[28px] sm:rounded-[28px] bg-stone-100 px-5 pt-5 shadow-2xl'
                onClick={event => event.stopPropagation()}
                role='dialog'
                aria-modal='true'
                aria-labelledby='story-appearance-title'
            >
                <div className='shrink-0 flex items-start gap-4'>
                    <div className='min-w-0 flex-1'><div className='text-[9px] tracking-[.22em] uppercase font-bold text-violet-500'>Story appearance</div><h2 id='story-appearance-title' className='mt-1 text-lg font-semibold'>剧情放映厅外观</h2><p className='mt-1 text-[10px] leading-5 text-slate-500'>只影响剧情模式，普通聊天与记忆宫殿保持原样。</p></div>
                    <button type='button' onClick={closePanel} className='w-10 h-10 shrink-0 rounded-full bg-white border border-slate-200 grid place-items-center' aria-label='关闭剧情外观'><X size={17} /></button>
                </div>
                <div className='mt-5 min-h-0 overflow-y-auto overscroll-contain border-t border-slate-200'><MeetingAppearanceControl surface='story' /><div hidden={meetingAppearance(theme.storyAppearance).id !== 'none'}>
                    <div className='py-4 flex items-center gap-3'><span className='text-xs font-semibold w-16'>明暗</span><div className='min-w-0 flex-1 grid grid-cols-2 p-1 rounded-xl bg-slate-200'><button onClick={() => setColor('light')} className={`py-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 ${appearance.color === 'light' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}><Sun size={14} />浅色</button><button onClick={() => setColor('dark')} className={`py-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 ${appearance.color === 'dark' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}><Moon size={14} />深色</button></div></div>
                    <div className='py-4 border-t border-slate-200 flex items-center gap-3'><span className='text-xs font-semibold w-16'>装饰</span><div className='min-w-0 flex-1 grid grid-cols-2 p-1 rounded-xl bg-slate-200'><button onClick={() => setDecor('plain')} className={`py-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 ${appearance.decor === 'plain' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}><SquaresFour size={14} />素雅</button><button onClick={() => setDecor('cinema')} className={`py-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 ${appearance.decor === 'cinema' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}><Sparkle size={14} />花里胡哨</button></div></div>
                </div></div>
            </div>
        </div>, document.body)}
    </>;
};
