"use client";

import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { FileText, Upload, X } from "lucide-react";

interface FileDropzoneProps {
  /** Currently selected files. */
  files: File[];
  /** Callback invoked when files are added or removed. */
  onFilesChange: (files: File[]) => void;
  /** Comma-separated accepted extensions or MIME types (e.g. ".pdf,.docx,.txt"). */
  accept?: string;
  /** Allow selecting multiple files at once. */
  multiple?: boolean;
  /** Main prompt inside the dropzone. */
  title?: string;
  /** Secondary helper text when no files are selected. */
  subtitle?: string;
  /** Label on the browse button. */
  buttonLabel?: string;
  /** Disable interactions while submitting. */
  disabled?: boolean;
  /** Optional extra wrapper classes. */
  className?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function matchesAccept(file: File, accept?: string): boolean {
  if (!accept) return true;
  const rules = accept
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return true;

  const fileName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();

  return rules.some((rule) => {
    if (rule.startsWith(".")) {
      return fileName.endsWith(rule);
    }
    if (rule.endsWith("/*")) {
      return mimeType.startsWith(rule.slice(0, -1));
    }
    return mimeType === rule;
  });
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/** Reusable drag-and-drop and click-to-browse file uploader with removable file list. */
export function FileDropzone({
  files,
  onFilesChange,
  accept,
  multiple = true,
  title = "Drop PDF Resumes Here",
  subtitle = "or click to browse files",
  buttonLabel = "Select Files",
  disabled = false,
  className = "",
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [skippedNotice, setSkippedNotice] = useState<string | null>(null);

  function addIncomingFiles(incomingList: FileList | null) {
    if (!incomingList || incomingList.length === 0 || disabled) return;
    const incoming = Array.from(incomingList);
    const validIncoming = incoming.filter((file) =>
      matchesAccept(file, accept),
    );
    const rejectedCount = incoming.length - validIncoming.length;

    if (rejectedCount > 0) {
      setSkippedNotice(
        `Skipped ${rejectedCount} unsupported ${
          rejectedCount === 1 ? "file" : "files"
        }${accept ? ` (accepted: ${accept})` : ""}.`,
      );
    } else {
      setSkippedNotice(null);
    }

    if (validIncoming.length === 0) return;

    if (!multiple) {
      onFilesChange([validIncoming[0]]);
      return;
    }

    const seen = new Set(files.map(fileKey));
    const merged = [...files];
    for (const file of validIncoming) {
      const key = fileKey(file);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(file);
      }
    }
    onFilesChange(merged);
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    addIncomingFiles(e.target.files);
    e.target.value = "";
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !isDragging) {
      setIsDragging(true);
    }
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    addIncomingFiles(e.dataTransfer.files);
  }

  function handleRemove(index: number) {
    if (disabled) return;
    onFilesChange(files.filter((_, i) => i !== index));
  }

  return (
    <div className={`flex flex-col ${className}`}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-200 ${
          disabled
            ? "border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed"
            : isDragging
              ? "border-accent bg-accent/10 cursor-pointer"
              : "border-slate-200 bg-[#fbfbfe] hover:border-accent/50 hover:bg-accent/5 cursor-pointer"
        }`}
      >
        <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-[#544af4] flex items-center justify-center shadow-md shadow-accent/20">
          <Upload className="w-7 h-7 text-white" />
        </div>
        <h4 className="mb-2 font-medium text-[17px] text-slate-800">{title}</h4>
        <p className="text-[13px] text-slate-400 mb-6">
          {files.length > 0 ? `${files.length} file(s) selected` : subtitle}
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={handleInputChange}
          className="hidden"
        />

        <span
          aria-hidden="true"
          className={`inline-block px-8 py-2.5 bg-[#544af4] text-white text-[15px] font-medium rounded-xl shadow-sm transition-colors ${
            disabled
              ? "opacity-60 cursor-not-allowed"
              : "hover:bg-[#4338ca] cursor-pointer"
          }`}
        >
          {buttonLabel}
        </span>
      </div>

      {skippedNotice && (
        <p
          role="status"
          className="mt-2.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
        >
          {skippedNotice}
        </p>
      )}

      {files.length > 0 && (
        <div className="mt-4 space-y-2 max-h-48 overflow-y-auto pr-1">
          {files.map((file, idx) => (
            <div
              key={fileKey(file)}
              className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100"
            >
              <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center border border-slate-200 shrink-0">
                <FileText className="w-4 h-4 text-[#544af4]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 truncate">
                  {file.name}
                </p>
                <p className="text-xs text-slate-400">
                  {formatFileSize(file.size)}
                </p>
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove(idx);
                }}
                aria-label={`Remove ${file.name}`}
                className="p-1.5 rounded-lg text-slate-400 hover:text-destructive hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
