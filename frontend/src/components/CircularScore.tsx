"use client";

import { useId } from "react";

interface CircularScoreProps {
  /** Candidate match percentage from 0 to 100. */
  score: number;
  /** Optional container sizing classes (defaults to w-20 h-20). */
  className?: string;
}

/** SVG circular progress ring displaying a candidate's 0-100 AI match score. */
export function CircularScore({
  score,
  className = "w-20 h-20",
}: CircularScoreProps) {
  const gradientId = useId();
  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clampedScore / 100) * circumference;

  return (
    <div
      className={`relative shrink-0 ${className}`}
      role="img"
      aria-label={`AI match score ${clampedScore}%`}
    >
      <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90 transform">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <circle
          cx="40"
          cy="40"
          r={radius}
          stroke="currentColor"
          strokeWidth="6"
          fill="none"
          className="text-slate-100"
        />
        <circle
          cx="40"
          cy="40"
          r={radius}
          stroke={`url(#${gradientId})`}
          strokeWidth="6"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-semibold text-slate-900">
          {clampedScore}%
        </span>
      </div>
    </div>
  );
}
