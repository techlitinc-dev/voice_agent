"use client";

import * as React from "react";
import { useDropzone, type Accept } from "react-dropzone";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

export type DropzoneProps = {
  onUpload: (file: File) => void;
  accept?: Accept;
  maxSize?: number;
  maxFiles?: number;
  hint?: string;
  className?: string;
};

export function Dropzone({
  onUpload,
  accept,
  maxSize,
  maxFiles = 1,
  hint,
  className,
}: DropzoneProps) {
  const onDrop = React.useCallback(
    (files: File[]) => {
      if (files[0]) onUpload(files[0]);
    },
    [onUpload]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxSize,
    maxFiles,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition",
        isDragActive
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/30 hover:border-muted-foreground/60",
        className
      )}
    >
      <input {...getInputProps()} />
      <UploadCloud className="mb-2 h-8 w-8 text-muted-foreground" />
      <p className="text-sm">
        {isDragActive ? "Drop the file here..." : "Drag and drop or click to upload"}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
